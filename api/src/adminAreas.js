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
  "alertas",
  "atendimento",
  "acessos",
  "acompanhamentos",
  "admissoes",
];

const ADMIN_AREA_LABELS = {
  empresas: "Empresas",
  funcionarios: "Funcionários",
  entregas: "Documentos e entregas",
  licencas: "Licenças",
  taxas_anuais: "Taxas anuais",
  lgpd: "Consentimentos LGPD",
  sincronizacao: "Sincronização",
  alertas: "Alertas de vencimento",
  atendimento: "Atendimentos (chat)",
  acessos: "Controle de acessos",
  acompanhamentos: "Acompanhamentos mensais",
  admissoes: "Admissões",
};

/**
 * Área que vem junto com outra. "Admissões" nasceu separada para dar a alguém só as
 * fichas e os documentos de admissão; quem já tinha "Funcionários" continua vendo as
 * admissões, como antes da separação.
 */
const AREA_INCLUIDA_EM = {
  admissoes: ["funcionarios"],
};

/** A pessoa tem a área marcada, ou uma área que a inclui. */
function areaLiberada(areas, area) {
  if (!areas) return false;
  if (areas[area]) return true;
  return (AREA_INCLUIDA_EM[area] || []).some((a) => Boolean(areas[a]));
}

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

module.exports = {
  ADMIN_AREAS,
  ADMIN_AREA_LABELS,
  AREA_INCLUIDA_EM,
  areaLiberada,
  mergeAreas,
  sanitizeAreas,
  isAdminArea,
};
