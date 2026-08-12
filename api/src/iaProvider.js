/**
 * Chamada genérica ao provedor de IA configurado em /admin/config-ia (Claude, Gemini,
 * ChatGPT). Compartilhada por toda tarefa de extração que precisar de fallback de IA —
 * hoje CNPJ (pdfCnpjAi.js), amanhã vencimento (pdfDueDate.js) e o que vier depois.
 *
 * As chaves de configuração (provider_ia_cnpj, ia_cnpj_timeout_ms, ia_api_key_<provider>)
 * têm "cnpj" no nome por terem sido as primeiras a existir — mas guardam a escolha de
 * provedor do escritório inteiro, não algo específico de CNPJ. Cada tarefa decide, na
 * sua própria cascata, SE aciona a IA (seu próprio toggle "habilitada" e limiar de
 * confiança); esta função só sabe "chamar quem está configurado, com este prompt".
 */
const { getSetting, getSecretSetting } = require("./appSettings");

/**
 * Interpreta a resposta de texto do modelo como JSON, tolerante ao que os modelos
 * costumam fazer mesmo instruídos a devolver "só JSON":
 *  - embrulhar em cerca markdown (```json ... ``` ou ``` ... ```);
 *  - preceder/seguir de texto explicativo ("Aqui está: {...}").
 * Sem isso, uma resposta perfeitamente correta embrulhada em ```json quebrava com
 * "Unexpected token '`'" e a chamada inteira era descartada como falha.
 */
function parseJsonDoModelo(texto) {
  const bruto = String(texto || "").trim();
  // 1) Tira a cerca markdown, se houver (```json\n...\n``` ou ```\n...\n```).
  const semCerca = bruto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(semCerca);
  } catch {
    // 2) Último recurso: pega do primeiro { até o último } (texto antes/depois do JSON).
    const ini = semCerca.indexOf("{");
    const fim = semCerca.lastIndexOf("}");
    if (ini !== -1 && fim > ini) {
      return JSON.parse(semCerca.slice(ini, fim + 1));
    }
    throw new Error(`resposta da IA não é JSON: ${bruto.slice(0, 80)}`);
  }
}

async function obterChaveApi(provider, db) {
  const chaveEnv = {
    claude: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GOOGLE_API_KEY,
    chatgpt: process.env.OPENAI_API_KEY,
  }[provider];
  if (chaveEnv) return chaveEnv;

  const chaveDb = await getSecretSetting(db, `ia_api_key_${provider}`);
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
    return parseJsonDoModelo(content);
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
    return parseJsonDoModelo(content);
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
    return parseJsonDoModelo(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Chama o provedor de IA configurado com um prompt qualquer, esperando um JSON de volta
 * (o prompt de quem chama deve pedir explicitamente "responda em JSON"). Lança erro se
 * não houver credencial — quem chama decide se isso vira "sem sugestão" ou propaga.
 */
async function chamarIaConfigurada(db, { prompt, timeoutMs } = {}) {
  const provider = (await getSetting(db, "provider_ia_cnpj")) || "claude";
  const timeout = timeoutMs || Number(await getSetting(db, "ia_cnpj_timeout_ms")) || 30000;
  const chave = await obterChaveApi(provider, db);

  if (!chave) {
    throw new Error(`Sem credencial configurada para o provider ${provider}`);
  }

  let resposta;
  if (provider === "claude") resposta = await chamarClaude(prompt, chave, timeout);
  else if (provider === "gemini") resposta = await chamarGemini(prompt, chave, timeout);
  else if (provider === "chatgpt") resposta = await chamarChatGpt(prompt, chave, timeout);
  else throw new Error(`Provider desconhecido: ${provider}`);

  return { resposta, provider };
}

module.exports = { chamarIaConfigurada, obterChaveApi };
