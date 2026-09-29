/**
 * Rotas internas para integração com central-ecac.
 * Auth: Bearer token via INTERNAL_API_TOKEN (mesma VPS, rede interna).
 */
const express = require("express");
const router = express.Router();
const db = require("../db");
const { enviarTexto } = require("../uazapi");

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
 * Retorna lista de {cnpj, contact_email, phone} de todas as empresas ativas.
 * Usado pelo central-ecac para sincronizar contatos antes da rotina fiscal.
 */
router.get("/empresas-contatos", authInterno, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT cnpj, contact_email, phone
       FROM companies
       WHERE active IS TRUE
         AND cnpj IS NOT NULL`
    );
    res.json(rows);
  } catch (err) {
    console.error("[INTERNO] erro ao listar contatos:", err.message);
    res.status(500).json({ error: err.message });
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
      "SELECT phone FROM companies WHERE cnpj = $1 AND active IS TRUE LIMIT 1",
      [cnpj]
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