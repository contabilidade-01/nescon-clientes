/**
 * Rotas internas para integração com central-ecac.
 * Auth: Bearer token via INTERNAL_API_TOKEN (mesma VPS, rede interna).
 */
const express = require("express");
const router = express.Router();
const db = require("../db");
const { enviarTexto } = require("../uazapi");
const guiasMei = require("../guiasMei");
const numeroWpp = require("../whatsappNumero");

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN || "";

function authInterno(req, res, next) {
  if (!INTERNAL_TOKEN) {
    console.warn("[INTERNO] INTERNAL_API_TOKEN não configurado; bloqueando acesso");
    return res.status(503).json({ error: "Internal API not configured" });
  }
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ") || header.slice(7) !== INTERNAL_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/**
 * GET /api/interno/empresas-contatos
 * Lista {cnpj, name, contact_email, phone, whatsapp, gclick_phone, whatsapp_envio}
 * de todas as empresas ativas. `whatsapp_envio` é o número que o portal usa para
 * mandar WhatsApp (`celularSql`: primeiro celular válido entre o WhatsApp manual, o
 * telefone do Cadastro e o do G-Click) — o mesmo critério dos alertas e cobranças.
 *
 * Usado pelo AtendeChat para vincular cada contato ao CNPJ. Antes só vinham cnpj,
 * contact_email e phone: empresa com o celular no campo WhatsApp e fixo em phone
 * ficava sem vínculo lá.
 */
router.get("/empresas-contatos", authInterno, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.cnpj, c.name, c.contact_email, c.phone, c.whatsapp,
              g.phone AS gclick_phone,
              ${numeroWpp.celularSql()} AS whatsapp_envio
         FROM companies c
         LEFT JOIN gclick_clients g ON g.company_id = c.id
        WHERE c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
          AND c.cnpj IS NOT NULL AND c.cnpj <> ''
        ORDER BY c.name`
    );
    res.json(rows);
  } catch (err) {
    console.error("[INTERNO] erro ao listar contatos:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/interno/clientes-carteira
 * Todos os clientes com a carteira de cada um ('nescon' = escritório, 'jean' =
 * pessoal). Usado pela gestão financeira do escritório (FinanceHub) para saber
 * quais boletos Cora entram nas transações e para manter o cadastro de clientes.
 * Arquivadas e excluídas vêm junto (marcadas): um boleto antigo ainda pode ser pago.
 */
router.get("/clientes-carteira", authInterno, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT cnpj, name AS nome, contact_email AS email, COALESCE(whatsapp, phone) AS telefone,
              carteira, (arquivada IS TRUE OR excluida IS TRUE) AS inativo
         FROM companies
        WHERE cnpj IS NOT NULL AND cnpj <> ''
        ORDER BY name`
    );
    res.json({ gerado_em: new Date().toISOString(), clientes: rows });
  } catch (err) {
    console.error("[INTERNO] clientes-carteira:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * GET /api/interno/empresa-vinculo?cnpj=
 * A empresa existe aqui e tem WhatsApp válido? Não devolve número nem e-mail.
 */
router.get("/empresa-vinculo", authInterno, async (req, res) => {
  try {
    res.json(await guiasMei.vinculo(db, req.query.cnpj));
  } catch (err) {
    console.error("[INTERNO] vínculo:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * POST /api/interno/guia-mei
 * Recebe o PDF de uma guia MEI (DAS ou parcelamento) e envia pelo WhatsApp com anexo,
 * dentro das regras de janela, teto/hora e opt-out. Idempotente por external_ref.
 * Body: { cnpj, tipo: "DAS_MEI"|"PARCELAMENTO_MEI", competencia: "AAAAMM",
 *         vencimento?: "AAAAMMDD", valor?, external_ref, pdf_base64, forcar? }
 * Resposta: { ok, status: enviada|na_fila|falhou|sem_whatsapp|ignorada|sem_cadastro, motivo }
 */
router.post("/guia-mei", authInterno, async (req, res) => {
  const v = guiasMei.validarPedido(req.body);
  if (v.erro) return res.status(400).json({ ok: false, status: "invalido", motivo: v.erro });
  try {
    const r = await guiasMei.receberGuia(db, v.dados);
    const { http, ...corpo } = r;
    res.status(http).json(corpo);
  } catch (err) {
    console.error("[INTERNO] guia-mei:", err.message);
    res.status(500).json({ ok: false, status: "falhou", motivo: "Erro interno" });
  }
});

/** GET /api/interno/guia-mei/status?refs=a,b,c — situação dos envios (painel). */
router.get("/guia-mei/status", authInterno, async (req, res) => {
  try {
    const refs = String(req.query.refs || "").split(",").map((r) => r.trim()).filter(Boolean);
    res.json({ envios: await guiasMei.statusPorRefs(db, refs) });
  } catch (err) {
    console.error("[INTERNO] status guia-mei:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * POST /api/interno/notificar-whatsapp
 * Dispara alerta curto de pendência fiscal via WhatsApp.
 * Body: { cnpj, razao_social, pendencias: [{tipo, competencia, valor, vencimento}], portal_url }
 */
router.post("/notificar-whatsapp", authInterno, async (req, res) => {
  const { cnpj, razao_social, pendencias, portal_url } = req.body || {};

  if (!cnpj || !Array.isArray(pendencias) || pendencias.length === 0) {
    return res.status(400).json({ ok: false, motivo: "cnpj e pendencias obrigatórios" });
  }

  // Busca telefone da empresa
  let phone;
  try {
    const { rows } = await db.query(
      "SELECT phone FROM companies WHERE cnpj = $1 AND arquivada IS NOT TRUE AND excluida IS NOT TRUE LIMIT 1",
      [String(cnpj).replace(/\D/g, "")]
    );
    if (!rows.length || !rows[0].phone) {
      return res.json({ ok: false, motivo: "Telefone não cadastrado ou empresa inativa" });
    }
    phone = rows[0].phone.replace(/\D/g, "");
    if (phone.length < 10) {
      return res.json({ ok: false, motivo: "Telefone inválido" });
    }
  } catch (err) {
    console.error("[INTERNO] erro ao buscar telefone:", err.message);
    return res.status(500).json({ ok: false, motivo: err.message });
  }

  // Monta mensagem curta
  const linkPortal = portal_url || process.env.PUBLIC_APP_URL || "";
  let texto;
  if (pendencias.length === 1) {
    const p = pendencias[0];
    const valorFmt = Number(p.valor || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    texto = [
      `⚠️ Pendência fiscal identificada`,
      `Empresa: ${razao_social || cnpj}`,
      `Tipo: ${p.tipo} | Valor: ${valorFmt} | Vencimento: ${p.vencimento || "N/A"}`,
      `Regularize pelo portal: ${linkPortal}/guias`,
    ].join("\n");
  } else {
    const linhas = pendencias.map((p) => {
      const valorFmt = Number(p.valor || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });
      return `• ${p.tipo} ${p.competencia || ""} — ${valorFmt} — Venc. ${p.vencimento || "N/A"}`;
    });
    texto = [
      `⚠️ ${pendencias.length} pendências fiscais identificadas`,
      `Empresa: ${razao_social || cnpj}`,
      ...linhas,
      `Regularize todas pelo portal: ${linkPortal}/guias`,
    ].join("\n");
  }

  try {
    await enviarTexto({ numero: phone, texto, delayMs: 1000 });
    res.json({ ok: true });
  } catch (err) {
    console.error("[INTERNO] falha ao enviar WhatsApp:", err.message);
    res.json({ ok: false, motivo: err.message });
  }
});

module.exports = router;