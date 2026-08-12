/**
 * Extração da data de vencimento de guias em PDF.
 *
 * Porte da lógica já validada no sistema de guias (app/pdf_parser.py) — mantenha as
 * duas em sincronia ao acrescentar rótulos. Usada no upload manual do escritório e na
 * varredura em lote (dueDateSugestoes.js); nas guias automáticas o vencimento já chega
 * lido pelo sistema de guias.
 *
 * Política: nunca chuta. Sem rótulo conhecido por perto, devolve null — a IA
 * (extrairVencimentoComIa) tenta em seguida, e se também não achar, o admin informa a
 * data à mão. Melhor pedir do que publicar vencimento errado.
 */
const { chamarIaConfigurada } = require("./iaProvider");

// Rótulos onde a data costuma aparecer, do mais específico para o genérico.
const ROTULOS_VENCIMENTO = [
  String.raw`Data\s+de\s+Vencimento`,
  String.raw`Data\s+do?\s+Vencimento`,
  String.raw`Pagar\s+este\s+documento\s+at[eé]`, // FGTS Digital (GFD)
  String.raw`Pagar\s+at[eé]`,
  String.raw`Data\s+limite\s+(?:de|para)\s+pagamento`,
  String.raw`Data\s+de\s+Pagamento`,
  String.raw`Data\s+m[aá]xima\s+de\s+pagamento`,
  String.raw`Vencimento`, // genérico — por último
];

// Alguns layouts intercalam outros campos entre o rótulo e a data.
const JANELA_BUSCA = 220;

// DD/MM/AAAA ou DD-MM-AAAA, tolerante a espaços.
const RE_DATA = /(\b[0-3]?\d)[/\-.\s]([01]?\d)[/\-.\s]((?:19|20)\d{2})\b/;

async function extrairTexto(pdfBuffer) {
  let parser;
  try {
    const { PDFParse } = require("pdf-parse");
    parser = new PDFParse({ data: pdfBuffer });
    const { text } = await parser.getText();
    return text || "";
  } catch (err) {
    console.error("[pdfDueDate] falha ao ler o PDF:", err.message);
    return "";
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch { /* já liberado */ }
    }
  }
}

/** Valida o calendário de verdade: 31/02 não vira 03/03. */
function montarData(dia, mes, ano) {
  const d = Number(dia);
  const m = Number(mes);
  const a = Number(ano);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(a, m - 1, d);
  if (dt.getFullYear() !== a || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Devolve o vencimento como 'YYYY-MM-DD', ou null se não achar com confiança.
 */
async function extrairVencimento(pdfBuffer) {
  const texto = await extrairTexto(pdfBuffer);
  if (!texto) return null;

  const plano = texto.replace(/\s+/g, " ");

  for (const rotulo of ROTULOS_VENCIMENTO) {
    const pat = new RegExp(`${rotulo}.{0,${JANELA_BUSCA}}`, "gi");
    let m;
    while ((m = pat.exec(plano)) !== null) {
      const trecho = m[0];
      // Pula o próprio rótulo para não capturar uma data que venha ANTES dele.
      const fimRotulo = new RegExp(`^${rotulo}`, "i").exec(trecho);
      const depois = trecho.slice(fimRotulo ? fimRotulo[0].length : 0);
      const md = RE_DATA.exec(depois);
      if (md) {
        const iso = montarData(md[1], md[2], md[3]);
        if (iso) return iso;
      }
    }
  }
  return null;
}

/**
 * Fallback de IA quando o regex determinístico não encontra vencimento. Usa o mesmo
 * provedor configurado em /admin/config-ia (iaProvider.js) — nenhuma credencial nova.
 * Devolve null tanto para "não achou" quanto para "documento não tem vencimento
 * mesmo" — os dois casos são o mesmo resultado prático (nada para sugerir).
 */
async function extrairVencimentoComIa(pdfBuffer, db, { timeoutMs } = {}) {
  const texto = await extrairTexto(pdfBuffer);
  if (!texto || texto.length < 10) return null;

  const prompt = `Você é um especialista em leitura de documentos administrativos e fiscais brasileiros (contratos, guias, boletos, licenças, folha de pagamento, notificações).

Encontre a DATA DE VENCIMENTO (data limite de pagamento ou de validade) no texto abaixo, se houver. Retorne APENAS um JSON válido:
{"data": "AAAA-MM-DD", "confianca": 90, "motivo": "encontrado após 'Vencimento'"}

Se o documento genuinamente não tiver data de vencimento (ex.: holerite, recibo, extrato, contrato sem prazo definido), retorne:
{"data": null, "confianca": 0, "motivo": "documento sem data de vencimento identificável"}

Confiança = número 0-100, onde 100 é certeza total.

--- DOCUMENTO ---
${texto.slice(0, 3000)}
--- FIM ---`;

  try {
    const { resposta, provider } = await chamarIaConfigurada(db, { prompt, timeoutMs });
    if (!resposta || !resposta.data) return null;

    const md = RE_DATA.exec(String(resposta.data).replace(/-/g, "/"));
    const iso = md ? montarData(md[1], md[2], md[3]) : montarDataIso(resposta.data);
    if (!iso) return null;

    return { data: iso, confianca: Number(resposta.confianca) || 0, motivo: resposta.motivo || "", provider };
  } catch (err) {
    console.error("[pdfDueDate] IA falhou:", err.message);
    return null;
  }
}

/** Valida uma data já em 'AAAA-MM-DD' (o formato que a IA foi instruída a devolver). */
function montarDataIso(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || ""));
  if (!m) return null;
  return montarData(m[3], m[2], m[1]);
}

module.exports = {
  extrairVencimento,
  extrairVencimentoComIa,
  extrairTexto,
  ROTULOS_VENCIMENTO,
};
