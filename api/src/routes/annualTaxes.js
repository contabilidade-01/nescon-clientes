const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { validateUUID, validateString } = require("../middleware/validate");

const STATUSES = ["pendente", "enviado", "confirmado"];

function adminOnly(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: "Acesso restrito a administradores" });
  }
  next();
}

router.use(authMiddleware);
router.use(adminOnly);

/** Ano do controle: só aceita algo plausível para taxa de prefeitura. */
function lerAno(valor, fallback = new Date().getFullYear()) {
  const n = parseInt(valor, 10);
  if (!Number.isInteger(n)) return fallback;
  if (n < 2000 || n > fallback + 5) return null;
  return n;
}

/**
 * Uma linha por empresa estabelecida no ano pedido. Empresa sem registro aparece como
 * 'pendente' — não criamos linhas em branco na base só para preencher a tela.
 */
router.get("/", async (req, res) => {
  try {
    const ano = lerAno(req.query.ano);
    if (ano === null) return res.status(400).json({ error: "Ano inválido" });

    const { rows } = await db.query(
      `SELECT c.id AS company_id, c.name, c.cnpj,
              COALESCE(t.status, 'pendente') AS status,
              t.enviado_em, t.confirmado_em, t.observacao, t.atualizado_em
         FROM companies c
         LEFT JOIN annual_tax_receipts t ON t.company_id = c.id AND t.ano = $1
        WHERE c.established IS TRUE
        ORDER BY c.name`,
      [ano]
    );
    const resumo = { pendente: 0, enviado: 0, confirmado: 0 };
    for (const r of rows) resumo[r.status] = (resumo[r.status] || 0) + 1;
    res.json({ ano, resumo, total: rows.length, empresas: rows });
  } catch (err) {
    console.error("[taxas anuais listar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Marca o estado da guia de taxa anual de uma empresa. Upsert por (empresa, ano):
 * clicar duas vezes no mesmo estado não duplica nada.
 */
router.put("/", async (req, res) => {
  try {
    const companyId = req.body?.company_id;
    if (!validateUUID(companyId)) return res.status(400).json({ error: "Selecione a empresa" });
    const ano = lerAno(req.body?.ano, null);
    if (!ano) return res.status(400).json({ error: "Ano inválido" });
    const status = req.body?.status;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: "Estado deve ser pendente, enviado ou confirmado" });
    }
    const observacao =
      req.body?.observacao === undefined || req.body?.observacao === null || req.body?.observacao === ""
        ? null
        : String(req.body.observacao).trim();
    if (observacao !== null && !validateString(observacao, 1, 500)) {
      return res.status(400).json({ error: "Observação muito longa (máx. 500)" });
    }

    const { rowCount: existe } = await db.query("SELECT 1 FROM companies WHERE id = $1", [companyId]);
    if (!existe) return res.status(404).json({ error: "Empresa não encontrada" });

    // As datas seguem o estado: o primeiro envio fica carimbado e não se move nos
    // cliques seguintes; voltar para 'pendente' limpa os carimbos, para o histórico
    // não afirmar um envio que foi desfeito. Expressões fixas — nada vindo do cliente.
    const enviadoExpr =
      status === "pendente" ? "NULL" : "COALESCE(annual_tax_receipts.enviado_em, now())";
    const confirmadoExpr =
      status === "confirmado" ? "COALESCE(annual_tax_receipts.confirmado_em, now())" : "NULL";

    const { rows } = await db.query(
      `INSERT INTO annual_tax_receipts (company_id, ano, status, observacao, enviado_em, confirmado_em)
       VALUES ($1, $2, $3, $4,
               CASE WHEN $3 IN ('enviado','confirmado') THEN now() ELSE NULL END,
               CASE WHEN $3 = 'confirmado' THEN now() ELSE NULL END)
       ON CONFLICT (company_id, ano) DO UPDATE
         SET status = EXCLUDED.status,
             observacao = EXCLUDED.observacao,
             enviado_em = ${enviadoExpr},
             confirmado_em = ${confirmadoExpr},
             atualizado_em = now()
       RETURNING *`,
      [companyId, ano, status, observacao]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("[taxas anuais gravar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
