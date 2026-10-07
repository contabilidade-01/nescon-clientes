/**
 * Cliente mínimo da API ZapSign (assinatura eletrônica).
 *
 * Docs: https://docs.zapsign.com.br — token em Configurações > Integrações > API ZapSign.
 *
 * Produção: https://api.zapsign.com.br/api/v1  (assinatura com validade jurídica)
 * Sandbox:  https://sandbox.api.zapsign.com.br/api/v1  (testes, SEM validade jurídica;
 *           conta e token próprios em https://sandbox.app.zapsign.com.br)
 *
 * Nada aqui grava no banco: quem decide o que fazer com a resposta é routes/contratos.js.
 */
const PROD_URL = "https://api.zapsign.com.br/api/v1";
const SANDBOX_URL = "https://sandbox.api.zapsign.com.br/api/v1";

function baseUrl() {
  const explicita = (process.env.ZAPSIGN_API_URL || "").trim().replace(/\/+$/, "");
  if (explicita) return explicita;
  return process.env.ZAPSIGN_SANDBOX === "true" ? SANDBOX_URL : PROD_URL;
}

function isSandbox() {
  return baseUrl() !== PROD_URL;
}

function configurado() {
  return Boolean((process.env.ZAPSIGN_API_TOKEN || "").trim());
}

async function chamar(path, { method = "GET", body } = {}) {
  if (!configurado()) throw new Error("ZapSign não configurada (ZAPSIGN_API_TOKEN).");
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.ZAPSIGN_API_TOKEN.trim()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detalhe =
      (json && (json.message || json.detail || json.error)) || texto.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`ZapSign: ${detalhe}`);
  }
  return json;
}

/**
 * Cria o documento a partir do PDF (base64) e já dispara o e-mail da ZapSign para
 * cada signatário (`send_automatic_email`). WhatsApp é opcional porque é cobrado.
 *
 * @param {{ nome: string, pdfBase64: string, externalId: string,
 *   signatarios: Array<{ nome: string, email?: string, telefone?: string, qualificacao?: string }>,
 *   whatsapp?: boolean, marca?: string, criadoPor?: string, prazoDias?: number }} p
 */
async function criarDocumento(p) {
  const signers = p.signatarios.map((s) => {
    const fone = String(s.telefone || "").replace(/\D/g, "");
    const temFone = fone.length >= 10;
    return {
      name: s.nome,
      email: s.email || "",
      phone_country: temFone ? "55" : "",
      phone_number: temFone ? fone.replace(/^55(?=\d{10,11}$)/, "") : "",
      auth_mode: "assinaturaTela",
      send_automatic_email: Boolean(s.email),
      send_automatic_whatsapp: Boolean(p.whatsapp && temFone),
      send_automatic_whatsapp_signed_file: Boolean(p.whatsapp && temFone),
      require_cpf: true,
      qualification: s.qualificacao || "",
      lock_name: true,
    };
  });
  const body = {
    name: p.nome.slice(0, 255),
    base64_pdf: p.pdfBase64,
    lang: "pt-br",
    external_id: p.externalId,
    brand_name: (p.marca || "Nescon Contabilidade").slice(0, 100),
    created_by: p.criadoPor || undefined,
    date_limit_to_sign: p.prazoDias ? dataLimite(p.prazoDias) : undefined,
    reminder_every_n_days: 3,
    allow_refuse_signature: true,
    signers,
  };
  return chamar("/docs/", { method: "POST", body });
}

function dataLimite(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Detalhe do documento: status (pending|signed|refused…), signers e links temporários (60 min). */
async function detalharDocumento(token) {
  return chamar(`/docs/${encodeURIComponent(token)}/`);
}

/** Baixa um arquivo pela URL temporária devolvida pela ZapSign. */
async function baixarArquivo(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ZapSign: falha ao baixar arquivo (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = {
  configurado,
  isSandbox,
  baseUrl,
  criarDocumento,
  detalharDocumento,
  baixarArquivo,
};
