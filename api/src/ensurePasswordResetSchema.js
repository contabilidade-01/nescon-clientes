/**
 * Bases antigas: garante colunas de e-mail e tabela de tokens para recuperação de senha.
 */
async function ensurePasswordResetSchema(db) {
  await db.query(`
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_email TEXT;
  `);
  await db.query(`
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone TEXT;
  `);
  await db.query(`
    ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS contact_email TEXT;
  `);
  // Empresa que ainda está com a senha inicial (= CNPJ, informação pública): o portal
  // obriga a trocar antes de deixar navegar. Empresas antigas ficam em false — só as
  // criadas a partir daqui (sync/admin) nascem marcadas.
  await db.query(`
    ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
  `);
  await db.query(`
    ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS password_expires_at TIMESTAMPTZ;
  `);
  // Quando o acesso foi ENVIADO por WhatsApp (a mensagem com a senha temporária). É o
  // que a tela "Enviar Acesso" usa para evidenciar quem já recebeu (verde) e quem ainda
  // não recebeu (vermelho). Diferente de `password_expires_at`, que zera quando o cliente
  // troca a senha: este carimbo fica, para o registro de "já mandamos" não se apagar.
  await db.query(`
    ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS acesso_enviado_em TIMESTAMPTZ;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
      admin_id UUID REFERENCES platform_admins(id) ON DELETE CASCADE,
      CONSTRAINT password_reset_single_target CHECK (
        (company_id IS NOT NULL AND admin_id IS NULL) OR
        (company_id IS NULL AND admin_id IS NOT NULL)
      )
    );
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
  `);
}

module.exports = { ensurePasswordResetSchema };
