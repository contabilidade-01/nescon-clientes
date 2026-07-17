/**
 * Extração da data de vencimento de guias em PDF.
 *
 * Porte da lógica já validada no sistema de guias (app/pdf_parser.py) — mantenha as
 * duas em sincronia ao acrescentar rótulos. Só é usada no upload MANUAL do escritório:
 * nas guias automáticas o vencimento já chega lido pelo sistema de guias.
 *
 * Política: nunca chuta. Sem rótulo conhecido por perto, devolve null e o admin informa
 * a data à mão — melhor pedir do que publicar vencimento errado.
 */

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

module.exports = { extrairVencimento, ROTULOS_VENCIMENTO };
