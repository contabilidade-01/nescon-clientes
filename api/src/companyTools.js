/**
 * Permissões por empresa: cada chave liga/desliga o acesso à ferramenta no app.
 * Valores omitidos no JSON gravado na BD são tratados como true (retrocompatível).
 */
const DEFAULT_TOOL_ACCESS = {
  // Portal do Cliente: entregas da contabilidade
  fiscal_guides: true,
  boletos: true,
  payroll_files: true,
  documents: true,
  calendar: true,
  // Férias: previsão, custo e limite de faltas
  vacations: true,
  // Departamento pessoal
  suspension: true,
  warning: true,
  chatbot: true,
  salary_adhoc: true,
  employees: true,
  certificates: true,
  history: true,
};

/**
 * Empresas criadas pela sincronização com o sistema de guias: só as seções de entregas.
 * A maioria desses clientes só recebe guias — o Departamento Pessoal fica desligado e o
 * admin liga por empresa nas poucas que usam.
 */
const PORTAL_ONLY_TOOL_ACCESS = {
  fiscal_guides: true,
  boletos: true,
  payroll_files: true,
  documents: true,
  calendar: true,
  vacations: true,
  suspension: false,
  warning: false,
  chatbot: false,
  salary_adhoc: false,
  employees: false,
  certificates: false,
  history: false,
};

function mergeToolAccess(raw) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = { ...DEFAULT_TOOL_ACCESS };
  for (const key of Object.keys(DEFAULT_TOOL_ACCESS)) {
    if (Object.prototype.hasOwnProperty.call(o, key)) {
      out[key] = Boolean(o[key]);
    }
  }
  return out;
}

function normalizeToolAccessPatch(body) {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const patch = {};
  for (const key of Object.keys(DEFAULT_TOOL_ACCESS)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      patch[key] = Boolean(body[key]);
    }
  }
  return Object.keys(patch).length ? patch : null;
}

module.exports = {
  DEFAULT_TOOL_ACCESS,
  PORTAL_ONLY_TOOL_ACCESS,
  mergeToolAccess,
  normalizeToolAccessPatch,
};
