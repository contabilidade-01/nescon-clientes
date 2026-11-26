/**
 * Códigos de 6 dígitos por e-mail para entrar no recálculo SEM LOGIN (página /recalculo).
 * Ver recalculoCodigo.js para o modelo de segurança. Só o HASH do código fica gravado.
 */
async function ensureRecalculoCodigosSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS recalculo_codigos (
        id SERIAL PRIMARY KEY,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        codigo_hash TEXT NOT NULL,
        email TEXT NOT NULL,
        expira_em TIMESTAMPTZ NOT NULL,
        tentativas INTEGER NOT NULL DEFAULT 0,
        usado_em TIMESTAMPTZ,
        cancelado_em TIMESTAMPTZ,
        ip TEXT,
        acesso_link_id INTEGER,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_recalculo_codigos_empresa ON recalculo_codigos(company_id, criado_em DESC);`);
  } catch (err) {
    console.error("[ensureRecalculoCodigosSchema]", err.message);
  }
}

module.exports = { ensureRecalculoCodigosSchema };
