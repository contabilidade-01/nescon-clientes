/**
 * Webhook uazapi: áudio/texto do cliente.
 * Sem login — autenticado por UAZAPI_WEBHOOK_SECRET (query token ou header).
 */
const express = require("express");
const { configurado, baixarMidia, owner } = require("../uazapi");
const { transcreverAudio } = require("../whatsappAudio");
const { processarTexto } = require("../whatsappDp");
const { enviarTexto } = require("../uazapi");
const db = require("../db");

const router = express.Router();
const processed = new Map();

function webhookAutorizado(req) {
  const secret = (process.env.UAZAPI_WEBHOOK_SECRET || "").trim();
  if (!secret) return true;
  const dado = String(req.query.token || req.headers["x-webhook-token"] || "").trim();
  return dado === secret;
}

function phoneFromChat(chatid) {
  const raw = String(chatid || "").split("@")[0];
  return raw.replace(/\D/g, "");
}

function isAudioType(messageType, mediaType) {
  const t = `${messageType || ""} ${mediaType || ""}`.toLowerCase();
  return t.includes("audio") || t.includes("ptt") || t.includes("voice");
}

router.post("/webhook", async (req, res) => {
  if (!webhookAutorizado(req)) {
    console.warn(
      "[whatsapp-dp] webhook 401 — UAZAPI_WEBHOOK_SECRET está no servidor, mas o pedido não trouxe ?token= nem x-webhook-token. A URL cadastrada na uazapi precisa incluir o token; senão todo evento é descartado e o assistente não responde."
    );
    return res.status(401).json({ error: "Webhook não autorizado" });
  }
  res.status(200).json({ received: true });

  try {
    const body = req.body || {};
    const message = body.message || body;
    if (!message || message.fromMe) return;
    const chatid =
      message.chatid || message.chatId || message.sender || message.key?.remoteJid || "";
    if (!chatid || String(chatid).endsWith("@g.us")) {
      // Diagnóstico: se veio um evento com cara de mensagem mas sem chatid aproveitável,
      // registra as chaves para descobrir o formato — é o rastro que faltava quando "não
      // respondeu". Eventos de sistema (presença, status) caem aqui e são ruído tolerável.
      if (!chatid && (message.text || message.body || message.messageType || message.type)) {
        console.warn(
          "[whatsapp-dp] evento sem chatid — chaves:",
          Object.keys(message).join(",").slice(0, 200)
        );
      }
      return;
    }

    const messageid = message.messageid || message.id || "";
    if (messageid) {
      if (processed.has(messageid)) return;
      processed.set(messageid, Date.now());
      if (processed.size > 200) {
        const now = Date.now();
        for (const [k, ts] of processed) if (now - ts > 60000) processed.delete(k);
      }
    }

    const phone = phoneFromChat(chatid);
    if (!phone) return;

    const instOwner = await owner().catch(() => null);
    if (instOwner && digitsEq(phone, instOwner)) return;

    const messageType = message.messageType || message.type || "";
    const mediaType = message.mediaType || "";
    // Extração tolerante a variações de payload da uazapi/WhatsApp: texto simples e as
    // formas aninhadas (mensagem "estendida" com link/resposta, legenda de mídia).
    let texto = String(
      message.text ||
        message.body ||
        message.conversation ||
        message.caption ||
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        message.message?.text ||
        ""
    ).trim();

    if (isAudioType(messageType, mediaType) && configurado()) {
      try {
        const midia = await baixarMidia(messageid);
        const buf = Buffer.from(midia.base64Data, "base64");
        texto = await transcreverAudio(db, buf, midia.mimetype);
        console.log(`[whatsapp-dp] áudio de ${phone}: "${texto.slice(0, 80)}"`);
      } catch (err) {
        console.error("[whatsapp-dp] transcrição:", err.message);
        await enviarTexto({
          numero: phone,
          texto:
            "Não consegui ouvir o áudio. Envie de novo, escreva o pedido, ou fale com a Nescon se for outro assunto.",
          delayMs: 600,
        }).catch(() => {});
        return;
      }
    }

    if (!texto) {
      // Mensagem chegou (chatid ok) mas sem texto aproveitável e não era áudio: registra
      // o tipo para diagnosticar por que o assistente não respondeu.
      if (!isAudioType(messageType, mediaType)) {
        console.warn(`[whatsapp-dp] mensagem de ${phone} sem texto — tipo="${messageType}/${mediaType}"`);
      }
      return;
    }

    const resposta = await processarTexto({ phone, texto });
    if (resposta) {
      await enviarTexto({ numero: phone, texto: resposta, delayMs: 900 });
    }
  } catch (err) {
    console.error("[whatsapp-dp] webhook:", err);
  }
});

function digitsEq(a, b) {
  const da = String(a || "").replace(/\D/g, "");
  const dbn = String(b || "").replace(/\D/g, "");
  if (!da || !dbn) return false;
  return da.slice(-8) === dbn.slice(-8);
}

module.exports = router;
