/**
 * Detecção de CNPJ em PDFs com fallback para IA.
 * 3 níveis em cascata: regex puro → busca contextual → IA
 */

const { extrairTexto, onlyDigits, validarDigitosCnpj } = require("./pdfCnpj");
const { getSetting } = require("./appSettings");

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

  const provider = (await getSetting(db, "provider_ia_cnpj")) || "claude";
  const limiar = Number(await getSetting(db, "ia_cnpj_limiar_confianca")) || 85;
  const timeout = Number(await getSetting(db, "ia_cnpj_timeout_ms")) || 30000;

  try {
    const resultado = await chamarIaParaCnpj(texto, provider, db, timeout);

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
 * Chamada para IA com suporte a múltiplos provedores.
 */
async function chamarIaParaCnpj(texto, provider, db, timeout) {
  const chave = await obterChaveApi(provider, db);
  if (!chave) {
    throw new Error(`Sem credencial para provider ${provider}`);
  }

  const prompt = `Você é um especialista em leitura de documentos fiscais brasileiros.

Extraia o CNPJ do texto do documento abaixo. Retorne APENAS um JSON válido:
{"cnpj": "XXXXXXXXXXXXX", "confianca": 95, "motivo": "encontrado após 'Contribuinte'"}

Se não encontrar CNPJ, retorne:
{"cnpj": null, "confianca": 0, "motivo": "nenhum padrão de CNPJ detectado"}

Confiança = número 0-100, onde 100 é certeza total.

--- DOCUMENTO ---
${texto.slice(0, 2000)}
--- FIM ---`;

  if (provider === "claude") {
    return await chamarClaude(prompt, chave, timeout);
  } else if (provider === "gemini") {
    return await chamarGemini(prompt, chave, timeout);
  } else if (provider === "chatgpt") {
    return await chamarChatGpt(prompt, chave, timeout);
  } else {
    throw new Error(`Provider desconhecido: ${provider}`);
  }
}

async function obterChaveApi(provider, db) {
  const chaveEnv = {
    claude: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GOOGLE_API_KEY,
    chatgpt: process.env.OPENAI_API_KEY,
  }[provider];

  if (chaveEnv) return chaveEnv;

  const chaveDb = await getSetting(db, `ia_api_key_${provider}`);
  return chaveDb || null;
}

async function chamarClaude(prompt, apiKey, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Claude API error: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const content = data.content[0]?.text || "";
    const json = JSON.parse(content);
    return json;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function chamarGemini(prompt, apiKey, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 256 },
        }),
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Gemini API error: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const json = JSON.parse(content);
    return json;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function chamarChatGpt(prompt, apiKey, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 256,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`ChatGPT API error: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const content = data.choices[0]?.message?.content || "";
    const json = JSON.parse(content);
    return json;
  } finally {
    clearTimeout(timeoutId);
  }
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
