/**
 * Rastreio de abertura/download das entregas.
 *
 * Espelha a regra do sistema de guias (app/helpers.py): preview de link do WhatsApp e
 * crawlers NÃO contam como abertura real do cliente — ficam gravados com eh_bot=true
 * para auditoria, mas fora dos números.
 */
const db = require("./db");

const BOT_UAS = [
  "whatsapp", "facebookexternalhit", "facebot", "telegrambot", "twitterbot",
  "slackbot", "discordbot", "linkedinbot", "bingbot", "googlebot", "bot",
  "crawler", "spider", "preview", "curl", "wget", "python-httpx", "headless",
];

/** Sem user-agent também é tratado como suspeito (não conta como abertura real). */
function isBotUserAgent(ua) {
  if (!ua) return true;
  const u = String(ua).toLowerCase();
  return BOT_UAS.some((b) => u.includes(b));
}

/** IP real atrás do proxy do Easypanel (o app já usa trust proxy). */
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "?";
}

/**
 * Grava o acesso sem segurar a resposta ao cliente (o download é o que importa).
 * Falha aqui nunca quebra a entrega do arquivo.
 */
function recordAccess(req, deliverableId, evento) {
  const ua = req.headers["user-agent"] || "";
  const ip = clientIp(req);
  const ehBot = isBotUserAgent(ua);
  db.query(
    `INSERT INTO deliverable_accesses (deliverable_id, evento, ip, user_agent, eh_bot)
     VALUES ($1,$2,$3,$4,$5)`,
    [deliverableId, evento, ip, ua.slice(0, 500), ehBot]
  ).catch((err) => console.error("[access] falha ao registrar acesso:", err.message));
}

/**
 * Resumo por entrega, no MESMO formato do db.acessos_por_envio do sistema de guias
 * ({aberturas, downloads, ultimo_em, ultimo_ip}) — assim a tela de auditoria de lá
 * consome sem mudar o template.
 */
async function accessSummary(deliverableIds) {
  if (!Array.isArray(deliverableIds) || deliverableIds.length === 0) return {};
  // ultimo_em em UTC 'YYYY-MM-DDTHH:MM:SS' — mesmo formato do agora_iso() do sistema
  // de guias, para as duas origens aparecerem iguais na tela de auditoria dele.
  const { rows } = await db.query(
    `SELECT deliverable_id,
            count(*) FILTER (WHERE evento = 'pagina')   AS aberturas,
            count(*) FILTER (WHERE evento = 'download') AS downloads,
            to_char(max(acessado_em) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS ultimo_em,
            (array_agg(ip ORDER BY acessado_em DESC) FILTER (WHERE ip IS NOT NULL))[1] AS ultimo_ip
     FROM deliverable_accesses
     WHERE eh_bot = false AND deliverable_id = ANY($1::uuid[])
     GROUP BY deliverable_id`,
    [deliverableIds]
  );
  const out = {};
  for (const r of rows) {
    out[r.deliverable_id] = {
      aberturas: Number(r.aberturas),
      downloads: Number(r.downloads),
      ultimo_em: r.ultimo_em,
      ultimo_ip: r.ultimo_ip,
    };
  }
  return out;
}

module.exports = { isBotUserAgent, clientIp, recordAccess, accessSummary };
