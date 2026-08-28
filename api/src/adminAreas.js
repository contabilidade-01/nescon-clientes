/**
 * Áreas do painel do escritório — a permissão de cada usuário administrador.
 *
 * Mesma ideia do `tool_access` das empresas (ver companyTools.js), mas as chaves aqui
 * são as PÁGINAS do painel. Regras:
 *
 * - `is_owner` = dono do sistema: vê tudo sempre e é o único que gerencia usuários.
 *   A permissão dele não é editável — senão dava para se trancar para fora.
 * - `areas` NULO = acesso total. É o que mantém os logins antigos funcionando sem migração.
 * - Chave ausente no JSON = false (usuário novo nasce sem nada, e o dono libera).
 *
 * A "visão geral" não entra na lista: é a porta de entrada, todo usuário vê. Ela mostra
 * só os números das áreas que a pessoa tem.
 */
const ADMIN_AREAS = [
  "empresas",
  "funcionarios",
  "entregas",
  "licencas",
  "taxas_anuais",
  "lgpd",
  "sincronizacao",
  "envio_guias",
  "alertas",
  "atendimento",
  "acessos",
  "acompanhamentos",
];

const ADMIN_AREA_LABELS = {
  empresas: "Empresas",
  funcionarios: "Funcionários",
  entregas: "Documentos e entregas",
  licencas: "Licenças",
  taxas_anuais: "Taxas anuais",
  lgpd: "Consentimentos LGPD",
  sincronizacao: "Sincronização",
  envio_guias: "Envio de guias",
  alertas: "Alertas de vencimento",
  atendimento: "Atendimentos (chat)",
  acessos: "Controle de acessos",
  acompanhamentos: "Acompanhamentos mensais",
};

/** Normaliza o JSON gravado: chave ausente vira false. `null` = acesso total. */
function mergeAreas(raw) {
  if (raw === null || raw === undefined) {
    return Object.fromEntries(ADMIN_AREAS.map((a) => [a, true]));
  }
  const o = typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(ADMIN_AREAS.map((a) => [a, Boolean(o[a])]));
}

/** Só as chaves conhecidas entram — lixo enviado pelo cliente é descartado. */
function sanitizeAreas(body) {
  const o = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  return Object.fromEntries(ADMIN_AREAS.map((a) => [a, Boolean(o[a])]));
}

function isAdminArea(a) {
  return ADMIN_AREAS.includes(a);
}

module.exports = { ADMIN_AREAS, ADMIN_AREA_LABELS, mergeAreas, sanitizeAreas, isAdminArea };
