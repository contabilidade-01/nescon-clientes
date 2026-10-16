/**
 * Planejador de escalas: guarda a configuração da empresa e a escala de cada mês.
 *
 * O escritório (área `funcionarios`) lê e grava a de QUALQUER cliente, informando
 * `company_id`. O cliente só a própria, e só com a ferramenta `escalas` ligada — ela
 * nasce desligada e quem libera é o escritório.
 *
 * As regras (o que é erro, o que bloqueia) rodam no planejador; aqui só se guarda.
 */
const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { adminHasArea } = require("../middleware/adminArea");
const { companyHasTool } = require("../middleware/companyToolAccess");
const { validateUUID } = require("../middleware/validate");

router.use(authMiddleware);

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Uma escala de 60 pessoas num mês fica bem abaixo disto; o teto barra lixo. */
const MAX_BYTES = 400 * 1024;

function empresaDe(req) {
  if (req.isAdmin) {
    if (!adminHasArea(req, "funcionarios")) return { status: 403, erro: "Sem acesso a esta área." };
    const id = (req.query.company_id || "").toString();
    if (!id) return { status: 400, erro: "Informe company_id" };
    if (!validateUUID(id)) return { status: 400, erro: "company_id inválido" };
    return { companyId: id };
  }
  if (!req.company?.id) return { status: 403, erro: "Sessão de empresa inválida" };
  if (!companyHasTool(req, "escalas")) {
    return { status: 403, erro: "Escalas de trabalho não está ativo para a sua empresa." };
  }
  return { companyId: req.company.id };
}

function quemGrava(req) {
  if (req.isAdmin) return `escritorio:${req.admin?.nome || req.admin?.cpf || req.admin?.id || ""}`;
  if (req.personificadoPor) return `escritorio:${req.personificadoPor} (personificando)`;
  return "cliente";
}

/** Objeto JSON dentro do teto, ou mensagem de erro. */
function validarDados(dados) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return "Dados inválidos.";
  if (Buffer.byteLength(JSON.stringify(dados)) > MAX_BYTES) return "Escala grande demais para salvar.";
  return null;
}

router.get("/config", async (req, res) => {
  const e = empresaDe(req);
  if (e.erro) return res.status(e.status).json({ error: e.erro });
  try {
    const { rows } = await db.query(
      "SELECT dados, atualizado_em, atualizado_por FROM escala_config WHERE company_id = $1",
      [e.companyId]
    );
    res.json(rows[0] || { dados: null, atualizado_em: null, atualizado_por: null });
  } catch (err) {
    console.error("[escalas] config:", err.message);
    res.status(500).json({ error: "Erro ao carregar a configuração" });
  }
});

router.put("/config", async (req, res) => {
  const e = empresaDe(req);
  if (e.erro) return res.status(e.status).json({ error: e.erro });
  const erro = validarDados(req.body?.dados);
  if (erro) return res.status(400).json({ error: erro });
  try {
    const { rows } = await db.query(
      `INSERT INTO escala_config (company_id, dados, atualizado_em, atualizado_por)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (company_id) DO UPDATE
         SET dados = EXCLUDED.dados, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por
       RETURNING dados, atualizado_em, atualizado_por`,
      [e.companyId, JSON.stringify(req.body.dados), quemGrava(req)]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("[escalas] salvar config:", err.message);
    res.status(500).json({ error: "Erro ao salvar a configuração" });
  }
});

/** Meses com escala salva, do mais recente ao mais antigo. */
router.get("/planos", async (req, res) => {
  const e = empresaDe(req);
  if (e.erro) return res.status(e.status).json({ error: e.erro });
  try {
    const { rows } = await db.query(
      `SELECT mes, atualizado_em, atualizado_por FROM escala_planejamentos
       WHERE company_id = $1 ORDER BY mes DESC`,
      [e.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error("[escalas] planos:", err.message);
    res.status(500).json({ error: "Erro ao listar as escalas" });
  }
});

router.get("/planos/:mes", async (req, res) => {
  const e = empresaDe(req);
  if (e.erro) return res.status(e.status).json({ error: e.erro });
  if (!MES_RE.test(req.params.mes)) return res.status(400).json({ error: "Mês inválido" });
  try {
    const { rows } = await db.query(
      `SELECT mes, dados, atualizado_em, atualizado_por FROM escala_planejamentos
       WHERE company_id = $1 AND mes = $2`,
      [e.companyId, req.params.mes]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error("[escalas] plano:", err.message);
    res.status(500).json({ error: "Erro ao carregar a escala" });
  }
});

router.put("/planos/:mes", async (req, res) => {
  const e = empresaDe(req);
  if (e.erro) return res.status(e.status).json({ error: e.erro });
  if (!MES_RE.test(req.params.mes)) return res.status(400).json({ error: "Mês inválido" });
  const erro = validarDados(req.body?.dados);
  if (erro) return res.status(400).json({ error: erro });
  try {
    const { rows } = await db.query(
      `INSERT INTO escala_planejamentos (company_id, mes, dados, atualizado_em, atualizado_por)
       VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (company_id, mes) DO UPDATE
         SET dados = EXCLUDED.dados, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por
       RETURNING mes, atualizado_em, atualizado_por`,
      [e.companyId, req.params.mes, JSON.stringify(req.body.dados), quemGrava(req)]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("[escalas] salvar plano:", err.message);
    res.status(500).json({ error: "Erro ao salvar a escala" });
  }
});

router.delete("/planos/:mes", async (req, res) => {
  const e = empresaDe(req);
  if (e.erro) return res.status(e.status).json({ error: e.erro });
  if (!MES_RE.test(req.params.mes)) return res.status(400).json({ error: "Mês inválido" });
  try {
    await db.query("DELETE FROM escala_planejamentos WHERE company_id = $1 AND mes = $2", [
      e.companyId,
      req.params.mes,
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error("[escalas] excluir plano:", err.message);
    res.status(500).json({ error: "Erro ao excluir a escala" });
  }
});

module.exports = router;
module.exports.empresaDe = empresaDe;
module.exports.validarDados = validarDados;
