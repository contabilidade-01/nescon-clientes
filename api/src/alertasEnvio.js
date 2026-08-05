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
const { previsao, registrarEnvio, registrarFalha } = require("./alertas");
const { trechoDeIncentivo } = require("./engagement");
const { hojeSP } = require("./diasBancarios");

function num(valor, padrao) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

const THROTTLE_S = num(process.env.ALERTAS_THROTTLE_S, 0.6);
const MAX_POR_HORA = Math.max(1, num(process.env.ALERTAS_MAX_POR_HORA, 180));
const DELAY_DIGITANDO_MS = Math.max(0, num(process.env.ALERTAS_DELAY_MS, 1200));
/** Hora local (São Paulo) em que a rotina diária dispara. */
const HORA_ENVIO = Math.min(23, Math.max(0, num(process.env.ALERTAS_HORA, 8)));

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Janela deslizante de uma hora, em memória. Reinicia a cada deploy — e tudo bem: o
// teto existe contra rajada dentro de uma execução, não como cota contábil.
let carimbos = [];

function sobOTeto() {
  const agora = Date.now();
  carimbos = carimbos.filter((t) => agora - t < 3600000);
  return carimbos.length < MAX_POR_HORA;
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
async function enviarAlertasDoDia(db, { data = null, apenasSimular = false } = {}) {
  const dia = data || hojeSP();

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

  // `simular: true` sempre: o texto é montado sem consumir o rodízio de mensagens de
  // incentivo. O consumo só acontece depois que a mensagem realmente sai.
  const { mensagens } = await previsao(db, { data: dia, simular: true });

  const meuNumero = apenasSimular ? null : await uazapi.owner();
  const resultados = [];
  let enviados = 0;
  let falhas = 0;
  let ignorados = 0;

  for (const m of mensagens) {
    // Registrar o motivo de NÃO ter avisado é tão importante quanto registrar o envio:
    // é o que o escritório precisa ver para corrigir cadastro em vez de descobrir o
    // problema pelo cliente reclamando que não recebeu.
    const anotar = async (motivo, tipo = "ignorado") => {
      if (!apenasSimular) await registrarFalha(db, { companyId: m.company_id, diaAlerta: dia, motivo, tipo });
    };

    const v = numeroWpp.validar(m.whatsapp);
    if (!v.ok) {
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
      ignorados += 1;
      const motivo = `Teto de ${MAX_POR_HORA} envios/hora atingido. O que sobrou sai na próxima execução.`;
      resultados.push({ empresa: m.empresa, company_id: m.company_id, status: "adiado", motivo });
      await anotar(motivo, "adiado");
      continue;
    }

    try {
      await enviarComRetry({ numero: v.numero, texto: m.texto });
      carimbos.push(Date.now());
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

      resultados.push({ empresa: m.empresa, company_id: m.company_id, status: "enviado", numero: v.numero });
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
      // Token inválido/desconectado não melhora na próxima empresa: para tudo aqui em
      // vez de colecionar o mesmo erro sessenta vezes.
      if (tokenRuim) {
        const motivo = "Envio interrompido: a instância precisa de atenção.";
        resultados.push({ status: "interrompido", motivo });
        await registrarFalha(db, { companyId: null, diaAlerta: dia, motivo, tipo: "interrompido" });
        break;
      }
    }

    if (THROTTLE_S > 0) await espera(THROTTLE_S * 1000);
  }

  return { dia, enviados, falhas, ignorados, resultados };
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
  if (process.env.ALERTAS_ENVIO_ATIVO !== "true") {
    console.log("[alertas] envio automático desligado (ALERTAS_ENVIO_ATIVO != true).");
    return;
  }
  console.log(`[alertas] envio automático ligado, às ${HORA_ENVIO}h (America/Sao_Paulo).`);

  const tique = async () => {
    try {
      const dia = hojeSP();
      if (ultimoDiaExecutado === dia) return;
      if (horaSP() < HORA_ENVIO) return;
      ultimoDiaExecutado = dia;
      const r = await enviarAlertasDoDia(db, { data: dia });
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

module.exports = { enviarAlertasDoDia, iniciarAgendadorAlertas, horaSP };
