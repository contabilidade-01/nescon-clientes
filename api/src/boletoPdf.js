/**
 * Anexo de boleto (PDF) nos alertas automáticos de vencimento/cobrança.
 *
 * O motor de alertas (`alertasEnvio.js`) manda TEXTO. Este módulo é o passo que faltava:
 * logo depois do texto, anexa o(s) PDF(s) do(s) boleto(s) citado(s) — tanto no lembrete
 * ("boleto a pagar") quanto na cobrança ("boleto em atraso"), honorário ou não.
 *
 * ## Por que dá para fazer sem mexer no schema
 *
 * Os ids dos boletos da mensagem já viajam no campo `obrigacoes` como `BOLETO:<uuid>`
 * (ver `alertas.js` → `itensBoletoDoDia`/`registrarEnvio`). No envio direto isso é um
 * array; na fila `alert_outbox` é a mesma lista salva como texto separado por vírgula.
 * Os dois caminhos chegam aqui, e daqui extraímos os ids.
 *
 * ## Duas decisões de robustez
 *
 * 1. **URL buscada FRESCA na Cora** no momento do envio. O `pdf_url` gravado no sync pode
 *    ter horas/dias — e a URL de bank_slip da Cora expira. Reenviar o link velho entrega
 *    um PDF quebrado. Buscamos o detalhe na hora; só caímos no `pdf_url` gravado se a Cora
 *    não responder. Isso também contorna o `PDF_CORTE` do coraSync: mesmo boleto antigo
 *    sem `pdf_url` gravado consegue o arquivo aqui, sob demanda.
 * 2. **Best-effort: nunca lança.** O texto (o alerta de verdade) já saiu, e a mensagem
 *    ainda traz o link do portal como plano B. Falhar o anexo NÃO pode desfazer o texto
 *    nem re-enfileirar a mensagem (reenviaria o texto). Toda falha aqui é logada e segue.
 */
const cora = require("./cora");
const uazapi = require("./uazapi");

// Chave de liga/desliga rápido — se algo der errado em produção, desligar sem redeploy
// do código (só a env) e o alerta volta a ser texto puro.
const PDF_ATIVO = process.env.ALERTAS_BOLETO_PDF !== "false";

/** Extrai os UUIDs dos códigos `BOLETO:<uuid>`. Aceita array (envio direto) ou string CSV (fila). */
function idsDeBoleto(obrigacoes) {
  const arr = Array.isArray(obrigacoes) ? obrigacoes : String(obrigacoes || "").split(",");
  return arr
    .filter((c) => typeof c === "string" && c.startsWith("BOLETO:"))
    .map((c) => c.slice("BOLETO:".length).trim())
    // UUID canônico: 8-4-4-4-12 hex. Estreito de propósito — o valor entra num cast
    // `::uuid[]` e um lixo aqui derrubaria a query inteira.
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
}

/**
 * URL do PDF do boleto, preferindo a versão FRESCA da Cora. `externalRef` é
 * `cora_<invoiceId>`. Cai para `pdfUrlGravado` se a Cora não devolver.
 */
async function urlPdfFresca(externalRef, pdfUrlGravado, coraDep = cora) {
  const invoiceId = String(externalRef || "").replace(/^cora_/, "");
  if (invoiceId) {
    try {
      const detalhe = await coraDep.getInvoiceDetail(invoiceId);
      const url = detalhe?.payment_options?.bank_slip?.url || null;
      if (url) return url;
    } catch (err) {
      console.error(`[boletoPdf] detalhe ${invoiceId}:`, err.message);
    }
  }
  return pdfUrlGravado || null;
}

function nomeArquivo(empresa, venc) {
  const emp = String(empresa || "Boleto").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
  return `Boleto_${emp}_${String(venc || "").replace(/\//g, "-")}.pdf`;
}

/**
 * Envia os PDFs dos boletos de UMA mensagem de alerta, logo após o texto.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.companyId
 * @param {string[]|string} opts.obrigacoes  Códigos da mensagem (array ou CSV).
 * @param {string} opts.numero               WhatsApp já validado/normalizado.
 * @param {number} [opts.delayMs=1500]
 * @param {function} [opts.marcar]           Chamado a cada PDF enviado (teto/hora do motor).
 * @returns {{enviados:number, erros:Array, pulado?:string}}
 */
async function enviarBoletosPdf(db, { companyId, obrigacoes, numero, delayMs = 1500, marcar = null } = {}, deps = {}) {
  // Injeção opcional para teste hermético (segue o padrão de DI do repo). Em produção,
  // ambos caem nos módulos reais.
  const coraDep = deps.cora || cora;
  const uazapiDep = deps.uazapi || uazapi;

  if (!PDF_ATIVO) return { enviados: 0, erros: [], pulado: "desligado" };

  const ids = idsDeBoleto(obrigacoes);
  if (!ids.length) return { enviados: 0, erros: [] };
  if (!coraDep.isConfigured() || !uazapiDep.configurado()) {
    return { enviados: 0, erros: [], pulado: "cora/uazapi indisponível" };
  }

  let rows;
  try {
    ({ rows } = await db.query(
      `SELECT d.id, d.external_ref, d.pdf_url, d.valor_centavos, d.is_honorario,
              to_char(d.due_date, 'DD/MM/YYYY') AS venc,
              c.name AS empresa
         FROM deliverables d
         JOIN companies c ON c.id = d.company_id
        WHERE d.company_id = $1 AND d.id = ANY($2::uuid[])
          AND d.source = 'cora' AND d.cancelado IS NOT TRUE`,
      [companyId, ids]
    ));
  } catch (err) {
    console.error("[boletoPdf] consulta boletos:", err.message);
    return { enviados: 0, erros: [{ motivo: err.message }] };
  }

  let enviados = 0;
  const erros = [];
  for (const b of rows) {
    try {
      const fileUrl = await urlPdfFresca(b.external_ref, b.pdf_url, coraDep);
      if (!fileUrl) {
        erros.push({ id: b.id, motivo: "sem PDF disponível" });
        continue;
      }
      const valor = b.valor_centavos
        ? (b.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : "";
      const rotulo = b.is_honorario ? "Honorários" : "Boleto";
      const caption =
        `📄 *${rotulo} — ${b.empresa}*` +
        (b.venc ? `\nVencimento: ${b.venc}` : "") +
        (valor ? `\nValor: ${valor}` : "");

      await uazapiDep.enviarDocumento({
        numero,
        fileUrl,
        docName: nomeArquivo(b.empresa, b.venc),
        caption,
        delayMs,
      });
      if (typeof marcar === "function") marcar();
      enviados += 1;
    } catch (err) {
      // Best-effort: mesmo token inválido só é logado. O texto já saiu; não vale
      // interromper o resto por causa de um anexo.
      console.error(`[boletoPdf] enviar ${b.id}:`, err.message);
      erros.push({ id: b.id, motivo: err.message });
    }
  }
  return { enviados, erros };
}

module.exports = { enviarBoletosPdf, idsDeBoleto, urlPdfFresca };
