/**
 * Tela de guias SEM SENHA — `/api/acesso/:token` (link do WhatsApp/e-mail cadastrado).
 *
 * Modelo de segurança (ver acessoLinks.js): token aleatório de 32 bytes, escopo SÓ guias
 * daquela empresa, vence sozinho, revogável pelo painel, cada acesso conta. Não abre
 * folha, documentos, cadastro nem o resto do portal.
 *
 * - origem 'mensal'   → guias do mês liberadas (DAS, INSS/DCTFWeb, FGTS, parcelamento…)
 * - origem 'cobranca' → também os impostos em atraso, com data de pagamento (recálculo)
 */
const router = require("express").Router();
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const acessoLinks = require("../acessoLinks");
const { ultimaPendencia } = require("../ecacPendencias");
const regras = require("../ecacRegras");
const { gerarGuia, enviarPdf } = require("../ecacGuias");

const limiteGeracao = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos." },
});

router.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store, private");
  next();
});

async function carregar(req, res) {
  const v = await acessoLinks.validar(db, req.params.token);
  if (!v) {
    res.status(404).json({ error: "Link vencido ou inválido." });
    return null;
  }
  return v;
}

/** Guias do mês liberadas para a empresa; garante o token público de cada arquivo. */
async function guiasDoMes(companyId) {
  const { rows } = await db.query(
    `SELECT id, doc_type, title, competencia, to_char(due_date, 'YYYY-MM-DD') AS due_date, status, access_token
       FROM deliverables
      WHERE company_id = $1 AND category = 'guia' AND released_at IS NOT NULL
        AND created_at > now() - interval '75 days'
        AND (due_date IS NULL OR due_date >= CURRENT_DATE - 10)
      ORDER BY due_date NULLS LAST, title
      LIMIT 30`,
    [companyId]
  );
  for (const r of rows) {
    if (!r.access_token) {
      r.access_token = crypto.randomBytes(24).toString("hex");
      await db.query(`UPDATE deliverables SET access_token = $2 WHERE id = $1 AND access_token IS NULL`, [r.id, r.access_token]);
    }
  }
  return rows.map(({ id, access_token, ...g }) => ({ ...g, arquivo_url: `/api/deliverables/public/${access_token}/file` }));
}

router.get("/:token", async (req, res) => {
  try {
    const v = await carregar(req, res);
    if (!v) return;
    await acessoLinks.registrarAcesso(db, v.link.id, req.ip);
    const saida = {
      empresa: { name: v.empresa.name },
      origem: v.link.origem,
      expira_em: v.link.expira_em,
      contato_whatsapp: (process.env.NESCON_CONTATO_WHATSAPP || "").replace(/\D/g, "") || null,
      guias_mes: await guiasDoMes(v.empresa.id),
    };
    if (v.link.origem === "cobranca") {
      const p = await ultimaPendencia(db, v.empresa.id);
      const debitos = p ? p.debitos || [] : [];
      const { rows: guias } = await db.query(
        `SELECT id, tipo, periodo_apuracao, data_consolidacao, vencimento, valor_total, criado_em
           FROM ecac_guias WHERE company_id = $1 AND criado_em > now() - interval '40 days'
          ORDER BY criado_em DESC LIMIT 20`,
        [v.empresa.id]
      );
      Object.assign(saida, {
        relatorio_data: p ? p.relatorio_data : null,
        em_atraso: regras.debitosCobraveis(debitos),
        guias_geradas: guias,
        parcelamento: p ? p.parcelamento : null,
        aviso_valores:
          "Os valores são os do relatório da Receita. Ao gerar a guia, multa e juros são atualizados até a data de pagamento escolhida.",
      });
    }
    res.json(saida);
  } catch (err) {
    console.error("[acesso] get:", err.message);
    res.status(500).json({ error: "Erro ao carregar" });
  }
});

/** Recálculo pelo link: só em link de cobrança. Mesma regra do portal logado. */
router.post("/:token/guias", limiteGeracao, async (req, res) => {
  const v = await carregar(req, res);
  if (!v) return;
  if (v.link.origem !== "cobranca") return res.status(403).json({ error: "Este link é só para baixar as guias do mês." });
  const r = await gerarGuia({ empresa: v.empresa, quem: `link:${v.link.id}`, corpo: req.body, origem: "link" });
  res.status(r.status).json(r.body);
});

router.get("/:token/guias/:id/pdf", async (req, res) => {
  const v = await carregar(req, res);
  if (!v) return;
  return enviarPdf(res, v.empresa, req.params.id);
});

module.exports = router;
