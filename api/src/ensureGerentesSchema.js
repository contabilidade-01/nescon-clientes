/**
 * Gerentes da empresa (ver gerentes.js). CPF único entre todos os gerentes: é o login.
 * `issued_documents.company_user_id` guarda qual gerente emitiu — nulo quando foi o
 * login principal da empresa.
 */
async function ensureGerentesSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS company_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        cpf TEXT NOT NULL,
        nome TEXT NOT NULL,
        email TEXT,
        password_hash TEXT NOT NULL,
        must_change_password BOOLEAN NOT NULL DEFAULT true,
        password_expires_at TIMESTAMPTZ,
        active BOOLEAN NOT NULL DEFAULT true,
        permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
        ultimo_login_em TIMESTAMPTZ,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_company_users_cpf ON company_users(cpf);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_company_users_company ON company_users(company_id);`);
    await db.query(
      `ALTER TABLE issued_documents ADD COLUMN IF NOT EXISTS company_user_id UUID REFERENCES company_users(id) ON DELETE SET NULL;`
    );
    console.log("[DB] company_users verificada.");
  } catch (err) {
    console.error("[DB] ensureGerentesSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureGerentesSchema };
