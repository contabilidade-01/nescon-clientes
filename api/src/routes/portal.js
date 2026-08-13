/**
 * Rotas do portal do cliente ligadas a telemetria de uso (Controle de acessos).
 * O registro é best-effort e sempre responde 204 — nunca deve atrapalhar a navegação.
 */
const router = require("express").Router();
const { authMiddleware } = require("../middleware/auth");
const { registrarUso } = require("../portalEventos");

router.use(authMiddleware);

/**
 * POST /api/portal/uso  { ferramenta: "calendar" | "boletos" | ... }
 * Registra a abertura de uma ferramenta/seção pelo cliente logado. Ferramenta inválida
 * é ignorada em silêncio (o back valida contra a lista conhecida).
 */
router.post("/uso", (req, res) => {
  const companyId = req.company?.id;
  const ferramenta = String(req.body?.ferramenta || "");
  if (companyId && ferramenta) registrarUso(companyId, ferramenta, req);
  res.json({ ok: true });
});

module.exports = router;
