/**
 * Gerentes da empresa: logins por CPF que a própria empresa cria no portal para quem só
 * precisa emitir advertência e suspensão (ver docs/PLANO-SUBUSUARIOS-CLIENTE.md).
 *
 * Duas travas, de propósito:
 * - `acessoDoGerente` zera no `tool_access` tudo o que não foi delegado. O portal já
 *   esconde menus e rotas pelo `tool_access`, então o gerente só vê o que pode.
 * - `rotaLiberadaParaGerente` é uma lista fechada de rotas da API. Várias rotas de
 *   empresa não olham o `tool_access` (portal, chat, entregas…); sem a lista, o gerente
 *   chamaria essas rotas direto e veria guias, boletos e folha da empresa.
 */
const { mergeToolAccess } = require("./companyTools");

/** O que a empresa pode delegar a um gerente. */
const PERMISSOES_GERENTE = ["warning", "suspension"];

/** Só as chaves conhecidas, como booleano. O resto do JSON é descartado. */
function normalizarPermissoes(raw) {
  const out = {};
  for (const k of PERMISSOES_GERENTE) out[k] = Boolean(raw && raw[k] === true);
  return out;
}

/**
 * `tool_access` efetivo do gerente: o que a empresa tem E o que foi delegado. Gerente
 * nunca passa da empresa — se o escritório desliga a advertência da empresa, o
 * gerente perde junto, sem ninguém editar o cadastro dele.
 */
function acessoDoGerente(toolAccessEmpresa, permissoes) {
  const empresa = mergeToolAccess(toolAccessEmpresa);
  const perm = normalizarPermissoes(permissoes);
  const out = {};
  for (const k of Object.keys(empresa)) {
    out[k] = PERMISSOES_GERENTE.includes(k) ? Boolean(empresa[k] && perm[k]) : false;
  }
  return out;
}

/** Chaves pedidas que a empresa não tem liberadas (não pode delegar o que não tem). */
function permissoesForaDaEmpresa(toolAccessEmpresa, permissoes) {
  const empresa = mergeToolAccess(toolAccessEmpresa);
  const perm = normalizarPermissoes(permissoes);
  return PERMISSOES_GERENTE.filter((k) => perm[k] && !empresa[k]);
}

const ID = "[0-9a-fA-F-]{36}";
const ROTAS_GERENTE = [
  ["GET", /^\/api\/auth\/company-session$/],
  ["POST", /^\/api\/auth\/change-password$/],
  ["GET", /^\/api\/health$/],
  // Lista de funcionários para escolher quem recebe o documento. Só leitura: cadastrar,
  // editar e inativar continuam com a empresa.
  ["GET", /^\/api\/employees\/?$/],
  // Histórico (advertências anteriores pré-preenchem a próxima) e emissão.
  ["GET", /^\/api\/documents\/?$/],
  ["POST", /^\/api\/documents\/?$/],
  ["POST", new RegExp(`^/api/documents/${ID}/enviar-email$`)],
  // Telemetria da tela "Controle de acessos" (best-effort).
  ["POST", /^\/api\/portal\/uso$/],
];

function rotaLiberadaParaGerente(method, originalUrl) {
  const caminho = String(originalUrl || "").split("?")[0];
  const m = String(method || "").toUpperCase();
  return ROTAS_GERENTE.some(([metodo, re]) => metodo === m && re.test(caminho));
}

module.exports = {
  PERMISSOES_GERENTE,
  normalizarPermissoes,
  acessoDoGerente,
  permissoesForaDaEmpresa,
  rotaLiberadaParaGerente,
};
