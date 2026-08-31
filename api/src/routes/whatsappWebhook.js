/**
 * Webhook uazapi: áudio/texto do cliente.
 * Sem login — autenticado por UAZAPI_WEBHOOK_SECRET (query token ou header).
 *
 * A instância uazapi é a MESMA do sistema de guias. O ENVIO já funcionava lá
 * (`/send/text`). O RECEBIMENTO só acontece se o webhook cadastrado na uazapi
 * apontar para ESTE portal (`/api/whatsapp/webhook`) — se continuar no app das
 * guias, este container nunca vê a mensagem.
 */
const express = require("express");
const { configurado, baixarMidia, owner, lerWebhookCadastrado } = require("../uazapi");
const { transcreverAudio } = require("../whatsappAudio");
const { processarTexto } = require("../whatsappDp");
const { enviarTexto } = require("../uazapi");
const db = require("../db");

const router = express.Router();
const processed = new Map();
const historico = [];

function registrar(evt) {
  historico.unshift({ em: new Date().toISOString(), ...evt });
  if (historico.length > 30) historico.pop();
}

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

/** GET /api/whatsapp/status — o que o comando Bash consulta. Sem secret. */
router.get("/status", async (_req, res) => {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  const uaz = await lerWebhookCadastrado();
  res.json({
    ok: true,
    envio_configurado: configurado(),
    secret_exigido: Boolean((process.env.UAZAPI_WEBHOOK_SECRET || "").trim()),
    url_que_este_app_espera: base ? `${base}/api/whatsapp/webhook` : "/api/whatsapp/webhook",
    webhook_cadastrado_na_uazapi: uaz,
    eventos_recentes: historico,
    dica:
      uaz.aponta_para_este_portal === false
        ? "A uazapi NÃO aponta para este portal — as mensagens estão indo para outro sistema (quase sempre o das guias)."
        : historico.length === 0
          ? "Nenhum POST chegou neste processo desde o último restart. Mande um WhatsApp ou rode o POST de prova do script."
          : null,
  });
});

router.post("/webhook", async (req, res) => {
  if (!webhookAutorizado(req)) {
    registrar({ resultado: "401_sem_token" });
    console.warn(
      "[whatsapp-dp] webhook 401 — UAZAPI_WEBHOOK_SECRET está no servidor, mas o pedido não trouxe ?token= nem x-webhook-token. A URL cadastrada na uazapi precisa incluir o token; senão todo evento é descartado e o assistente não responde."
    );
    return res.status(401).json({ error: "Webhook não autorizado" });
  }
  res.status(200).json({ received: true });

  try {
    const body = req.body || {};
    const message = body.message || body;
    if (!message || message.fromMe) {
      registrar({ resultado: message?.fromMe ? "ignorado_fromMe" : "sem_message" });
      return;
    }
    const chatid =
      message.chatid || message.chatId || message.sender || message.key?.remoteJid || "";
    if (!chatid || String(chatid).endsWith("@g.us")) {
      if (!chatid && (message.text || message.body || message.messageType || message.type)) {
        console.warn(
          "[whatsapp-dp] evento sem chatid — chaves:",
          Object.keys(message).join(",").slice(0, 200)
        );
      }
      registrar({ resultado: "sem_chatid_ou_grupo" });
      return;
    }

    const messageid = message.messageid || message.id || "";
    if (messageid) {
      if (processed.has(messageid)) {
        registrar({ resultado: "duplicado", id: String(messageid).slice(0, 24) });
        return;
      }
      processed.set(messageid, Date.now());
      if (processed.size > 200) {
        const now = Date.now();
        for (const [k, ts] of processed) if (now - ts > 60000) processed.delete(k);
      }
    }

    const phone = phoneFromChat(chatid);
    if (!phone) return;

    const instOwner = await owner().catch(() => null);
    if (instOwner && digitsEq(phone, instOwner)) {
      registrar({ resultado: "ignorado_owner" });
      return;
    }

    const messageType = message.messageType || message.type || body.messageType || "";
    const mediaType = message.mediaType || message.mimetype || message.mimeType || "";
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

    if (String(texto).includes("diagnostico-terminal") || String(messageid).startsWith("diag-")) {
      registrar({ resultado: "prova_terminal", tel: phone.slice(-4), tipo: messageType });
      console.log("[whatsapp-dp] prova de terminal aceita (não envia WhatsApp).");
      return;
    }

    const pareceAudio = isAudioType(messageType, mediaType);
    const tentarAudio = pareceAudio || (!texto && Boolean(messageid) && configurado());
    if (tentarAudio && configurado()) {
      try {
        const midia = await baixarMidia(messageid);
        const mime = String(midia.mimetype || "").toLowerCase();
        const ehAudio =
          pareceAudio ||
          mime.includes("audio") ||
          mime.includes("ogg") ||
          mime.includes("opus") ||
          mime.includes("mpeg") ||
          mime.includes("mp4");
        if (ehAudio) {
          const buf = Buffer.from(midia.base64Data, "base64");
          texto = await transcreverAudio(db, buf, midia.mimetype);
          console.log(`[whatsapp-dp] áudio de ${phone}: "${texto.slice(0, 80)}" tipo=${messageType}/${mediaType}`);
        }
      } catch (err) {
        console.error("[whatsapp-dp] transcrição:", err.message, "tipo=", messageType, mediaType);
        registrar({ resultado: "falha_transcricao", tel: phone.slice(-4), tipo: `${messageType}/${mediaType}` });
        if (pareceAudio) {
          await enviarTexto({
            numero: phone,
            texto:
              "Não consegui ouvir o áudio. Envie de novo (ou escreva o pedido). Se for outro assunto, fale com a Nescon.",
            delayMs: 600,
          }).catch(() => {});
        }
        return;
      }
    }

    if (!texto) {
      if (!isAudioType(messageType, mediaType)) {
        console.warn(`[whatsapp-dp] mensagem de ${phone} sem texto — tipo="${messageType}/${mediaType}"`);
      }
      registrar({ resultado: "sem_texto", tel: phone.slice(-4), tipo: `${messageType}/${mediaType}` });
      return;
    }

    const resposta = await processarTexto({ phone, texto });
    if (resposta) {
      await enviarTexto({ numero: phone, texto: resposta, delayMs: 900 });
      registrar({ resultado: "respondeu", tel: phone.slice(-4) });
    } else {
      registrar({ resultado: "sem_resposta", tel: phone.slice(-4) });
    }
  } catch (err) {
    registrar({ resultado: "erro", detalhe: String(err.message || err).slice(0, 120) });
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
