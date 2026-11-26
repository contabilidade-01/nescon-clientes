/**
 * Recálculo de impostos SEM LOGIN — `/api/recalculo` (página /recalculo).
 * Dois fatores: CNPJ + código de 6 dígitos no e-mail cadastrado (10 min).
 * Modelo de proteção em ../recalculoCodigo.js.
 *
 *   POST /codigo     { cnpj }          → { ok, email (mascarado), minutos, reenviar_em }
 *   POST /verificar  { cnpj, codigo }  → { ok, token }  (token da tela /g/:token, 60 min)
 */
const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { isSmtpConfigured, createTransport } = require("../mailer");
const acessoLinks = require("../acessoLinks");
const rc = require("../recalculoCodigo");

const limitePedido = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitos pedidos de código. Aguarde alguns minutos." },
});

const limiteVerificacao = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos." },
});

router.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store, private");
  next();
});

async function enviarEmail({ to, subject, text, html }) {
  if (!isSmtpConfigured()) throw new Error("SMTP não configurado");
  return createTransport().sendMail({ from: process.env.SMTP_FROM, to, subject, text, html });
}

router.post("/codigo", limitePedido, async (req, res) => {
  try {
    const r = await rc.pedirCodigo(db, { cnpj: req.body?.cnpj, ip: req.ip, enviar: enviarEmail });
    res.status(r.status).json(r.body);
  } catch (err) {
    console.error("[recalculo] codigo:", err.message);
    res.status(500).json({ error: "Erro interno. Tente de novo." });
  }
});

router.post("/verificar", limiteVerificacao, async (req, res) => {
  try {
    const r = await rc.verificarCodigo(db, {
      cnpj: req.body?.cnpj,
      codigo: req.body?.codigo,
      criarAcesso: (companyId) => acessoLinks.criarCurto(db, { companyId, minutos: rc.MINUTOS_ACESSO }),
    });
    res.status(r.status).json(r.body);
  } catch (err) {
    console.error("[recalculo] verificar:", err.message);
    res.status(500).json({ error: "Erro interno. Tente de novo." });
  }
});

module.exports = router;
