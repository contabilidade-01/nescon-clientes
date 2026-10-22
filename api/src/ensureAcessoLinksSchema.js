/**
 * Link de acesso às guias SEM SENHA (enviado no WhatsApp/e-mail cadastrado da empresa).
 *
 * O token é aleatório (32 bytes) e não carrega dado nenhum. Escopo fixo: só a tela de
 * guias daquela empresa (`/g/:token`) — nunca o resto do portal. Vence sozinho, o
 * escritório revoga pelo painel e cada acesso conta.
 *
 * origem: 'mensal' (aviso de guia do mês) | 'cobranca' (impostos em atraso / recálculo)
 */
async function ensureAcessoLinksSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS acesso_links (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        origem TEXT NOT NULL,
        cobranca_id INTEGER,
        expira_em TIMESTAMPTZ NOT NULL,
        revogado_em TIMESTAMPTZ,
        revogado_por TEXT,
        acessos INTEGER NOT NULL DEFAULT 0,
        ultimo_acesso_em TIMESTAMPTZ,
        ultimo_acesso_ip TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_acesso_links_empresa ON acesso_links(company_id, origem, expira_em);`);
  } catch (err) {
    console.error("[ensureAcessoLinksSchema]", err.message);
  }
}

module.exports = { ensureAcessoLinksSchema };
