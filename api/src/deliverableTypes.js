/**
 * Categorias de entrega e a ferramenta (tool_access) que libera cada uma.
 * Partilhado entre as rotas do cliente e a ingestão vinda do sistema de guias.
 */
const CATEGORIES = ["guia", "folha", "outro"];

const TOOL_BY_CATEGORY = {
  guia: "fiscal_guides",
  folha: "payroll_files",
  outro: "documents",
};

/** Qualquer uma destas libera a listagem geral de entregas. */
const DELIVERABLE_TOOLS = Object.values(TOOL_BY_CATEGORY);

const STATUSES = ["pending", "paid"];

function isCategory(value) {
  return CATEGORIES.includes(value);
}

function toolForCategory(category) {
  return TOOL_BY_CATEGORY[category] || null;
}

module.exports = {
  CATEGORIES,
  TOOL_BY_CATEGORY,
  DELIVERABLE_TOOLS,
  STATUSES,
  isCategory,
  toolForCategory,
};
