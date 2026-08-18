/**
 * Cobrança de HONORÁRIOS — motor próprio, desacoplado do alerta geral (guias/tributos).
 *
 * Substitui a antiga régua de marcos fixos [1,3,5,10,15,30] bundlada na mensagem geral.
 * Agora é uma cadência de DUAS FASES, com mensagem própria por fase:
 *
 *   Fase 1 (as 2 primeiras cobranças): tom amigável mas FIRME — avisa que atraso > 5 dias
 *     leva ao bloqueio das entregas de declarações, cujas multas costumam superar o
 *     honorário. Sai na 1ª cobrança e repete +3 dias depois.
 *   Fase 2 (da 3ª cobrança em diante, a cada 10 dias até pagar): tom empático — explica a
 *     estrutura de custos, que as entregas ficam pausadas na inadimplência, que retomam
 *     após o pagamento, e que declarações em atraso podem sofrer juros.
 *
 * A FASE é decidida pela CONTAGEM de cobranças já enviadas (deliverables.honorario_
 * cobrancas_enviadas), não por dia do calendário — assim "após 2 mensagens" é literal,
 * mesmo que um envio tenha escorregado num fim de semana.
 *
 * Travas herdadas do fluxo antigo, todas mantidas:
 *   - Carência de compensação: 1ª cobrança só após N dias ÚTEIS do vencimento efetivo
 *     (D+2 por padrão), para não cobrar quem pagou e o boleto ainda não compensou.
 *   - Só dias úteis (seg–sex): dívida não se cobra no fim de semana.
 *   - Checagem FRESCA na Cora antes de cada envio: pula/marca pago o que já consta pago.
 *   - Subchave honorario_cobranca_ativo por empresa.
 *   - Anti-duplicação por intervalo (alert_sent_at): não reenvia antes do intervalo da fase.
 */
const db = require("./db");
const cora = require("./cora");
const uazapi = require("./uazapi");
const numeroWpp = require("./whatsappNumero");
const { urlPdfFresca } = require("./boletoPdf");
const { diasUteisAposVencimento } = require("./alertas");
const { hojeSP, minutosSP } = require("./diasBancarios");
const { ehDiaUtil, dentroDaJanela } = require("./janelaEnvio");

function num(v, padrao) {
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

// Cadência (env-overridable). Padrões conforme decidido: D+2 dias úteis, +3 dias na 2ª,
// depois a cada 10 dias até cair o pagamento; troca de fase após 2 mensagens.
const CARENCIA_DIAS_UTEIS = Math.max(0, num(process.env.HONORARIOS_CARENCIA_DIAS_UTEIS, 2));
const FASE1_QTD = Math.max(1, num(process.env.HONORARIOS_FASE1_QTD, 2));
const FASE1_INTERVALO_DIAS = Math.max(1, num(process.env.HONORARIOS_FASE1_INTERVALO_DIAS, 3));
const FASE2_INTERVALO_DIAS = Math.max(1, num(process.env.HONORARIOS_FASE2_INTERVALO_DIAS, 10));
const PAUSA_ENTRE_ENVIOS_MS = Math.max(0, num(process.env.HONORARIOS_PAUSA_MS, 3000));

// Início da metodologia: só vale a partir de SETEMBRO/2026. Dois travões independentes
// para ser robusto:
//   1. Guarda de data: o motor não faz NADA antes de INICIO_ISO — nem que existam boletos
//      vencidos. Garante que "esse mês (ago/2026) não" seja respeitado mesmo que o deploy
//      suba antes de setembro.
//   2. Piso de competência: só cobra honorários de competência >= COMPETENCIA_MIN — assim,
//      quando setembro chegar, os boletos de AGOSTO não são varridos pela régua nova.
// Ambos configuráveis por env, mas com o padrão certo travado no código.
const INICIO_ISO = (process.env.HONORARIOS_COBRANCA_INICIO || "2026-09-01").trim();
const COMPETENCIA_MIN = (process.env.HONORARIOS_COBRANCA_COMPETENCIA_MIN || "2026-09").trim();

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function portalBase() {
  return (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
}

/** Fase (1|2) a partir de quantas cobranças já saíram. */
function faseDe(count) {
  return count < FASE1_QTD ? 1 : 2;
}

/**
 * Decide se ESTE honorário deve ser cobrado agora. Função pura (sem banco): recebe o
 * estado e devolve { cobrar, fase, motivo }.
 *
 * @param {number} count               cobranças já enviadas
 * @param {number} diasUteisAtraso     dias úteis desde o vencimento efetivo
 * @param {number} diasDesdeUltimoEnvio dias corridos desde a última cobrança (Infinity se nunca)
 */
function decidirCobranca({ count, diasUteisAtraso, diasDesdeUltimoEnvio }) {
  if (count === 0) {
    // 1ª cobrança: só depois da carência de compensação.
    if (diasUteisAtraso < CARENCIA_DIAS_UTEIS) {
      return { cobrar: false, fase: 1, motivo: "dentro da carência de compensação" };
    }
    return { cobrar: true, fase: 1 };
  }
  // Reenvios: respeitam o intervalo da fase ATUAL.
  const intervalo = count < FASE1_QTD ? FASE1_INTERVALO_DIAS : FASE2_INTERVALO_DIAS;
  if (diasDesdeUltimoEnvio < intervalo) {
    return { cobrar: false, fase: faseDe(count), motivo: `aguardando intervalo de ${intervalo} dias` };
  }
  return { cobrar: true, fase: faseDe(count) };
}

/** "2026-08" → "08/2026". Devolve "" se não der para formatar. */
function competenciaBR(competencia) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ""));
  return m ? `${m[2]}/${m[1]}` : "";
}

function valorBR(centavos) {
  const n = Number(centavos);
  if (!Number.isFinite(n) || n <= 0) return "";
  return (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Monta o texto da cobrança conforme a fase. Função pura.
 */
function montarMensagemHonorario({ empresa, competencia, valor, venc, diasAtraso, fase, portal }) {
  const comp = competenciaBR(competencia);
  const linhaComp = comp ? ` de *${comp}*` : "";
  const ha = diasAtraso === 1 ? "há 1 dia" : `há ${diasAtraso} dias`;
  const linhaBoleto = `• Honorários${comp ? ` ${comp}` : ""}${valor ? ` — *${valor}*` : ""} — venceu ${venc} (${ha})`;
  const linkBoleto = portal ? `📎 Boleto atualizado no portal: ${portal}/boletos` : "";

  if (fase === 1) {
    return [
      `Olá, *${empresa}*! 👋`,
      "",
      `Passando para lembrar que o pagamento dos honorários${linhaComp} ainda não foi identificado:`,
      linhaBoleto,
      "",
      "Se já pagou, por favor *desconsidere* esta mensagem. 🙏",
      "",
      "⚠️ *Importante:* honorários com mais de *5 dias de atraso* podem levar à *suspensão temporária das entregas de declarações e obrigações* ao governo. A falta dessas entregas costuma gerar *multas que superam o próprio valor dos honorários* — é justamente por isso que preferimos avisar com antecedência, para te poupar desse custo.",
      "",
      linkBoleto,
      "",
      "Qualquer dúvida, é só chamar — estamos à disposição. 🤝",
      "_Nescon Contabilidade_",
    ].filter((l) => l !== null).join("\n");
  }

  // Fase 2
  return [
    `Olá, *${empresa}*.`,
    "",
    `Sabemos que imprevistos acontecem, e queremos ajudar. 🤝 Mas precisamos ser transparentes com você: a mensalidade${linhaComp} segue em aberto:`,
    linhaBoleto,
    "",
    "O escritório mantém uma *estrutura de custos fixos* — incluindo o pagamento das ferramentas e sistemas usados para *transmitir suas declarações e obrigações*. Com a mensalidade em aberto, infelizmente não conseguimos sustentar essas entregas em dia.",
    "",
    "Assim que o pagamento for regularizado, *retomamos imediatamente as entregas*. Vale lembrar que declarações transmitidas em atraso podem sofrer *juros e multas* junto ao governo — por isso, quanto antes resolvermos, melhor para você.",
    "",
    linkBoleto,
    "",
    "Se já efetuou o pagamento, desconsidere. Seguimos à disposição para conversar. 🙏",
    "_Nescon Contabilidade_",
  ].filter((l) => l !== null).join("\n");
}

/** Nº de dias corridos entre um timestamp e agora (Infinity se null). */
function diasDesde(ts, agora = Date.now()) {
  if (!ts) return Infinity;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((agora - t) / 86400000);
}

/**
 * Roda a cobrança de honorários do dia. Só dias úteis e dentro da janela diurna.
 *
 * `simular: true` monta tudo e não envia nem grava — é a pré-visualização da tela.
 */
async function cobrarHonorarios({ simular = false, agora = new Date() } = {}) {
  const hoje = hojeSP(agora);
  // Travão 1: a metodologia só começa em setembro/2026. Antes disso, nada roda.
  if (hoje < INICIO_ISO) {
    return { enviados: 0, pulados: 0, erros: [], motivo: `metodologia inicia em ${INICIO_ISO}` };
  }
  if (!ehDiaUtil()) return { enviados: 0, pulados: 0, erros: [], motivo: "fim de semana/feriado" };
  if (!simular && !dentroDaJanela(minutosSP(agora))) {
    return { enviados: 0, pulados: 0, erros: [], motivo: "fora da janela diurna" };
  }
  if (!simular && !uazapi.configurado()) {
    return { enviados: 0, pulados: 0, erros: [], motivo: "uazapi não configurada" };
  }

  const { rows: boletos } = await db.query(
    `SELECT d.id, d.title, d.pdf_url, d.external_ref, d.valor_centavos, d.competencia,
            d.alert_sent_at, d.honorario_cobrancas_enviadas AS count,
            to_char(d.due_date, 'YYYY-MM-DD') AS due_date,
            c.name AS empresa_nome,
            COALESCE(NULLIF(c.whatsapp, ''), g.phone) AS whatsapp
       FROM deliverables d
       JOIN companies c ON c.id = d.company_id
       LEFT JOIN gclick_clients g ON g.company_id = c.id
      WHERE d.category = 'boleto'
        AND d.is_honorario = true
        AND d.status IS DISTINCT FROM 'paid'
        AND d.cancelado IS NOT TRUE
        AND d.released_at IS NOT NULL
        AND d.due_date IS NOT NULL
        AND d.due_date < $1::date
        -- Travão 2: só competência >= set/2026. Quando setembro chegar, não varre agosto.
        AND d.competencia IS NOT NULL
        AND d.competencia >= $2
        -- HIERARQUIA DE CHAVES POR EMPRESA (a mesma do motor geral). Clicar em qualquer
        -- uma bloqueia a cobrança deste cliente:
        --   • alertas_ativos = false      → chave-mestra: corta TUDO do cliente.
        --   • honorario_cobranca_ativo=false → só a cobrança de honorário.
        --   • arquivada/excluida          → cliente inativo não recebe mais nada.
        AND c.alertas_ativos IS TRUE
        AND c.arquivada IS NOT TRUE
        AND c.excluida IS NOT TRUE
        AND c.honorario_cobranca_ativo IS NOT FALSE
      ORDER BY d.due_date ASC`,
    [hoje, COMPETENCIA_MIN]
  );

  const resultados = [];
  let enviados = 0;
  let pulados = 0;
  const erros = [];
  const meuNumero = simular ? null : await uazapi.owner().catch(() => null);

  for (const b of boletos) {
    const count = Number(b.count) || 0;
    const diasUteisAtraso = diasUteisAposVencimento(b.due_date, hoje);
    const diasDesdeUltimoEnvio = diasDesde(b.alert_sent_at, agora.getTime());
    const decisao = decidirCobranca({ count, diasUteisAtraso, diasDesdeUltimoEnvio });

    if (!decisao.cobrar) {
      pulados += 1;
      resultados.push({ empresa: b.empresa_nome, status: "pulado", motivo: decisao.motivo });
      continue;
    }

    // Checagem fresca na Cora: não cobrar o que já consta pago/compensado lá.
    if (!simular) {
      try {
        const invoiceId = String(b.external_ref || "").replace(/^cora_/, "");
        if (invoiceId) {
          const detalhe = await cora.getInvoiceDetail(invoiceId);
          if (detalhe && detalhe.status && cora.mapCoraStatusToPortal(detalhe.status) === "paid") {
            await db.query("UPDATE deliverables SET status='paid', paid_at=now() WHERE id=$1", [b.id]);
            pulados += 1;
            resultados.push({ empresa: b.empresa_nome, status: "pulado", motivo: "já pago na Cora" });
            continue;
          }
        }
      } catch (e) {
        console.error("[honorarios] checagem Cora", b.id, e.message);
      }
    }

    const v = numeroWpp.validar(b.whatsapp);
    if (!v.ok || (meuNumero && v.numero === meuNumero)) {
      pulados += 1;
      const motivo = v.ok ? "é o próprio número da instância" : v.motivo;
      resultados.push({ empresa: b.empresa_nome, status: "ignorado", motivo });
      continue;
    }

    const venc = b.due_date ? b.due_date.split("-").reverse().join("/") : "";
    const diasAtraso = b.due_date
      ? Math.floor((agora.getTime() - new Date(b.due_date).getTime()) / 86400000)
      : 0;
    const texto = montarMensagemHonorario({
      empresa: b.empresa_nome,
      competencia: b.competencia,
      valor: valorBR(b.valor_centavos),
      venc,
      diasAtraso,
      fase: decisao.fase,
      portal: portalBase(),
    });

    if (simular) {
      resultados.push({ empresa: b.empresa_nome, status: "sairia", fase: decisao.fase, numero: v.numero, texto });
      continue;
    }

    try {
      const fileUrl = await urlPdfFresca(b.external_ref, b.pdf_url);
      const docName = `Honorarios_${String(b.empresa_nome).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}_${venc.replace(/\//g, "-")}.pdf`;
      if (fileUrl) {
        await uazapi.enviarDocumento({ numero: v.numero, fileUrl, docName, caption: texto, delayMs: 2000 });
      } else {
        // Sem PDF: manda ao menos o texto (com o link do portal como plano B).
        await uazapi.enviarTexto({ numero: v.numero, texto, delayMs: 1200 });
      }
      await db.query(
        `UPDATE deliverables
            SET alert_sent_at = now(),
                honorario_cobrancas_enviadas = COALESCE(honorario_cobrancas_enviadas, 0) + 1
          WHERE id = $1`,
        [b.id]
      );
      enviados += 1;
      resultados.push({ empresa: b.empresa_nome, status: "enviado", fase: decisao.fase, numero: v.numero });
    } catch (err) {
      erros.push({ empresa: b.empresa_nome, motivo: err.message });
      if (err instanceof uazapi.UazapiTokenInvalido) {
        erros.push({ empresa: "GERAL", motivo: "WhatsApp desconectado — cobrança interrompida" });
        break;
      }
    }

    if (PAUSA_ENTRE_ENVIOS_MS && boletos.indexOf(b) < boletos.length - 1) {
      await espera(PAUSA_ENTRE_ENVIOS_MS);
    }
  }

  if (!simular && (enviados || pulados)) {
    console.log(`[honorarios] cobrança do dia: ${enviados} enviado(s), ${pulados} pulado(s), ${erros.length} erro(s).`);
  }
  return { enviados, pulados, erros, resultados };
}

module.exports = {
  cobrarHonorarios,
  decidirCobranca,
  montarMensagemHonorario,
  faseDe,
  competenciaBR,
  diasDesde,
  // constantes expostas para a tela/diagnóstico
  cadencia: {
    CARENCIA_DIAS_UTEIS,
    FASE1_QTD,
    FASE1_INTERVALO_DIAS,
    FASE2_INTERVALO_DIAS,
    INICIO_ISO,
    COMPETENCIA_MIN,
  },
};
