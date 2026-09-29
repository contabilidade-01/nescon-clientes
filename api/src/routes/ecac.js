/**
 * Impostos pendentes no e-CAC — rotas do PORTAL DO CLIENTE (+ rastreio público).
 *
 * A regra que evita "coisa de um cliente para outro": o CNPJ que vai ao central-ecac é
 * SEMPRE o do JWT (`req.company.cnpj`). Nunca vem da URL, do corpo ou da query. Admin
 * personificando um cliente cai na mesma regra, porque o token de personificação é o da
 * empresa. Admin com token próprio precisa dizer `company_id` — e a empresa é lida do
 * banco, não do pedido.
 *
 * Emitir guia é chamada PAGA lá (quando não há PDF válido guardado). O limite diário é
 * do central-ecac; aqui só se registra o evento — é ele que decide entre "regerar o
 * relatório em N dias úteis" e "mandar lembrete".
 *
 * Rotas públicas (sem login): `/r/:token` (link rastreado → portal) e `/abriu/:token.gif`
 * (pixel). O token é aleatório e não carrega dado nenhum; a página de destino exige login.
 */
const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireCompanyTool } = require("../middleware/companyToolAccess");
const { validateUUID } = require("../middleware/validate");
const ecac = require("../ecacClient");
const { ultimaPendencia } = require("../ecacPendencias");
const cobranca = require("../ecacCobranca");
const regras = require("../ecacRegras");
const { getPublicAppUrl } = require("../mailer");

const GIF_1PX = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

// ------------------------------------------------------------------ públicas
router.get("/r/:token", async (req, res) => {
  const tok = String(req.params.token || "").replace(/[^a-f0-9]/g, "").slice(0, 64);
  if (tok) cobranca.registrarClique(db, tok).catch(() => {});
  const base = getPublicAppUrl();
  res.redirect(302, `${base || ""}/impostos-pendentes`);
});

router.get("/abriu/:token.gif", async (req, res) => {
  const tok = String(req.params.token || "").replace(/[^a-f0-9]/g, "").slice(0, 64);
  if (tok) cobranca.registrarAbertura(db, tok).catch(() => {});
  res.set({ "Content-Type": "image/gif", "Cache-Control": "no-store, private", "Content-Length": GIF_1PX.length });
  res.end(GIF_1PX);
});

// ------------------------------------------------------------- autenticadas
router.use(authMiddleware);
router.use(requireCompanyTool("fiscal_guides"));

/** A empresa do pedido: SEMPRE a do token; admin informa company_id e a empresa vem do banco. */
async function empresaDoPedido(req) {
  if (req.isAdmin) {
    const id = String(req.query.company_id || req.body?.company_id || "");
    if (!validateUUID(id)) return { erro: "Informe company_id" };
    const { rows } = await db.query(`SELECT id, name, cnpj FROM companies WHERE id = $1`, [id]);
    if (!rows.length) return { erro: "Empresa não encontrada" };
    return { empresa: rows[0], quem: `admin:${req.admin?.cpf || req.admin?.id || ""}` };
  }
  if (!req.company?.id) return { erro: "Sessão de empresa inválida" };
  const { rows } = await db.query(`SELECT id, name, cnpj FROM companies WHERE id = $1`, [req.company.id]);
  if (!rows.length) return { erro: "Empresa não encontrada" };
  const quem = req.personificadoPor ? `admin:${req.personificadoPor} (personificando)` : `cliente:${regras.cnpjChave(rows[0].cnpj) || ""}`;
  return { empresa: rows[0], quem };
}

/** GET /api/ecac/pendencias — o espelho (último relatório) + cobrança + guias geradas. */
router.get("/pendencias", async (req, res) => {
  const { empresa, erro } = await empresaDoPedido(req);
  if (erro) return res.status(400).json({ error: erro });
  const cnpj = regras.cnpjChave(empresa.cnpj);
  if (!cnpj) return res.json({ disponivel: false, motivo: "Empresa sem CNPJ (pessoa física não tem situação fiscal no e-CAC)." });

  try {
    const p = await ultimaPendencia(db, empresa.id);
    const { rows: cbs } = await db.query(
      `SELECT id, ciclo, estado, estado_desde, proxima_acao, proxima_acao_em, regeracoes, iniciado_em
         FROM ecac_cobrancas WHERE company_id = $1 ORDER BY id DESC LIMIT 1`,
      [empresa.id]
    );
    const { rows: guias } = await db.query(
      `SELECT id, emissao_id, tipo, periodo_apuracao, data_consolidacao, numero_documento, vencimento,
              valor_total, reuso, criado_em
         FROM ecac_guias WHERE company_id = $1 ORDER BY criado_em DESC LIMIT 30`,
      [empresa.id]
    );
    const debitos = p ? p.debitos || [] : [];
    res.json({
      disponivel: Boolean(p),
      empresa: { id: empresa.id, name: empresa.name },
      relatorio: p ? { id: p.relatorio_id, data: p.relatorio_data, importado_em: p.importado_em } : null,
      em_atraso: regras.debitosCobraveis(debitos),
      a_vencer: regras.debitosAVencer(debitos),
      total_atraso: regras.totalCobravel(debitos),
      omissoes: p ? p.omissoes || [] : [],
      parcelamento: p ? p.parcelamento : null,
      pgfn: p ? p.pgfn : null,
      cobranca: cbs[0] ? { ...cbs[0], rotulo: regras.ROTULO_ESTADO[cbs[0].estado] || cbs[0].estado } : null,
      guias,
      aviso_valores:
        "Os valores são os do relatório da Receita na data indicada. Ao gerar a guia, multa e juros são atualizados até a data de pagamento escolhida.",
    });
  } catch (err) {
    console.error("[ecac] pendencias:", err.message);
    res.status(500).json({ error: "Erro ao carregar as pendências" });
  }
});

/**
 * POST /api/ecac/guias  { tipo: 'SN'|'MEI', periodo_apuracao: 'AAAAMM', data_pagamento: 'AAAA-MM-DD' }
 * Gera (ou reaproveita) a guia no central-ecac com o CNPJ DO TOKEN e registra o evento.
 */
router.post("/guias", async (req, res) => {
  const { empresa, quem, erro } = await empresaDoPedido(req);
  if (erro) return res.status(400).json({ error: erro });
  const cnpj = regras.cnpjChave(empresa.cnpj);
  if (!cnpj) return res.status(400).json({ error: "Empresa sem CNPJ." });

  const tipo = String(req.body?.tipo || "SN").toUpperCase();
  if (!["SN", "MEI"].includes(tipo)) {
    return res.status(400).json({ error: "Pelo portal só é possível recalcular DAS do Simples Nacional e do MEI. Para INSS/DCTFWeb vencido, fale com o escritório." });
  }
  const pa = regras.soDigitos(req.body?.periodo_apuracao);
  if (pa.length !== 6) return res.status(400).json({ error: "Competência inválida (AAAAMM)." });
  const dataPg = String(req.body?.data_pagamento || "").slice(0, 10);
  if (dataPg && !/^\d{4}-\d{2}-\d{2}$/.test(dataPg)) return res.status(400).json({ error: "Data de pagamento inválida." });

  // A competência pedida tem de estar no espelho da PRÓPRIA empresa: o cliente só gera
  // guia do que a Receita mostra para ele.
  const p = await ultimaPendencia(db, empresa.id);
  const conhecida = (p?.debitos || []).some((d) => d && d.valido && d.periodo_aaaamm === pa && String(d.tipo).toUpperCase() === tipo);
  if (!conhecida) {
    return res.status(400).json({ error: "Esta competência não consta no seu relatório da Receita. Fale com o escritório." });
  }

  try {
    const r = await ecac.emitirGuia({
      cnpj,
      tipo,
      periodoApuracao: pa,
      dataConsolidacao: dataPg ? dataPg.replace(/-/g, "") : null,
      origem: "portal",
      solicitadoPor: quem,
    });
    const guia = await cobranca.registrarGuiaGerada(db, { companyId: empresa.id, emissao: r.emissao, reuso: r.reuso, solicitadoPor: quem });
    res.json({ ok: true, reuso: Boolean(r.reuso), guia, pdf_url: `/api/ecac/guias/${guia.id}/pdf` });
  } catch (err) {
    if (err instanceof ecac.EcacRecusou) return res.status(err.status === 429 ? 429 : 409).json({ error: err.message });
    if (err instanceof ecac.EcacNaoConfigurado) return res.status(503).json({ error: "Integração com o e-CAC não está configurada." });
    console.error("[ecac] emitir guia:", err.message);
    res.status(502).json({ error: "Não foi possível gerar a guia agora. Tente em alguns minutos ou fale com o escritório." });
  }
});

/** GET /api/ecac/guias/:id/pdf — PDF guardado lá; o CNPJ do token vai junto e é conferido lá também. */
router.get("/guias/:id/pdf", async (req, res) => {
  const { empresa, erro } = await empresaDoPedido(req);
  if (erro) return res.status(400).json({ error: erro });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "id inválido" });
  const { rows } = await db.query(`SELECT * FROM ecac_guias WHERE id = $1 AND company_id = $2`, [id, empresa.id]);
  if (!rows.length) return res.status(404).json({ error: "Guia não encontrada" });
  const g = rows[0];
  try {
    const pdf = await ecac.pdfGuia(g.emissao_id, empresa.cnpj);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${g.tipo}_${g.periodo_apuracao}.pdf"`,
      "Cache-Control": "no-store, private",
    });
    res.end(pdf);
  } catch (err) {
    if (err instanceof ecac.EcacRecusou) return res.status(410).json({ error: err.message });
    console.error("[ecac] pdf:", err.message);
    res.status(502).json({ error: "PDF indisponível no momento." });
  }
});

module.exports = router;
