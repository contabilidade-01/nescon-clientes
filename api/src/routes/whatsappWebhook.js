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
    return res.status(401).json({ error: "Webhook não autorizado" });
  }
  res.status(200).json({ received: true });

  try {
    const body = req.body || {};
    const message = body.message || body;
    if (!message || message.fromMe) return;
    const chatid = message.chatid || message.chatId || message.sender || "";
    if (!chatid || String(chatid).endsWith("@g.us")) return;

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
    let texto = String(message.text || message.body || message.conversation || "").trim();

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

    if (!texto) return;

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
