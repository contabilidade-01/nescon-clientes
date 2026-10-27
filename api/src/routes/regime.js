/**
 * Simulador de regime no Simples: guarda o questionário e os dados de cada empresa.
 *
 * O escritório (área `empresas`) lê e grava o de QUALQUER cliente, informando
 * `company_id`. O cliente só o próprio, e só com a ferramenta `regime_tributario` ligada —
 * ela nasce desligada e quem libera é o escritório.
 *
 * O cálculo roda na tela (src/lib/regime/); aqui só se guarda.
 */
const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { adminHasArea } = require("../middleware/adminArea");
const { companyHasTool } = require("../middleware/companyToolAccess");
const { validateUUID } = require("../middleware/validate");

router.use(authMiddleware);

const MAX_BYTES = 200 * 1024;

function empresaDe(req) {
  if (req.isAdmin) {
    if (!adminHasArea(req, "empresas")) return { status: 403, erro: "Sem acesso a esta área." };
    const id = (req.query.company_id || "").toString();
    if (!id) return { status: 400, erro: "Informe company_id" };
    if (!validateUUID(id)) return { status: 400, erro: "company_id inválido" };
    return { companyId: id };
  }
  if (!req.company?.id) return { status: 403, erro: "Sessão de empresa inválida" };
  if (!companyHasTool(req, "regime_tributario")) {
    return { status: 403, erro: "O simulador de regime não está ativo para a sua empresa." };
  }
  return { companyId: req.company.id };
}

function quemGrava(req) {
  if (req.isAdmin) return `escritorio:${req.admin?.nome || req.admin?.cpf || req.admin?.id || ""}`;
  if (req.personificadoPor) return `escritorio:${req.personificadoPor} (personificando)`;
  return "cliente";
}

function validarDados(dados) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return "Dados inválidos.";
  if (Buffer.byteLength(JSON.stringify(dados)) > MAX_BYTES) return "Simulação grande demais para salvar.";
  return null;
}

router.get("/", async (req, res) => {
  const e = empresaDe(req);
  if (e.erro) return res.status(e.status).json({ error: e.erro });
  try {
    const { rows } = await db.query(
      "SELECT dados, atualizado_em, atualizado_por FROM regime_simulacoes WHERE company_id = $1",
      [e.companyId]
    );
    res.json(rows[0] || { dados: null, atualizado_em: null, atualizado_por: null });
  } catch (err) {
    console.error("[regime] carregar:", err.message);
    res.status(500).json({ error: "Erro ao carregar a simulação" });
  }
});

router.put("/", async (req, res) => {
  const e = empresaDe(req);
  if (e.erro) return res.status(e.status).json({ error: e.erro });
  const erro = validarDados(req.body?.dados);
  if (erro) return res.status(400).json({ error: erro });
  try {
    const { rows } = await db.query(
      `INSERT INTO regime_simulacoes (company_id, dados, atualizado_em, atualizado_por)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (company_id) DO UPDATE
         SET dados = EXCLUDED.dados, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por
       RETURNING atualizado_em, atualizado_por`,
      [e.companyId, JSON.stringify(req.body.dados), quemGrava(req)]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("[regime] salvar:", err.message);
    res.status(500).json({ error: "Erro ao salvar a simulação" });
  }
});

module.exports = router;
module.exports.empresaDe = empresaDe;
module.exports.validarDados = validarDados;
