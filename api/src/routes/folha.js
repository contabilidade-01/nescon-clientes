/**
 * Painel de folha — servido para os DOIS lados.
 *
 * O escritório vê a carteira inteira ou uma empresa escolhida; o cliente vê a dele, e
 * só a dele. É a mesma consulta com a empresa resolvida de fontes diferentes, e ficar
 * numa rota só evita o que costuma acontecer quando são duas: os números divergirem
 * porque alguém corrigiu um lado e esqueceu o outro.
 *
 * Antes isto vivia em `/api/admin/folha/*` e era inacessível ao cliente — o painel de
 * gestão de cada empresa existia só para quem não é dono dela.
 */
const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { companyHasTool } = require("../middleware/companyToolAccess");
const { validateUUID } = require("../middleware/validate");
const folhaKpi = require("../folhaKpi");

router.use(authMiddleware);

/**
 * Empresa da requisição.
 *
 * Admin sem `company_id` = carteira inteira (`companyId` nulo, somado). Cliente sempre
 * a própria, e nunca pode pedir outra — o `company_id` da query é ignorado para ele, em
 * vez de recusado: ignorar é mais seguro que confiar no que veio e conferir depois.
 */
function empresaDe(req) {
  if (req.isAdmin) {
    const id = (req.query.company_id || "").toString();
    if (!id) return { companyId: null };
    if (!validateUUID(id)) return { erro: "company_id inválido" };
    return { companyId: id };
  }
  if (!req.company?.id) return { erro: "Sessão de empresa inválida" };
  if (!companyHasTool(req, "payroll_files")) {
    return { erro: "O painel de folha não está ativo para a sua empresa." };
  }
  return { companyId: req.company.id };
}

const competencia = (v) => (/^\d{4}-\d{2}$/.test(String(v || "")) ? String(v) : null);

/** Série por competência, com filtro de período. */
router.get("/serie", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(403).json({ error: erro });
  try {
    res.json(
      await folhaKpi.serie(db, {
        companyId,
        de: competencia(req.query.de),
        ate: competencia(req.query.ate),
      })
    );
  } catch (err) {
    console.error("[folha] serie:", err.message);
    res.status(500).json({ error: "Erro ao montar a série de folha" });
  }
});

/**
 * As competências cuja leitura não fechou, COM O MOTIVO.
 *
 * Avisar "60 competências não conferiram" sem dizer quais nem por quê transfere o
 * problema para quem não tem como investigar. Aqui vem empresa, competência e o texto
 * do que falhou.
 */
router.get("/problemas", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(403).json({ error: erro });
  const params = [];
  const filtros = ["s.conferido IS FALSE"];
  if (companyId) {
    params.push(companyId);
    filtros.push(`s.company_id = $${params.length}`);
  }
  try {
    const { rows } = await db.query(
      `SELECT s.competencia, s.problemas, c.name AS empresa,
              s.proventos, s.descontos, s.liquido
         FROM payroll_snapshots s
         JOIN companies c ON c.id = s.company_id
        WHERE ${filtros.join(" AND ")}
        ORDER BY s.competencia DESC, c.name
        LIMIT 200`,
      params
    );
    // Agrupa por motivo: 60 linhas com a mesma causa são UM problema, não sessenta.
    const porMotivo = new Map();
    for (const r of rows) {
      const chave = r.problemas || "sem motivo registrado";
      porMotivo.set(chave, (porMotivo.get(chave) || 0) + 1);
    }
    res.json({
      total: rows.length,
      motivos: [...porMotivo.entries()]
        .map(([motivo, quantas]) => ({ motivo, quantas }))
        .sort((a, b) => b.quantas - a.quantas),
      itens: rows.slice(0, 50),
    });
  } catch (err) {
    console.error("[folha] problemas:", err.message);
    res.status(500).json({ error: "Erro ao listar os problemas de leitura" });
  }
});

/** Projeção do 13º. */
router.get("/decimo-terceiro", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(403).json({ error: erro });
  const ano = Number(req.query.ano) || new Date().getFullYear();
  try {
    res.json(await folhaKpi.projecaoDecimoTerceiro(db, { companyId, ano }));
  } catch (err) {
    console.error("[folha] 13o:", err.message);
    res.status(500).json({ error: "Erro ao projetar o 13º" });
  }
});

/** Reprocessar é do escritório: mexe no histórico de todo mundo. */
router.post("/reprocessar", requireArea("funcionarios"), async (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: "Acesso restrito" });
  try {
    res.json(await folhaKpi.reprocessarExtratos(db, { desde: competencia(req.body?.desde) }));
  } catch (err) {
    console.error("[folha] reprocessar:", err.message);
    res.status(500).json({ error: "Erro ao reprocessar os extratos" });
  }
});

module.exports = router;
