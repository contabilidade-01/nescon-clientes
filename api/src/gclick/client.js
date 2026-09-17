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

async function mensagemErroHttp(res, path) {
  const raw = await res.text().catch(() => "");
  let detalhe = raw.slice(0, 240).replace(/\s+/g, " ").trim();
  try {
    const j = JSON.parse(raw);
    detalhe = String(j.message || j.error || j.detail || detalhe);
  } catch {
    /* corpo não é JSON — usa o trecho cru */
  }
  return `G-Click ${path}: HTTP ${res.status}${detalhe ? ` — ${detalhe}` : ""}`;
}

async function get(path, params) {
  const token = await authenticate();
  const qs = params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : "";
  const res = await fetchWithTimeout(`${BASE_URL}${path}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await mensagemErroHttp(res, path));
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

/**
 * A doc oficial (Postman Omie.G-Click) lista GET /clientes com size=20 e page=1.
 * size=200 ou page=0 devolve HTTP 400 em algumas contas. Tentamos o formato
 * documentado e, se 400, o outro índice de página.
 */
function paginasRestantes(pageBase, totalPages) {
  const ultima = pageBase === 0 ? totalPages - 1 : pageBase + (totalPages - 1);
  const out = [];
  for (let p = pageBase + 1; p <= ultima; p++) out.push(p);
  return out;
}

async function primeiraPaginaClientes(size) {
  const tentativas = [
    { size: String(size), page: "0" },
    { size: String(size), page: "1" },
    { size: "20", page: "0" },
    { size: "20", page: "1" },
  ];
  let lastErr = null;
  const vistos = new Set();
  for (const params of tentativas) {
    const chave = `${params.size}|${params.page}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    try {
      const json = await get("/clientes", params);
      return { json, size: Number(params.size), pageBase: Number(params.page) };
    } catch (err) {
      lastErr = err;
      if (!String(err.message || "").includes("HTTP 400")) throw err;
    }
  }
  try {
    return { json: await get("/clientes"), size, pageBase: 1 };
  } catch (err) {
    throw lastErr || err;
  }
}

const eh400 = (err) => String(err?.message || "").includes("HTTP 400");

/**
 * Um único cadastro com defeito no G-Click (ex.: "Status complementar 'Em Carteria' não
 * encontrado" — status complementar apagado/renomeado lá) faz a API devolver HTTP 400
 * para a PÁGINA INTEIRA onde ele cai. Sem isto, a listagem toda falhava e nenhum cliente
 * novo chegava ao portal. Aqui a página ruim é refeita item a item (size=1) e só o
 * cadastro defeituoso fica de fora — registrado em `ignorados`.
 */
async function paginaResiliente(page, size, ignorados) {
  try {
    const j = await get("/clientes", { size: String(size), page: String(page) });
    return Array.isArray(j) ? j : j?.content || [];
  } catch (err) {
    if (!eh400(err) || size === 1) throw err;
  }
  const itens = [];
  for (let i = 0; i < size; i++) {
    const posicao = page * size + i;
    try {
      const j = await get("/clientes", { size: "1", page: String(posicao) });
      const content = Array.isArray(j) ? j : j?.content || [];
      if (!content.length) break; // passou do fim da lista
      itens.push(...content);
    } catch (err) {
      if (!eh400(err)) throw err;
      ignorados.push({ posicao, erro: err.message });
    }
  }
  return itens;
}

async function listarClientes(size = 20) {
  const ignorados = [];
  let first;
  let sizeUsado = size;
  let pageBase = 0;
  try {
    ({ json: first, size: sizeUsado, pageBase } = await primeiraPaginaClientes(size));
  } catch (err) {
    if (!eh400(err)) throw err;
    // A própria primeira página tem o cadastro defeituoso: descobre o total por uma
    // página vizinha e refaz a primeira item a item.
    const conteudo = await paginaResiliente(0, size, ignorados);
    let meta = null;
    for (let p = 1; p < 20 && !meta; p++) {
      try {
        meta = await get("/clientes", { size: String(size), page: String(p) });
      } catch (e) {
        if (!eh400(e)) throw e;
      }
    }
    first = { ...(meta || {}), number: 0, content: conteudo };
    sizeUsado = size;
    pageBase = 0;
  }
  if (Array.isArray(first)) return first;
  const todos = [...(first.content || [])];
  const totalPages = Number(first.totalPages || 1);
  const atual = Number.isFinite(Number(first.number)) ? Number(first.number) : pageBase;
  const paginas = paginasRestantes(atual, totalPages);
  // A API é 0-based (conferido: page=0 → number=0). Se a página 0 deu 400 e a tentativa
  // caiu na page=1, a página 0 ficaria de fora — busca ela também, item a item se preciso.
  for (let p = atual - 1; p >= 0; p--) paginas.unshift(p);

  if (paginas.length) {
    const restantes = await mapLimit(paginas, 4, (p) => paginaResiliente(p, sizeUsado, ignorados));
    for (const lista of restantes) todos.push(...lista);
  }

  if (ignorados.length) {
    console.warn(
      `[gclick] ${ignorados.length} cliente(s) ignorado(s) por cadastro com defeito no G-Click:`,
      ignorados.map((x) => `posição ${x.posicao}: ${x.erro}`).join(" | ")
    );
  }
  // Propriedade extra no array: quem só itera não percebe; quem quer mostrar, lê.
  todos.ignorados = ignorados;
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
  paginasRestantes,
  baixarPdf,
  extrairDadosCliente,
  mapLimit,
};
