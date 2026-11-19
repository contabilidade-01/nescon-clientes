/**
 * Anexa o PDF da GUIA (FGTS, INSS/DCTF Web, DAS) ao aviso de vencimento, logo depois do
 * texto. Pedido de Jeandson (19/11/2026): nos dois avisos (véspera e dia) a guia vai
 * junto, e o cliente abre sem login.
 *
 * O arquivo sai pelo link público do documento (`/api/deliverables/public/<token>/file`,
 * o mesmo das guias do MEI): a uazapi baixa de lá e entrega como documento no WhatsApp.
 * O token é opaco e o link só funciona para documento liberado.
 *
 * Best-effort, como o PDF do boleto: o texto já saiu com o link do portal, então uma
 * falha aqui não desfaz o envio — só fica no log e no retorno.
 *
 * Funciona igual no envio direto e no reenvio pela fila, porque parte só do que os dois
 * têm: empresa, códigos de obrigação da mensagem e dia do aviso.
 */
const uazapi = require("./uazapi");
const { obrigacao } = require("./obrigacoes");
const { somarDias, ddmm } = require("./diasBancarios");

const ATIVO = process.env.ALERTAS_GUIA_PDF !== "false";
// O aviso cobre no máximo a véspera de um feriado prolongado (ex.: quinta avisando o DAS
// de segunda). 7 dias dá folga sem pegar a guia do mês seguinte.
const JANELA_DIAS = 7;

function urlPublica(token) {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base && token ? `${base}/api/deliverables/public/${token}/file` : null;
}

/** Códigos da mensagem (array ou CSV da fila) → doc_types de guia. Função pura. */
function docTypesDaMensagem(obrigacoes) {
  const codigos = Array.isArray(obrigacoes) ? obrigacoes : String(obrigacoes || "").split(",");
  const tipos = new Set();
  for (const c of codigos) {
    const o = obrigacao(String(c || "").trim());
    if (o) for (const t of o.docTypes) tipos.add(t);
  }
  return [...tipos];
}

/** Nome do arquivo no WhatsApp: "FGTS - vence 19-11.pdf". */
function nomeArquivo(titulo, venc) {
  const base = String(titulo || "Guia").replace(/[\\/:*?"<>|]/g, "-").trim() || "Guia";
  return `${base} - vence ${ddmm(venc).replace("/", "-")}.pdf`;
}

async function enviarGuiasPdf(db, { companyId, obrigacoes, diaAlerta, numero, delayMs = 1500, marcar = null } = {}, deps = {}) {
  const uaz = deps.uazapi || uazapi;
  if (!ATIVO) return { enviados: 0, erros: [], pulado: "desligado" };
  const tipos = docTypesDaMensagem(obrigacoes);
  if (!tipos.length || !diaAlerta) return { enviados: 0, erros: [] };
  if (!uaz.configurado()) return { enviados: 0, erros: [], pulado: "uazapi indisponível" };

  let rows;
  try {
    ({ rows } = await db.query(
      `SELECT DISTINCT ON (d.doc_type)
              d.id, d.doc_type, d.title, d.access_token,
              to_char(d.due_date, 'YYYY-MM-DD') AS venc
         FROM deliverables d
        WHERE d.company_id = $1
          AND d.doc_type = ANY($2::text[])
          AND d.released_at IS NOT NULL
          AND d.historico IS NOT TRUE
          AND d.cancelado IS NOT TRUE
          AND d.status IS DISTINCT FROM 'paid'
          AND d.file_path IS NOT NULL
          AND d.due_date BETWEEN $3::date AND $4::date
        ORDER BY d.doc_type, d.due_date, d.created_at DESC`,
      [companyId, tipos, diaAlerta, somarDias(diaAlerta, JANELA_DIAS)]
    ));
  } catch (err) {
    console.error("[guiaPdf] consulta guias:", err.message);
    return { enviados: 0, erros: [{ motivo: err.message }] };
  }

  let enviados = 0;
  const erros = [];
  for (const g of rows) {
    const fileUrl = urlPublica(g.access_token);
    if (!fileUrl) {
      erros.push({ id: g.id, motivo: "sem link público (PUBLIC_APP_URL ou token ausente)" });
      continue;
    }
    try {
      await uaz.enviarDocumento({
        numero,
        fileUrl,
        docName: nomeArquivo(g.title, g.venc),
        caption: `${g.title} — vence ${ddmm(g.venc)}`,
        delayMs,
      });
      if (marcar) marcar();
      enviados += 1;
    } catch (err) {
      erros.push({ id: g.id, motivo: err.message });
    }
  }
  if (erros.length) console.error(`[guiaPdf] ${companyId}: ${erros.length} guia(s) sem anexo:`, JSON.stringify(erros));
  return { enviados, erros };
}

module.exports = { enviarGuiasPdf, docTypesDaMensagem, nomeArquivo };
