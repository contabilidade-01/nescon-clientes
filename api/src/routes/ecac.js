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
const { gerarGuia, enviarPdf } = require("../ecacGuias");
const acessoLinks = require("../acessoLinks");

const GIF_1PX = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

// ------------------------------------------------------------------ públicas
router.get("/r/:token", async (req, res) => {
  const tok = String(req.params.token || "").replace(/[^a-f0-9]/g, "").slice(0, 64);
  const base = getPublicAppUrl() || "";
  // O link da mensagem abre a tela de guias SEM SENHA (escopo só guias daquela empresa):
  // quem recebeu no WhatsApp/e-mail cadastrado já provou ter o canal. Ver acessoLinks.js.
  try {
    const clique = tok ? await cobranca.registrarClique(db, tok) : null;
    if (clique && clique.company_id) {
      // Alerta manual: o envio tem o seu link (7 dias). Vencido/cancelado → página avisa.
      if (clique.acesso_token) return res.redirect(302, `${base}/g/${clique.acesso_token}`);
      const acesso = await acessoLinks.obterOuCriar(db, { companyId: clique.company_id, origem: "cobranca", cobrancaId: clique.cobranca_id || null });
      return res.redirect(302, `${base}/g/${acesso}`);
    }
  } catch (err) {
    console.error("[ecac] link rastreado:", err.message);
  }
  res.redirect(302, `${base}/impostos-pendentes`);
});

router.get("/abriu/:token.gif", async (req, res) => {
  const tok = String(req.params.token || "").replace(/[^a-f0-9]/g, "").slice(0, 64);
  if (tok) cobranca.registrarAbertura(db, tok).catch(() => {});
  res.set({ "Content-Type": "image/gif", "Cache-Control": "no-store, private", "Content-Length": GIF_1PX.length });
  res.end(GIF_1PX);
});

// ------------------------------------------------------------- autenticadas
router.use(authMiddleware);
// Fase de teste: só empresas liberadas pelo escritório (admin passa direto).
router.use(requireCompanyTool("impostos_ecac"));

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
 * POST /api/ecac/guias  { tipo: 'SN'|'MEI'|'DCTFWEB', periodo_apuracao: 'AAAAMM', data_pagamento: 'AAAA-MM-DD' }
 * Gera (ou reaproveita) a guia no central-ecac com o CNPJ DO TOKEN e registra o evento.
 *
 * DCTFWEB = débitos de INSS do relatório: UMA DARF por competência com todos os códigos
 * (1082, 1099…), recalculada até a data de pagamento — como o e-CAC emite.
 * Parcela de parcelamento (PARC_SN, PARC_MEI…): só o escritório; `periodo_apuracao` = parcela
 * e o central-ecac exige que ela conste na última consulta de parcelas.
 */
router.post("/guias", async (req, res) => {
  const { empresa, quem, erro } = await empresaDoPedido(req);
  if (erro) return res.status(400).json({ error: erro });
  const r = await gerarGuia({
    empresa, quem, corpo: req.body, escritorio: Boolean(req.isAdmin), origem: req.isAdmin ? "escritorio" : "portal",
  });
  if (r.status === 200) r.body.pdf_url = `/api/ecac/guias/${r.body.guia.id}/pdf`;
  res.status(r.status).json(r.body);
});

/** GET /api/ecac/guias/:id/pdf — PDF guardado lá; o CNPJ do token vai junto e é conferido lá também. */
router.get("/guias/:id/pdf", async (req, res) => {
  const { empresa, erro } = await empresaDoPedido(req);
  if (erro) return res.status(400).json({ error: erro });
  return enviarPdf(res, empresa, req.params.id);
});

module.exports = router;
