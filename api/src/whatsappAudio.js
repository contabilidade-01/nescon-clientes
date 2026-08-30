/**
 * Transcrição de áudio do WhatsApp (Whisper). Mesma ideia do FinanceHub:
 * OpenAI primeiro, Groq se a OpenAI falhar.
 */
const { getSecretSetting } = require("./appSettings");

async function transcreverAudio(db, buffer, mimetype) {
  const openai =
    process.env.OPENAI_API_KEY || (await getSecretSetting(db, "ia_api_key_chatgpt"));
  const groq = process.env.GROQ_API_KEY || "";
  if (!openai && !groq) {
    throw new Error("Sem OPENAI_API_KEY / GROQ_API_KEY para transcrever áudio");
  }

  const mime = mimetype || "audio/ogg";
  const ext = mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : "ogg";
  const blob = new Blob([buffer], { type: mime });

  async function whisper(url, key, model) {
    const form = new FormData();
    form.append("file", blob, `audio.${ext}`);
    form.append("model", model);
    form.append("language", "pt");
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `transcrição HTTP ${res.status}`);
    return String(data.text || "").trim();
  }

  if (openai) {
    try {
      return await whisper("https://api.openai.com/v1/audio/transcriptions", openai, "whisper-1");
    } catch (err) {
      console.warn("[whatsapp-dp] OpenAI Whisper falhou:", err.message);
      if (!groq) throw err;
    }
  }
  return whisper("https://api.groq.com/openai/v1/audio/transcriptions", groq, "whisper-large-v3");
}

module.exports = { transcreverAudio };
