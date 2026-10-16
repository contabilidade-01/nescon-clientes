/** Lista de funcionários (GET) é usada por várias telas; exige ao menos uma destas ativa. */
const EMPLOYEE_LIST_TOOLS = ["employees", "suspension", "warning", "chatbot", "certificates", "escalas"];

function requireCompanyTool(toolKey) {
  return (req, res, next) => {
    if (req.isAdmin) return next();
    if (!req.company?.id) {
      return res.status(403).json({ error: "Sessão de empresa inválida" });
    }
    const access = req.companyToolAccess;
    if (!access || !access[toolKey]) {
      return res.status(403).json({ error: "Esta ferramenta não está ativa para a sua empresa." });
    }
    next();
  };
}

function requireCompanyAnyTool(toolKeys) {
  return (req, res, next) => {
    if (req.isAdmin) return next();
    if (!req.company?.id) {
      return res.status(403).json({ error: "Sessão de empresa inválida" });
    }
    const access = req.companyToolAccess;
    if (!access) {
      return res.status(403).json({ error: "Esta ferramenta não está ativa para a sua empresa." });
    }
    if (toolKeys.some((k) => access[k])) return next();
    return res.status(403).json({ error: "Esta ferramenta não está ativa para a sua empresa." });
  };
}

function companyHasTool(req, toolKey) {
  if (req.isAdmin) return true;
  return Boolean(req.companyToolAccess?.[toolKey]);
}

function companyHasAnyTool(req, toolKeys) {
  if (req.isAdmin) return true;
  const a = req.companyToolAccess;
  if (!a) return false;
  return toolKeys.some((k) => a[k]);
}

module.exports = {
  requireCompanyTool,
  requireCompanyAnyTool,
  EMPLOYEE_LIST_TOOLS,
  companyHasTool,
  companyHasAnyTool,
};
