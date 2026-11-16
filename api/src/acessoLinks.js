/**
 * Links de acesso às guias sem senha — criação, validação e revogação.
 * Ver ensureAcessoLinksSchema.js para o modelo de segurança.
 */
const crypto = require("crypto");

const DIAS_PADRAO = { mensal: 40, cobranca: 35 };

function novoToken() {
  return crypto.randomBytes(32).toString("hex");
}

function urlDoLink(token) {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}/g/${token}` : null;
}

/**
 * Link ativo da empresa para a origem (reaproveita o que ainda vale ≥ 3 dias, para a
 * mesma pessoa não receber um link diferente a cada mensagem) ou cria um novo.
 */
async function obterOuCriar(db, { companyId, origem, cobrancaId = null, dias = null, novo = false }) {
  if (!DIAS_PADRAO[origem]) throw new Error(`origem inválida: ${origem}`);
  const validade = Math.max(1, Number(dias || DIAS_PADRAO[origem]));
  // `novo`: alerta manual — cada envio tem o seu link (vale `dias` a partir de agora).
  const { rows } = novo ? { rows: [] } : await db.query(
    `SELECT token FROM acesso_links
      WHERE company_id = $1 AND origem = $2 AND revogado_em IS NULL
        AND expira_em >= now() + ($4::int * interval '1 day') - interval '1 day'
        AND ($3::int IS NULL OR cobranca_id = $3::int)
      ORDER BY expira_em DESC LIMIT 1`,
    [companyId, origem, cobrancaId, validade]
  );
  if (rows.length) return rows[0].token;
  const token = novoToken();
  await db.query(
    `INSERT INTO acesso_links (token, company_id, origem, cobranca_id, expira_em)
     VALUES ($1, $2, $3, $4, now() + ($5::int * interval '1 day'))`,
    [token, companyId, origem, cobrancaId, validade]
  );
  return token;
}

/** Link válido (não vencido, não revogado) → { link, empresa } ou null. */
async function validar(db, token) {
  const tok = String(token || "").replace(/[^a-f0-9]/g, "");
  if (tok.length !== 64) return null;
  const { rows } = await db.query(
    `SELECT l.id, l.token, l.company_id, l.origem, l.cobranca_id, l.expira_em,
            c.name, c.cnpj, c.arquivada, c.excluida
       FROM acesso_links l JOIN companies c ON c.id = l.company_id
      WHERE l.token = $1 AND l.revogado_em IS NULL AND l.expira_em > now()`,
    [tok]
  );
  if (!rows.length || rows[0].arquivada || rows[0].excluida) return null;
  const r = rows[0];
  return {
    link: { id: r.id, origem: r.origem, cobranca_id: r.cobranca_id, expira_em: r.expira_em },
    empresa: { id: r.company_id, name: r.name, cnpj: r.cnpj },
  };
}

async function registrarAcesso(db, linkId, ip) {
  try {
    await db.query(
      `UPDATE acesso_links SET acessos = acessos + 1, ultimo_acesso_em = now(), ultimo_acesso_ip = $2 WHERE id = $1`,
      [linkId, String(ip || "").slice(0, 60)]
    );
  } catch (err) {
    console.error("[acessoLinks] acesso:", err.message);
  }
}

async function revogarDaEmpresa(db, companyId, quem) {
  const { rowCount } = await db.query(
    `UPDATE acesso_links SET revogado_em = now(), revogado_por = $2
      WHERE company_id = $1 AND revogado_em IS NULL AND expira_em > now()`,
    [companyId, String(quem || "").slice(0, 120)]
  );
  return rowCount;
}

async function listarDaEmpresa(db, companyId) {
  const { rows } = await db.query(
    `SELECT id, origem, criado_em, expira_em, revogado_em, acessos, ultimo_acesso_em
       FROM acesso_links WHERE company_id = $1 ORDER BY criado_em DESC LIMIT 10`,
    [companyId]
  );
  return rows;
}

module.exports = { obterOuCriar, validar, registrarAcesso, revogarDaEmpresa, listarDaEmpresa, urlDoLink, DIAS_PADRAO };
