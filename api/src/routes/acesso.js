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
const { hojeSP } = require("../diasBancarios");

/** Tipo do débito no relatório da Receita que corresponde a cada guia do mês. */
const DEBITO_DA_GUIA = { DAS: ["SN", "MEI"], DCTF_WEB: ["INSS"] };

/** 'AAAA-MM-DD' de Date ou string (o pg devolve Date para colunas date/timestamp). */
function isoDia(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return String(v).slice(0, 10);
}

/** A empresa tem o recálculo liberado (fase de teste: chave "Impostos em aberto"). */
async function recalculoLiberado(companyId) {
  const { rows } = await db.query(`SELECT tool_access FROM companies WHERE id = $1`, [companyId]);
  const ta = rows[0] && rows[0].tool_access && typeof rows[0].tool_access === "object" ? rows[0].tool_access : {};
  return ta.impostos_ecac === true;
}

/**
 * Guia do mês VENCIDA: quem diz se ainda está em aberto é o relatório da Receita (e-CAC),
 * não a data. Casa pelo mês de vencimento + tipo (DAS ↔ SN/MEI, INSS/DCTFWeb ↔ INSS).
 *   em_aberto     → consta em atraso no relatório: dá para recalcular (DAS/DARF)
 *   sem_registro  → relatório já é posterior ao vencimento e não mostra débito (provável pago)
 *   sem_info      → relatório anterior ao vencimento, ou tipo que a Receita não informa
 *                   (FGTS é FGTS Digital; parcelamento sai pelo painel)
 */
function situacaoVencida(guia, pendencia, atrasoNormalizado) {
  const tipos = DEBITO_DA_GUIA[String(guia.doc_type || "").toUpperCase()];
  if (!tipos || !pendencia) return { situacao: "sem_info", debitos: [] };
  const mesVenc = String(guia.due_date || "").slice(0, 7);
  const debitos = atrasoNormalizado.filter(
    (d) => tipos.includes(String(d.tipo).toUpperCase()) && String(d.data_vencimento || "").slice(0, 7) === mesVenc
  );
  if (debitos.length) return { situacao: "em_aberto", debitos };
  const rel = isoDia(pendencia.relatorio_data);
  if (rel && rel > String(guia.due_date)) return { situacao: "sem_registro", debitos: [] };
  return { situacao: "sem_info", debitos: [] };
}

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
    const p = await ultimaPendencia(db, v.empresa.id);
    const atraso = regras.debitosCobraveis(p ? p.debitos || [] : []);
    const hoje = hojeSP();
    saida.recalculo_liberado = v.link.origem === "cobranca" || (await recalculoLiberado(v.empresa.id));
    saida.relatorio_data = p ? p.relatorio_data : null;
    for (const g of saida.guias_mes) {
      g.vencida = Boolean(g.due_date && g.due_date < hoje && g.status !== "paid");
      if (g.vencida) Object.assign(g, situacaoVencida(g, p, atraso));
    }
    const { rows: guias } = await db.query(
      `SELECT id, tipo, periodo_apuracao, data_consolidacao, vencimento, valor_total, criado_em
         FROM ecac_guias WHERE company_id = $1 AND criado_em > now() - interval '40 days'
        ORDER BY criado_em DESC LIMIT 20`,
      [v.empresa.id]
    );
    saida.guias_geradas = guias;
    if (v.link.origem === "cobranca") {
      Object.assign(saida, {
        em_atraso: atraso,
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
  // Recálculo pelo link: link de cobrança, ou empresa liberada no teste (guia do mês vencida).
  if (v.link.origem !== "cobranca" && !(await recalculoLiberado(v.empresa.id))) {
    return res.status(403).json({ error: "Para a guia atualizada, fale com o escritório." });
  }
  const r = await gerarGuia({ empresa: v.empresa, quem: `link:${v.link.id}`, corpo: req.body, origem: "link" });
  res.status(r.status).json(r.body);
});

router.get("/:token/guias/:id/pdf", async (req, res) => {
  const v = await carregar(req, res);
  if (!v) return;
  return enviarPdf(res, v.empresa, req.params.id);
});

module.exports = router;
module.exports.situacaoVencida = situacaoVencida;
