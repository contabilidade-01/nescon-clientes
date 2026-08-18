/**
 * Disparo dos alertas de vencimento pelo WhatsApp.
 *
 * É o passo que faltava para o portal parar de depender do sistema de guias para falar
 * com o cliente. A lógica de envio é o porte enxuto do que já roda lá (`app/routes/fila.py`
 * + `app/helpers.py`), mantendo as travas que provaram valor e deixando de fora tudo o
 * que era específico de mandar PDF.
 *
 * ## A ordem das travas importa
 *
 * Cada uma barra um jeito diferente de estragar o canal, e todas custam quase nada:
 *
 * 1. **Configurado?** Sem uazapi no ambiente, nem começa — e diz isso, em vez de falhar
 *    empresa por empresa.
 * 2. **Número válido?** Fixo e número torto são recusados ANTES da chamada. A uazapi
 *    aceitaria e a mensagem sumiria no vazio.
 * 3. **Não é o próprio número?** Mandar para a instância conectada falha em silêncio:
 *    a API responde sucesso e nada chega.
 * 4. **Teto por hora.** Rajada é o que faz o WhatsApp bloquear número. Janela deslizante
 *    em memória, igual ao sistema de guias.
 * 5. **Pausa entre envios.** Mesmo motivo — cadência humana em vez de metralhadora.
 * 6. **Registro no banco.** O índice único `(company_id, dia_alerta, obrigacoes)` é a
 *    trava final: se o processo morrer no meio e a rotina rodar de novo, quem já recebeu
 *    não recebe outra vez.
 *
 * ## O que fica de fora, de propósito
 *
 * Sem encurtador de URL (o link do portal já é curto), sem envio de documento, sem fila
 * assíncrona e sem tela de progresso de lote. O volume aqui é de dezenas por dia, não de
 * centenas — e cada peça a menos é uma peça que não quebra.
 */
const uazapi = require("./uazapi");
const numeroWpp = require("./whatsappNumero");
const { enviarBoletosPdf } = require("./boletoPdf");
const { previsao, registrarEnvio, registrarFalha } = require("./alertas");
const { trechoDeIncentivo } = require("./engagement");
const { hojeSP, minutosSP } = require("./diasBancarios");
const { lerConfig } = require("./alertasConfig");
const { dentroDaJanela, ehDiaUtil, descricaoJanela } = require("./janelaEnvio");

function num(valor, padrao) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

const THROTTLE_S = num(process.env.ALERTAS_THROTTLE_S, 0.6);
const MAX_POR_HORA = Math.max(1, num(process.env.ALERTAS_MAX_POR_HORA, 180));
const DELAY_DIGITANDO_MS = Math.max(0, num(process.env.ALERTAS_DELAY_MS, 1200));

// Fila de reenvio: quantas vezes tentar e por quantos dias uma mensagem pendente ainda
// faz sentido. Depois de 3 dias, um aviso do dia (inclusive férias) está velho demais —
// vira falha definitiva em vez de continuar tentando para sempre.
const MAX_TENTATIVAS = Math.max(1, num(process.env.ALERTAS_MAX_TENTATIVAS, 5));
const OUTBOX_EXPIRA_DIAS = Math.max(1, num(process.env.ALERTAS_OUTBOX_EXPIRA_DIAS, 3));

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Próximo passo da fila depois de uma tentativa que falhou. Função pura para o backoff
 * ser testável sem banco.
 *
 * Backoff exponencial em minutos (2, 4, 8, 16…), com teto de 6h para não afastar demais
 * a re-tentativa. Ao atingir o teto de tentativas, esgota — vira falha definitiva.
 */
function calcularBackoff(tentativas, max = MAX_TENTATIVAS) {
  const t = Math.max(1, Number(tentativas) || 1);
  if (t >= max) return { esgotou: true, proximaMin: null };
  const proximaMin = Math.min(2 ** t, 360);
  return { esgotou: false, proximaMin };
}

// Janela deslizante de uma hora, em memória. Reinicia a cada deploy — e tudo bem: o
// teto existe contra rajada dentro de uma execução, não como cota contábil.
let carimbos = [];

function sobOTeto() {
  const agora = Date.now();
  carimbos = carimbos.filter((t) => agora - t < 3600000);
  return carimbos.length < MAX_POR_HORA;
}

/** Registra um envio no teto/hora. Compartilhado com docNotify.js — é a mesma instância. */
function marcarEnviado() {
  carimbos.push(Date.now());
}

function portalUrl(caminho = "/") {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${caminho}` : null;
}

/**
 * Envia o que vence hoje. Devolve o relatório por empresa — inclusive dos que NÃO
 * saíram e por quê, que é o que o escritório precisa ver para corrigir cadastro.
 *
 * `apenasSimular` monta tudo e não manda nada: é o botão de conferência do painel.
 */
async function enviarAlertasDoDia(db, { data = null, apenasSimular = false, companyIds = null } = {}) {
  const dia = data || hojeSP();
  // Seleção da tela. É o que substituiu a antiga lista branca por variável de ambiente:
  // escolher quem recebe é operação, não configuração — e um piloto passa a ser "marcar
  // um cliente e enviar", sem redeploy e sem risco de a restrição não chegar ao contentor.
  const selecionadas = Array.isArray(companyIds) && companyIds.length ? new Set(companyIds) : null;

  if (!apenasSimular && !uazapi.configurado()) {
    return {
      dia,
      enviados: 0,
      falhas: 0,
      ignorados: 0,
      erro: "uazapi não configurada (UAZAPI_SUBDOMAIN/UAZAPI_TOKEN).",
      resultados: [],
    };
  }

  // Trava de horário diurno: ninguém recebe mensagem de madrugada. Vale tanto para o
  // disparo automático (o agendador poderia estar configurado para uma hora fora da
  // janela) quanto para o botão "Enviar" do painel (alguém clicando de madrugada).
  // `apenasSimular` sempre passa: a simulação é só a conferência da tela, não envia nada.
  if (!apenasSimular && !dentroDaJanela(minutosSP())) {
    return {
      dia,
      enviados: 0,
      falhas: 0,
      ignorados: 0,
      foraDaJanela: true,
      erro: `Fora da janela diurna de envio (${descricaoJanela()}). Nada foi enviado; tente durante o dia.`,
      resultados: [],
    };
  }

  // Cobrança de honorários só de segunda a sexta. Alertas de tributos e guias saem
  // qualquer dia (porque o vencimento não espera), mas mensagem de cobrança de dívida
  // no sábado/domingo incomoda sem utilidade — o cliente não tem como pagar no fim de
  // semana mesmo.
  const diaUtilHoje = ehDiaUtil();

  // `simular: true` sempre: o texto é montado sem consumir o rodízio de mensagens de
  // incentivo. O consumo só acontece depois que a mensagem realmente sai.
  const { mensagens: todas } = await previsao(db, { data: dia, simular: true, diaUtil: diaUtilHoje });
  const mensagens = selecionadas ? todas.filter((m) => selecionadas.has(m.company_id)) : todas;

  const meuNumero = apenasSimular ? null : await uazapi.owner();
  const resultados = [];
  let enviados = 0;
  let falhas = 0;
  let ignorados = 0;

  for (let i = 0; i < mensagens.length; i += 1) {
    const m = mensagens[i];
    // Registrar o motivo de NÃO ter avisado é tão importante quanto registrar o envio:
    // é o que o escritório precisa ver para corrigir cadastro em vez de descobrir o
    // problema pelo cliente reclamando que não recebeu.
    const anotar = async (motivo, tipo = "ignorado") => {
      if (!apenasSimular) await registrarFalha(db, { companyId: m.company_id, diaAlerta: dia, motivo, tipo });
    };
    // Enfileira para reenvio. `tentativas` já vem contando a tentativa que acabou de
    // falhar (1), ou 0 quando a mensagem nem chegou a ser tentada (teto, interrupção).
    const enfileirar = (tentativas) => enfileirarAlerta(db, m, { tentativas });

    const v = numeroWpp.validar(m.whatsapp);
    if (!v.ok) {
      // Número inválido é problema de CADASTRO — reenviar não resolve. Não vai para a
      // fila; fica só na lista de falhas para alguém corrigir o número.
      ignorados += 1;
      resultados.push({ empresa: m.empresa, company_id: m.company_id, status: "ignorado", motivo: v.motivo });
      await anotar(v.motivo);
      continue;
    }
    if (meuNumero && v.numero === meuNumero) {
      ignorados += 1;
      const motivo = "É o próprio número da instância — o envio falharia em silêncio.";
      resultados.push({ empresa: m.empresa, company_id: m.company_id, status: "ignorado", motivo });
      await anotar(motivo);
      continue;
    }

    if (apenasSimular) {
      resultados.push({
        empresa: m.empresa,
        company_id: m.company_id,
        status: "sairia",
        numero: v.numero,
        texto: m.texto,
      });
      continue;
    }

    if (!sobOTeto()) {
      // Teto de hora: é transitório. Vai para a fila para o drenador retomar depois.
      const motivo = `Teto de ${MAX_POR_HORA} envios/hora atingido. O que sobrou sai na próxima execução.`;
      resultados.push({ empresa: m.empresa, company_id: m.company_id, status: "adiado", motivo });
      await anotar(motivo, "adiado");
      await enfileirar(0);
      continue;
    }

    try {
      await enviarComRetry({ numero: v.numero, texto: m.texto });
      marcarEnviado();
      enviados += 1;

      await registrarEnvio(db, {
        companyId: m.company_id,
        obrigacoes: m.obrigacoes,
        diaAlerta: m.dia_alerta,
        texto: m.texto,
        incentivoId: m.incentivo_id,
      });

      // Só agora o incentivo é consumido. A escolha é determinística, então repetir a
      // chamada sem simulação devolve a mesma frase que já foi enviada — e é ela que
      // fica gravada no histórico do rodízio.
      if (m.incentivo_id) {
        await trechoDeIncentivo(db, { companyId: m.company_id, portalUrl: portalUrl("/"), simular: false });
      }

      // Anexa o(s) PDF(s) do(s) boleto(s) desta mensagem, logo após o texto. Best-effort:
      // o texto (com link do portal) já saiu, então uma falha aqui não desfaz o envio.
      const pdf = await enviarBoletosPdf(db, {
        companyId: m.company_id, obrigacoes: m.obrigacoes, numero: v.numero, marcar: marcarEnviado,
      });
      if (pdf.enviados) console.log(`[alertas] ${m.empresa}: ${pdf.enviados} boleto(s) PDF anexado(s).`);

      resultados.push({ empresa: m.empresa, company_id: m.company_id, status: "enviado", numero: v.numero, boletosPdf: pdf.enviados });
    } catch (err) {
      falhas += 1;
      const tokenRuim = err instanceof uazapi.UazapiTokenInvalido;
      resultados.push({
        empresa: m.empresa,
        company_id: m.company_id,
        status: "falhou",
        motivo: err.message,
      });
      await anotar(err.message, "falhou");
      // Falha transitória: para a fila retentar com backoff.
      await enfileirar(1);
      // Token inválido/desconectado não melhora na próxima empresa: para tudo aqui em
      // vez de colecionar o mesmo erro sessenta vezes. As mensagens que ainda não foram
      // tentadas também entram na fila, para o drenador retomá-las quando a instância voltar.
      if (tokenRuim) {
        const motivo = "Envio interrompido: a instância precisa de atenção.";
        resultados.push({ status: "interrompido", motivo });
        await registrarFalha(db, { companyId: null, diaAlerta: dia, motivo, tipo: "interrompido" });
        for (const restante of mensagens.slice(i + 1)) {
          await enfileirarAlerta(db, restante, { tentativas: 0 });
        }
        break;
      }
    }

    if (THROTTLE_S > 0) await espera(THROTTLE_S * 1000);
  }

  return {
    dia,
    enviados,
    falhas,
    ignorados,
    selecionados: selecionadas ? selecionadas.size : null,
    resultados,
  };
}

/**
 * Uma re-tentativa em falha transitória. Token inválido não se repete: precisa de gente.
 */
async function enviarComRetry({ numero, texto, tentativas = 2 }) {
  let ultimo;
  for (let i = 0; i < tentativas; i += 1) {
    try {
      return await uazapi.enviarTexto({ numero, texto, delayMs: DELAY_DIGITANDO_MS });
    } catch (err) {
      if (err instanceof uazapi.UazapiTokenInvalido) throw err;
      ultimo = err;
      console.warn(`[alertas] envio falhou (${i + 1}/${tentativas}): ${err.message}`);
      if (i + 1 < tentativas) await espera(800 * (i + 1));
    }
  }
  throw ultimo;
}

/**
 * Enfileira uma mensagem JÁ COMPOSTA para reenvio. Idempotente por (empresa, dia): se já
 * está na fila, respeita o que lá está; se já foi entregue (alert_sends), nem entra.
 *
 * `tentativas` já conta a tentativa que acabou de falhar (1), ou 0 quando a mensagem nem
 * chegou a ser tentada (teto de hora, interrupção por instância caída).
 */
async function enfileirarAlerta(db, m, { tentativas = 0 } = {}) {
  const { esgotou, proximaMin } = calcularBackoff(Math.max(1, tentativas), MAX_TENTATIVAS);
  const proxima = tentativas > 0 && !esgotou ? proximaMin : 0;
  const obrig = Array.isArray(m.obrigacoes) ? [...m.obrigacoes].sort().join(",") : String(m.obrigacoes || "");
  try {
    await db.query(
      `INSERT INTO alert_outbox
         (company_id, dia_alerta, obrigacoes, texto, incentivo_message_id, whatsapp,
          status, tentativas, proxima_tentativa_em)
       SELECT $1, $2::date, $3, $4, $5, $6, 'pendente', $7,
              now() + ($8 || ' minutes')::interval
        WHERE NOT EXISTS (
          SELECT 1 FROM alert_sends s WHERE s.company_id = $1 AND s.dia_alerta = $2::date
        )
       ON CONFLICT (company_id, dia_alerta) DO NOTHING`,
      [m.company_id, m.dia_alerta, obrig, m.texto, m.incentivo_id ?? null, m.whatsapp ?? null, tentativas, String(proxima)]
    );
  } catch (err) {
    console.error("[alertas] enfileirar:", err.message);
  }
}

/**
 * Reprocessa a fila: pega os pendentes cuja hora de re-tentativa já chegou, tenta
 * entregar com as MESMAS travas do envio direto e atualiza o estado. Expira antes o que
 * está pendente há dias demais. Ao esgotar as tentativas de uma mensagem, ela vira falha
 * definitiva e o escritório é avisado.
 */
async function drenarOutbox(db) {
  if (!uazapi.configurado()) return { enviados: 0, definitivas: 0, tentadas: 0 };

  // Trava de horário diurno: não entrega mensagem de madrugada. O backoff exponencial
  // pode agendar a próxima tentativa para as 02h, mas o cliente não pode receber WhatsApp
  // a essa hora. Mesma janela do resto do sistema (janelaEnvio.js).
  if (!dentroDaJanela(minutosSP())) return { enviados: 0, definitivas: 0, tentadas: 0 };

  // Aviso velho demais não deve mais ser entregue — vira falha definitiva.
  const { rows: expiradas } = await db.query(
    `UPDATE alert_outbox
        SET status = 'falhou',
            ultimo_erro = 'Expirado: pendente há mais de ' || $1::text || ' dia(s).',
            atualizado_em = now()
      WHERE status = 'pendente'
        AND dia_alerta < (current_date - $1::int)
      RETURNING company_id, dia_alerta::text AS dia_alerta`,
    [OUTBOX_EXPIRA_DIAS]
  );
  for (const e of expiradas) {
    await registrarFalha(db, {
      companyId: e.company_id, diaAlerta: e.dia_alerta,
      motivo: "Aviso expirou na fila (não entregue a tempo).", tipo: "falhou",
    });
  }

  // Fecha o que já foi entregue por outro caminho (ex.: envio manual depois).
  await db.query(
    `UPDATE alert_outbox o
        SET status = 'enviado', atualizado_em = now()
      WHERE o.status = 'pendente'
        AND EXISTS (SELECT 1 FROM alert_sends s
                     WHERE s.company_id = o.company_id AND s.dia_alerta = o.dia_alerta)`
  );

  const { rows } = await db.query(
    `SELECT o.id, o.company_id, o.dia_alerta::text AS dia_alerta, o.obrigacoes, o.texto,
            o.incentivo_message_id, o.whatsapp, o.tentativas
       FROM alert_outbox o
      WHERE o.status = 'pendente' AND o.proxima_tentativa_em <= now()
      ORDER BY o.criado_em
      LIMIT 500`
  );

  const meuNumero = await uazapi.owner();
  let enviados = 0;
  let definitivas = expiradas.length;

  for (const o of rows) {
    const v = numeroWpp.validar(o.whatsapp);
    if (!v.ok || (meuNumero && v.numero === meuNumero)) {
      // Problema de cadastro: retentar não resolve. Fecha como ignorado.
      const motivo = v.ok ? "É o próprio número da instância." : v.motivo;
      await db.query(`UPDATE alert_outbox SET status='ignorado', ultimo_erro=$2, atualizado_em=now() WHERE id=$1`, [o.id, motivo]);
      await registrarFalha(db, { companyId: o.company_id, diaAlerta: o.dia_alerta, motivo, tipo: "ignorado" });
      continue;
    }
    if (!sobOTeto()) break; // teto de hora: o resto continua pendente para o próximo ciclo

    try {
      await enviarComRetry({ numero: v.numero, texto: o.texto });
      marcarEnviado();
      enviados += 1;
      await registrarEnvio(db, {
        companyId: o.company_id,
        obrigacoes: o.obrigacoes ? o.obrigacoes.split(",") : [],
        diaAlerta: o.dia_alerta,
        texto: o.texto,
        incentivoId: o.incentivo_message_id,
      });
      if (o.incentivo_message_id) {
        await trechoDeIncentivo(db, { companyId: o.company_id, portalUrl: portalUrl("/"), simular: false });
      }
      // Anexa o(s) PDF(s) do(s) boleto(s) também no reenvio pela fila. Os ids vêm do
      // `obrigacoes` salvo na outbox (CSV com `BOLETO:<uuid>`). Best-effort, igual ao
      // envio direto.
      const pdfFila = await enviarBoletosPdf(db, {
        companyId: o.company_id, obrigacoes: o.obrigacoes, numero: v.numero, marcar: marcarEnviado,
      });
      if (pdfFila.enviados) console.log(`[alertas] fila: ${pdfFila.enviados} boleto(s) PDF anexado(s).`);
      await db.query(`UPDATE alert_outbox SET status='enviado', atualizado_em=now() WHERE id=$1`, [o.id]);
    } catch (err) {
      const tentativas = (o.tentativas || 0) + 1;
      if (err instanceof uazapi.UazapiTokenInvalido) {
        // Instância caída: não gasta tentativa, tenta no próximo ciclo. Para o laço.
        await db.query(
          `UPDATE alert_outbox SET ultimo_erro=$2, proxima_tentativa_em = now() + interval '15 minutes', atualizado_em=now() WHERE id=$1`,
          [o.id, err.message]
        );
        break;
      }
      const { esgotou, proximaMin } = calcularBackoff(tentativas, MAX_TENTATIVAS);
      if (esgotou) {
        await db.query(`UPDATE alert_outbox SET status='falhou', tentativas=$2, ultimo_erro=$3, atualizado_em=now() WHERE id=$1`, [o.id, tentativas, err.message]);
        await registrarFalha(db, {
          companyId: o.company_id, diaAlerta: o.dia_alerta,
          motivo: `Falha definitiva após ${tentativas} tentativas: ${err.message}`, tipo: "falhou",
        });
        definitivas += 1;
      } else {
        await db.query(
          `UPDATE alert_outbox SET tentativas=$2, ultimo_erro=$3, proxima_tentativa_em = now() + ($4 || ' minutes')::interval, atualizado_em=now() WHERE id=$1`,
          [o.id, tentativas, err.message, String(proximaMin)]
        );
      }
    }
    if (THROTTLE_S > 0) await espera(THROTTLE_S * 1000);
  }

  if (definitivas > 0) await avisarEscritorio(db, definitivas);
  return { enviados, definitivas, tentadas: rows.length };
}

/** Aviso ativo ao escritório quando mensagens esgotam as re-tentativas. */
async function avisarEscritorio(db, quantas) {
  try {
    const { escritorio_whatsapp: numero } = await lerConfig(db);
    if (!numero) return; // sem número configurado: a falha fica só no Dashboard.
    const v = numeroWpp.validar(numero);
    if (!v.ok) return;
    const texto =
      `⚠️ *Alertas Nescon:* ${quantas} mensagem(ns) não foram entregues e esgotaram as re-tentativas.\n\n` +
      `Confira em *Alertas → Dashboard* e verifique o WhatsApp/instância.`;
    await uazapi.enviarTexto({ numero: v.numero, texto, delayMs: 0 });
  } catch (err) {
    console.error("[alertas] aviso ao escritório:", err.message);
  }
}

/** Hora local de São Paulo (0-23). O servidor roda em UTC. */
function horaSP(agora = new Date()) {
  return Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(agora)
  );
}

let ultimoDiaExecutado = null;

/**
 * Agendador diário. Confere de quinze em quinze minutos se já deu a hora — em vez de
 * calcular o próximo disparo e dormir horas, que é o que quebra quando o processo
 * reinicia. Se o portal subir às 10h e a hora era 8h, o dia de hoje não é reenviado:
 * a marca em memória e o índice único no banco cuidam disso.
 */
function iniciarAgendadorAlertas(db) {
  console.log("[alertas] agendador de pé; ligar/desligar é na tela (Alertas → Configuração).");

  const tique = async () => {
    try {
      // A configuração é lida A CADA CICLO, não no arranque: ligar o envio na tela passa
      // a valer no próximo quarto de hora, sem redeploy. Era esse o custo de guardar a
      // decisão numa variável de ambiente.
      const cfg = await lerConfig(db);

      // Reprocessa a fila TODO ciclo (a cada 15 min), ANTES da checagem de automático:
      // reenviar o que já foi decidido (manual ou automático) e falhou não depende do
      // envio automático estar ligado — inclui falhas de dias anteriores, até entregar.
      try {
        const d = await drenarOutbox(db);
        if (d.enviados || d.definitivas) {
          console.log(`[alertas] fila: ${d.enviados} reenviado(s), ${d.definitivas} definitiva(s).`);
        }
      } catch (err) {
        console.error("[alertas] drenar fila:", err.message);
      }

      // Fila do aviso de "documento novo" (janela 07:50–19h). Require tardio para não
      // criar ciclo com docNotify, que importa deste módulo. Roda antes do motor de
      // vencimento para o aviso das 07:50 sair na frente dos alertas das 08h.
      try {
        const { drenarDocNotify } = require("./docNotify");
        const dd = await drenarDocNotify(db);
        if (dd.enviados) console.log(`[docNotify] fila: ${dd.enviados} aviso(s) enviado(s).`);
      } catch (err) {
        console.error("[docNotify] drenar fila:", err.message);
      }

      if (!cfg.envio_automatico) return;

      const dia = hojeSP();
      if (ultimoDiaExecutado === dia) return;
      if (horaSP() < cfg.hora) return;
      // Só marca o dia como executado DENTRO da janela diurna. Se a hora configurada
      // cair fora dela (ex.: alguém pôs 06h), espera o próximo ciclo já dentro da janela
      // em vez de "queimar" o dia com um envio que a trava barraria mesmo assim.
      if (!dentroDaJanela(minutosSP())) return;
      ultimoDiaExecutado = dia;

      // Sync fresco da Cora ANTES de cobrar: fecha a janela de defasagem do agendador de
      // 6h. Sem isto, um boleto pago e já compensado, mas ainda não sincronizado, seria
      // cobrado. Best-effort — se a Cora estiver fora, cobra com o que há no banco. (A
      // carência de compensação em itensBoletoDoDia cobre o caso em que o pagamento ainda
      // nem compensou.)
      try {
        const coraSync = require("./coraSync");
        const rs = await coraSync.sincronizar();
        if (rs && rs.ok) {
          console.log(`[alertas] sync Cora pré-cobrança: ${rs.atualizados ?? 0} atualizado(s).`);
        }
      } catch (err) {
        console.error("[alertas] sync Cora pré-cobrança:", err.message);
      }

      const r = await enviarAlertasDoDia(db, { data: dia });

      // Cobrança de HONORÁRIO — motor próprio, mensagem em 2 fases. Roda 1x/dia junto do
      // alerta geral, mas é independente: só vale a partir de set/2026 (trava no módulo),
      // só dias úteis, respeita carência de compensação e checa a Cora antes de cobrar.
      try {
        const { cobrarHonorarios } = require("./honorariosCobranca");
        const rh = await cobrarHonorarios({ agora: new Date() });
        if (rh.enviados || rh.erros?.length) {
          console.log(`[honorarios] ${dia}: ${rh.enviados} cobrado(s), ${rh.pulados} pulado(s), ${rh.erros.length} erro(s).`);
        } else if (rh.motivo) {
          console.log(`[honorarios] ${dia}: nada a cobrar (${rh.motivo}).`);
        }
      } catch (err) {
        console.error("[honorarios] cobrança do dia:", err.message);
      }

      console.log(
        `[alertas] ${dia}: ${r.enviados} enviado(s), ${r.falhas} falha(s), ${r.ignorados} ignorado(s).`
      );
    } catch (err) {
      console.error("[alertas] ciclo diário:", err.message);
    }
  };

  setInterval(tique, 15 * 60 * 1000);
  setTimeout(tique, 60 * 1000); // uma checagem logo após o arranque
}

module.exports = {
  enviarAlertasDoDia,
  iniciarAgendadorAlertas,
  drenarOutbox,
  enfileirarAlerta,
  calcularBackoff,
  horaSP,
  enviarComRetry,
  sobOTeto,
  marcarEnviado,
};
