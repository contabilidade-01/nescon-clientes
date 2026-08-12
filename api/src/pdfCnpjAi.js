/**
 * Detecção de CNPJ em PDFs com fallback para IA.
 * 3 níveis em cascata: regex puro → busca contextual → IA
 */

const { extrairTexto, onlyDigits, validarDigitosCnpj } = require("./pdfCnpj");
const { getSetting } = require("./appSettings");
const { chamarIaConfigurada } = require("./iaProvider");

// Nível 1: Regex puro (já existe em pdfCnpj.js)
const RE_CNPJ = /(\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2})/g;

// Nível 2: Busca contextual — padrões que indicam proximidade de CNPJ
const PADROES_CONTEXTO = [
  /cnpj[:\s]+([\d./\-]{14,})/gi,
  /contribuinte[:\s]+([\d./\-]{14,})/gi,
  /empresa[:\s]+cnpj\s+([\d./\-]{14,})/gi,
  /cnpj[\s]+do[\s]+contribuinte[:\s]+([\d./\-]{14,})/gi,
];

/**
 * Nível 1: Extração simples com regex.
 * Retorna array de CNPJs válidos (só dígitos) sem duplicatas.
 */
function nivel1Regex(texto) {
  const matches = texto.match(RE_CNPJ) || [];
  const vistos = new Set();
  const resultado = [];

  for (const m of matches) {
    const digits = onlyDigits(m);
    if (digits.length !== 14) continue;
    if (vistos.has(digits)) continue;
    if (!validarDigitosCnpj(digits)) continue;
    vistos.add(digits);
    resultado.push({ cnpj: digits, confianca: 100, motivo: "regex puro" });
  }

  return resultado;
}

/**
 * Nível 2: Busca contextual com palavras-chave.
 * Procura por padrões que indicam CNPJ próximo.
 */
function nivel2Contextual(texto) {
  const vistos = new Set();
  const resultado = [];

  for (const padrao of PADROES_CONTEXTO) {
    let match;
    while ((match = padrao.exec(texto)) !== null) {
      const candidato = match[1] || match[0];
      const digits = onlyDigits(candidato);

      if (digits.length !== 14) continue;
      if (vistos.has(digits)) continue;
      if (!validarDigitosCnpj(digits)) continue;

      vistos.add(digits);
      resultado.push({
        cnpj: digits,
        confianca: 95,
        motivo: `encontrado com padrão "${padrao.source.slice(0, 30)}..."`,
      });
    }
  }

  return resultado;
}

/**
 * Nível 3: IA como fallback.
 * Chama o provider configurado (Claude, Gemini, ChatGPT).
 */
async function nivel3Ia(texto, db) {
  const habilitada = await getSetting(db, "ia_cnpj_habilitada");
  if (habilitada !== "true") return [];

  const limiar = Number(await getSetting(db, "ia_cnpj_limiar_confianca")) || 85;
  const timeout = Number(await getSetting(db, "ia_cnpj_timeout_ms")) || 30000;

  try {
    const resultado = await chamarIaParaCnpj(texto, db, timeout);

    if (!resultado) return [];

    const { cnpj, confianca, motivo } = resultado;

    if (confianca < limiar) {
      console.log(
        `[pdfCnpjAi] IA retornou CNPJ mas confiança ${confianca}% < limiar ${limiar}%`
      );
      return [];
    }

    if (!cnpj || onlyDigits(cnpj).length !== 14) return [];

    const digits = onlyDigits(cnpj);
    if (!validarDigitosCnpj(digits)) return [];

    return [{ cnpj: digits, confianca, motivo: `IA (${confianca}%): ${motivo}` }];
  } catch (err) {
    console.error("[pdfCnpjAi] erro ao chamar IA:", err.message);
    return [];
  }
}

/**
 * Monta o prompt de CNPJ e delega a chamada ao provedor configurado (iaProvider.js) —
 * mesma infraestrutura de provedor/chave/timeout reusada por outras tarefas de extração.
 */
async function chamarIaParaCnpj(texto, db, timeout) {
  const prompt = `Você é um especialista em leitura de documentos fiscais brasileiros.

Extraia o CNPJ do texto do documento abaixo. Retorne APENAS um JSON válido:
{"cnpj": "XXXXXXXXXXXXX", "confianca": 95, "motivo": "encontrado após 'Contribuinte'"}

Se não encontrar CNPJ, retorne:
{"cnpj": null, "confianca": 0, "motivo": "nenhum padrão de CNPJ detectado"}

Confiança = número 0-100, onde 100 é certeza total.

--- DOCUMENTO ---
${texto.slice(0, 2000)}
--- FIM ---`;

  const { resposta } = await chamarIaConfigurada(db, { prompt, timeoutMs: timeout });
  return resposta;
}

/**
 * Detecção em cascata: Nível 1 → Nível 2 → Nível 3 (IA)
 * Retorna primeiro resultado encontrado com confiança.
 */
async function detectarCnpjComFallback(pdfBuffer, db) {
  let texto = "";

  try {
    texto = await extrairTexto(pdfBuffer);
  } catch (err) {
    console.error("[pdfCnpjAi] falha ao extrair texto:", err.message);
    return { cnpjs: [], origem: "erro_leitura", aviso: "Não foi possível ler o PDF" };
  }

  if (!texto || texto.length < 10) {
    return { cnpjs: [], origem: "pdf_vazio", aviso: "PDF sem camada de texto legível" };
  }

  // Nível 1
  const nivel1 = nivel1Regex(texto);
  if (nivel1.length > 0) {
    return { cnpjs: nivel1.map((r) => r.cnpj), origem: "regex", confianca: 100 };
  }

  // Nível 2
  const nivel2 = nivel2Contextual(texto);
  if (nivel2.length > 0) {
    return { cnpjs: nivel2.map((r) => r.cnpj), origem: "busca_contextual", confianca: 95 };
  }

  // Nível 3
  const nivel3 = await nivel3Ia(texto, db);
  if (nivel3.length > 0) {
    return { cnpjs: nivel3.map((r) => r.cnpj), origem: "ia", confianca: nivel3[0].confianca, motivo: nivel3[0].motivo };
  }

  return { cnpjs: [], origem: "nenhum", aviso: "Nenhum CNPJ encontrado. Escolha a empresa manualmente." };
}

module.exports = {
  detectarCnpjComFallback,
  nivel1Regex,
  nivel2Contextual,
  nivel3Ia,
  chamarIaParaCnpj,
};
