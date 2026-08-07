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
      `SELECT s.competencia, s.problemas, s.causa, s.diagnostico, c.name AS empresa,
              s.proventos, s.descontos, s.liquido
         FROM payroll_snapshots s
         JOIN companies c ON c.id = s.company_id
        WHERE ${filtros.join(" AND ")}
        ORDER BY s.competencia DESC, c.name
        LIMIT 200`,
      params
    );
    // Agrupa pela CAUSA, não pela lista de campos que faltaram: "não achei o total" é
    // sintoma; "o PDF é digitalizado" é o problema. Sem isso, três documentos diferentes
    // apareciam como três variações do mesmo texto e ninguém sabia por onde começar.
    const ROTULO = {
      sem_texto: "PDF sem camada de texto (digitalizado) — precisa de OCR ou do arquivo original",
      nao_e_extrato: "O arquivo anexado não é um Extrato Mensal",
      extrato_parcial: "Extrato Mensal incompleto (resumido ou com outras opções de impressão)",
      formato_diferente: "Extrato Mensal com diagramação diferente — exige ajuste no leitor",
    };
    const porCausa = new Map();
    for (const r of rows) {
      const chave = r.causa || "sem_causa";
      const atual = porCausa.get(chave) || { quantas: 0, exemplo: null };
      atual.quantas += 1;
      if (!atual.exemplo && r.diagnostico) atual.exemplo = r.diagnostico;
      porCausa.set(chave, atual);
    }
    res.json({
      total: rows.length,
      motivos: [...porCausa.entries()]
        .map(([causa, v]) => ({
          causa,
          motivo: ROTULO[causa] || "Causa não registrada (releia os extratos para diagnosticar)",
          quantas: v.quantas,
          exemplo: v.exemplo,
        }))
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
