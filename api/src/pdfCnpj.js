/**
 * Extração de CNPJ de PDFs.
 *
 * Lê o texto do PDF e procura padrões de CNPJ. Devolve o primeiro encontrado
 * (normalizado, só dígitos) ou null.
 */

// As âncoras `(?<!\d)` e `(?!\d)` são o que impede fatiar 14 dígitos de dentro de um
// número maior. Guia tem linha digitável de 44 a 48 dígitos, e sem as âncoras o regex
// recorta pedaços dela: cerca de 1% de qualquer sequência de 14 dígitos passa no
// dígito verificador, então de tempos em tempos apareceria um "CNPJ" que nunca existiu.
const RE_CNPJ = /(?<!\d)(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/g;

function onlyDigits(s) {
  return (s || "").replace(/\D/g, "");
}

function validarDigitosCnpj(cnpj) {
  const d = onlyDigits(cnpj);
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false;

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(d[i]) * pesos1[i];
  let resto = soma % 11;
  const dig1 = resto < 2 ? 0 : 11 - resto;
  if (Number(d[12]) !== dig1) return false;

  soma = 0;
  for (let i = 0; i < 13; i++) soma += Number(d[i]) * pesos2[i];
  resto = soma % 11;
  const dig2 = resto < 2 ? 0 : 11 - resto;
  return Number(d[13]) === dig2;
}

async function extrairTexto(pdfBuffer) {
  try {
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: pdfBuffer });
    const { text } = await parser.getText();
    try { await parser.destroy(); } catch {}
    return text || "";
  } catch (err) {
    console.error("[pdfCnpj] falha ao ler o PDF:", err.message);
    return "";
  }
}

/**
 * Extrai CNPJs de um buffer PDF.
 * Retorna array de CNPJs válidos (só dígitos), sem duplicatas, na ordem de aparição.
 */
async function extrairCnpjs(pdfBuffer) {
  const texto = await extrairTexto(pdfBuffer);
  if (!texto) return [];

  const matches = texto.match(RE_CNPJ) || [];
  const vistos = new Set();
  const resultado = [];

  for (const m of matches) {
    const digits = onlyDigits(m);
    if (digits.length !== 14) continue;
    if (vistos.has(digits)) continue;
    if (!validarDigitosCnpj(digits)) continue;
    vistos.add(digits);
    resultado.push(digits);
  }

  return resultado;
}

module.exports = { extrairCnpjs, validarDigitosCnpj, onlyDigits };
