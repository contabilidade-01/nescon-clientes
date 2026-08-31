/**
 * Cliente uazapi — porte enxuto do `app/uazapi.py` do sistema de guias.
 *
 * Lá o módulo cobre documento, botão, menu, fila assíncrona e encurtador, porque aquele
 * sistema manda PDF. **O alerta de vencimento é texto puro**, então aqui existe só o que
 * o alerta usa: `/send/text` e `/instance/status`. Menos superfície, menos coisa para
 * quebrar — e o dia em que o portal precisar mandar anexo, o porte do resto está a um
 * arquivo de distância.
 *
 * Os dois erros são distinguidos de propósito: token inválido/instância desconectada
 * exige ação humana e **não** deve ser repetido; qualquer outra falha é transitória e
 * merece nova tentativa. Confundir os dois faz o sistema martelar a API à toa quando o
 * QR code caiu.
 */

class UazapiNaoConfigurado extends Error {}
class UazapiTokenInvalido extends Error {}

function credenciais() {
  return {
    subdominio: (process.env.UAZAPI_SUBDOMAIN || "").trim(),
    token: (process.env.UAZAPI_TOKEN || "").trim(),
  };
}

function configurado() {
  const { subdominio, token } = credenciais();
  return Boolean(subdominio && token);
}

function baseUrl() {
  return `https://${credenciais().subdominio}.uazapi.com`;
}

function cabecalhos() {
  return { token: credenciais().token, "Content-Type": "application/json" };
}

async function chamar(caminho, { metodo = "GET", corpo = null, timeoutMs = 30000 } = {}) {
  if (!configurado()) {
    throw new UazapiNaoConfigurado("UAZAPI_SUBDOMAIN/UAZAPI_TOKEN não configurados.");
  }
  const controle = new AbortController();
  const t = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${caminho}`, {
      method: metodo,
      headers: cabecalhos(),
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controle.signal,
    });
    if (res.status === 401) {
      throw new UazapiTokenInvalido(
        "Token uazapi rejeitado ou instância desconectada. Confira o painel (status 'connected'?)."
      );
    }
    const texto = await res.text();
    if (!res.ok) throw new Error(`uazapi HTTP ${res.status}: ${texto.slice(0, 200)}`);
    try {
      return JSON.parse(texto);
    } catch {
      return {};
    }
  } finally {
    clearTimeout(t);
  }
}

/**
 * Manda um texto. `delayMs` faz a uazapi exibir "digitando…" antes de entregar — um
 * detalhe que faz a mensagem parecer menos robô.
 */
async function enviarTexto({ numero, texto, delayMs = 0 }) {
  const corpo = { number: numero, text: texto };
  if (delayMs > 0) corpo.delay = Math.floor(delayMs);
  return chamar("/send/text", { metodo: "POST", corpo, timeoutMs: 60000 });
}

/**
 * Envia um documento (PDF) via WhatsApp. `fileUrl` é a URL do PDF (ex: URL Cora).
 * `docName` é o nome que aparece no WhatsApp (ex: "Boleto_202608.pdf").
 * `caption` é o texto opcional que acompanha o documento.
 * `delayMs` faz a uazapi exibir "digitando…" antes de entregar.
 */
async function enviarDocumento({ numero, fileUrl, docName, caption = null, delayMs = 0 }) {
  const corpo = { number: numero, type: "document", file: fileUrl, docName };
  if (caption) corpo.text = caption;
  if (delayMs > 0) corpo.delay = Math.floor(delayMs);
  return chamar("/send/media", { metodo: "POST", corpo, timeoutMs: 60000 });
}

/**
 * Diagnóstico da instância, em formato pronto para a tela. Nunca lança: um painel que
 * quebra quando o WhatsApp cai é pior que um painel dizendo que o WhatsApp caiu.
 */
async function statusInstancia() {
  if (!configurado()) {
    return { ok: false, categoria: "nao_configurado", mensagem: "uazapi não configurada no ambiente." };
  }
  try {
    const j = await chamar("/instance/status", { timeoutMs: 15000 });
    const inst = j.instance || {};
    const status = inst.status || "desconhecido";
    if (status !== "connected") {
      return {
        ok: false,
        categoria: "desconectado",
        mensagem: `Instância está '${status}' (esperado 'connected'). Abra o painel e leia o QR code de novo.`,
      };
    }
    return {
      ok: true,
      categoria: "ok",
      mensagem: `Conectado ao número ${inst.owner ?? "?"} (${inst.profileName ?? "sem nome"}).`,
      owner: inst.owner ?? null,
    };
  } catch (err) {
    if (err instanceof UazapiTokenInvalido) {
      return { ok: false, categoria: "token_invalido", mensagem: err.message };
    }
    return { ok: false, categoria: "rede", mensagem: `Falha ao falar com a uazapi: ${err.message}` };
  }
}

// O número conectado na própria instância, em cache curto. Mandar mensagem para si
// mesmo falha em silêncio na uazapi — o envio "dá certo" e nada chega.
let ownerCache = { valor: null, ts: 0 };

async function owner() {
  if (Date.now() - ownerCache.ts < 120000) return ownerCache.valor;
  const s = await statusInstancia();
  ownerCache = { valor: s.ok ? s.owner : null, ts: Date.now() };
  return ownerCache.valor;
}

/** POST /message/download — áudio do webhook de DP, em base64. */
async function baixarMidia(messageId) {
  const j = await chamar("/message/download", {
    metodo: "POST",
    corpo: { id: messageId, return_base64: true, return_link: false },
    timeoutMs: 45000,
  });
  const b64 = j.base64Data || j.base64 || j.file || "";
  if (!b64) throw new Error("uazapi não devolveu o áudio em base64");
  return { base64Data: b64, mimetype: j.mimetype || j.mimeType || "audio/ogg" };
}

/** Lê a URL de webhook cadastrada na instância uazapi (a mesma das guias). */
async function lerWebhookCadastrado() {
  if (!configurado()) {
    return { ok: false, motivo: "UAZAPI_SUBDOMAIN/TOKEN ausentes no container." };
  }
  const mascarar = (url) => String(url || "").replace(/([?&]token=)[^&]+/gi, "$1***");
  const tenta = async (caminho) => {
    const j = await chamar(caminho, { metodo: "GET", timeoutMs: 15000 });
    const url =
      j.url ||
      j.webhookUrl ||
      j.webhook_url ||
      (typeof j.webhook === "string" ? j.webhook : j.webhook?.url) ||
      "";
    return { bruto: j, url };
  };
  try {
    let { bruto, url } = await tenta("/webhook");
    if (!url) {
      try {
        const b = await tenta("/instance");
        bruto = { ...bruto, instance: b.bruto };
        url = b.url;
      } catch {
        /* /instance é opcional */
      }
    }
    const mascarada = mascarar(url);
    return {
      ok: true,
      url_mascarada: mascarada || null,
      aponta_para_este_portal: /\/api\/whatsapp\/webhook/i.test(url),
      chaves: Object.keys(bruto || {}).slice(0, 20),
    };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
}

module.exports = {
  configurado,
  enviarTexto,
  enviarDocumento,
  baixarMidia,
  statusInstancia,
  lerWebhookCadastrado,
  owner,
  UazapiNaoConfigurado,
  UazapiTokenInvalido,
};
