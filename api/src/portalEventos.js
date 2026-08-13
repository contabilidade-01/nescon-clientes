/**
 * Captura e agregação dos eventos de uso do portal (ver ensureAcessosSchema.js).
 *
 * Gravar é best-effort: um erro aqui nunca pode derrubar o login nem a navegação do
 * cliente — por isso os `registrar*` não lançam, só logam. As consultas de leitura
 * alimentam a tela admin "Controle de acessos".
 */
const db = require("./db");
const { clientIp } = require("./deliverableAccess");

/** Ferramentas válidas (espelho de COMPANY_TOOL_KEYS no front). Barra lixo do ranking. */
const FERRAMENTAS_VALIDAS = new Set([
  "fiscal_guides", "boletos", "payroll_files", "documents", "calendar", "vacations",
  "chat", "suspension", "warning", "chatbot", "salary_adhoc", "employees",
  "certificates", "history",
]);

function registrar(companyId, tipo, ferramenta, req) {
  const ip = req ? clientIp(req) : null;
  const ua = req ? String(req.headers["user-agent"] || "").slice(0, 500) : null;
  db.query(
    `INSERT INTO portal_eventos (company_id, tipo, ferramenta, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [companyId, tipo, ferramenta, ip, ua]
  ).catch((err) => console.error(`[portalEventos] falha ao registrar ${tipo}:`, err.message));
}

/** Um login do cliente. Chamado no fluxo de auth, ao lado de ultimo_login_em. */
function registrarLogin(companyId, req) {
  registrar(companyId, "login", null, req);
}

/** Abertura de uma ferramenta/seção. Ferramenta desconhecida é ignorada em silêncio. */
function registrarUso(companyId, ferramenta, req) {
  if (!FERRAMENTAS_VALIDAS.has(ferramenta)) return false;
  registrar(companyId, "uso", ferramenta, req);
  return true;
}

module.exports = { registrarLogin, registrarUso, FERRAMENTAS_VALIDAS };
