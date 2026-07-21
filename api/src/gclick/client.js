/**
 * Cliente da API Omie.G-Click.
 *
 * Porte do `app/gclick.py` do sistema de guias — mantenha os dois em sincronia ao
 * mexer em endpoint ou formato de resposta. O portal busca os documentos por conta
 * própria (não depende do outro sistema estar no ar).
 *
 * Credenciais: GCLICK_CLIENT_ID / GCLICK_CLIENT_SECRET (as mesmas do sistema de guias).
 */

const BASE_URL = (process.env.GCLICK_BASE_URL || "https://api.gclick.com.br").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.GCLICK_TIMEOUT_MS || 60000);

/** Token vive ~1h; renovamos 30s antes de expirar (mesma margem do outro sistema). */
let tokenCache = { value: "", expiresAt: 0 };

function credentials() {
  return {
    clientId: process.env.GCLICK_CLIENT_ID || "",
    clientSecret: process.env.GCLICK_CLIENT_SECRET || "",
  };
}

function isConfigured() {
  const { clientId, clientSecret } = credentials();
  return Boolean(clientId && clientSecret);
}

async function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function authenticate() {
  const now = Date.now() / 1000;
  if (tokenCache.value && tokenCache.expiresAt - 30 > now) return tokenCache.value;

  const { clientId, clientSecret } = credentials();
  if (!clientId || !clientSecret) throw new Error("G-Click não configurado (GCLICK_CLIENT_ID/SECRET)");

  const res = await fetchWithTimeout(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`G-Click: falha na autenticação (HTTP ${res.status})`);
  const j = await res.json();
  tokenCache = {
    value: j.access_token,
    expiresAt: now + Number(j.expires_in || 3599),
  };
  return tokenCache.value;
}

/** Zera o cache — usado nos testes e quando as credenciais mudam. */
function resetTokenCache() {
  tokenCache = { value: "", expiresAt: 0 };
}

async function get(path, params) {
  const token = await authenticate();
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  const res = await fetchWithTimeout(`${BASE_URL}${path}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`G-Click ${path}: HTTP ${res.status}`);
  return res.json();
}

/** Roda `worker` sobre `items` com no máximo `limit` chamadas simultâneas. */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Tarefas de obrigação por janela de vencimento. Descobre totalPages na página 0
 * e busca as demais em paralelo.
 */
async function listarTarefasObrigacoes({ dataVencimentoInicio, dataVencimentoFim, nome, size = 500 }) {
  const base = {
    categoria: "Obrigacao",
    dataVencimentoInicio,
    dataVencimentoFim,
    size: String(size),
  };
  if (nome) base.nome = nome;

  const first = await get("/tarefas", { ...base, page: "0" });
  const todas = [...(first.content || [])];
  const totalPages = Number(first.totalPages || 1);
  if (totalPages <= 1) return todas;

  const paginas = Array.from({ length: totalPages - 1 }, (_, i) => i + 1);
  const restantes = await mapLimit(paginas, 8, (p) => get("/tarefas", { ...base, page: String(p) }));
  for (const j of restantes) todas.push(...(j.content || []));
  return todas;
}

function listarAtividades(tarefaId) {
  return get(`/tarefas/${encodeURIComponent(tarefaId)}/atividades`);
}

async function listarClientes(size = 200) {
  const first = await get("/clientes", { size: String(size), page: "0" });
  if (Array.isArray(first)) return first;
  const todos = [...(first.content || [])];
  const totalPages = Number(first.totalPages || 1);
  if (totalPages <= 1) return todos;

  const paginas = Array.from({ length: totalPages - 1 }, (_, i) => i + 1);
  const restantes = await mapLimit(paginas, 4, (p) =>
    get("/clientes", { size: String(size), page: String(p) })
  );
  for (const j of restantes) if (j && !Array.isArray(j)) todos.push(...(j.content || []));
  return todos;
}

/** O PDF vem de URL S3 pré-assinada (expira ~2h) — sem header de autenticação. */
async function baixarPdf(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Download do PDF: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Normaliza o cliente do G-Click para o que o portal precisa.
 *
 * `inscricao` é o CNPJ; `nome` a razão social; `apelido` o nome curto. `emails` e
 * `telefones` são arrays de objetos — preferimos o e-mail do Departamento Pessoal
 * (categoriaIds contém 1), como faz o sistema de guias.
 */
function extrairDadosCliente(c) {
  const cnpj = String(c?.inscricao || c?.cnpj || "").replace(/\D/g, "");
  const nomeCompleto = (c?.nome || c?.razaoSocial || "").trim();
  const apelido = (c?.apelido || c?.nomeFantasia || "").trim();

  const emails = Array.isArray(c?.emails) ? c.emails : [];
  const dp = emails.find((e) => (e?.categoriaIds || []).includes(1));
  const escolhido = dp || emails[0];
  const email = (escolhido?.email || "").trim().toLowerCase() || null;

  const telefones = Array.isArray(c?.telefones) ? c.telefones : [];
  const phone = String(telefones[0]?.numero || "").replace(/\D/g, "") || null;

  return { cnpj, name: nomeCompleto || apelido, email, phone, status: c?.status || null };
}

module.exports = {
  BASE_URL,
  isConfigured,
  resetTokenCache,
  listarTarefasObrigacoes,
  listarAtividades,
  listarClientes,
  baixarPdf,
  extrairDadosCliente,
  mapLimit,
};
