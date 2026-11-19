/**
 * Certificado digital das empresas (ver certificadoDigital.js). Uma linha por
 * certificado; renovar = nova linha. O vigente é o de maior vence_em.
 */
async function ensureCertificadosSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS company_certificados (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL DEFAULT 'a1' CHECK (tipo IN ('a1', 'a3')),
        titular TEXT NOT NULL DEFAULT 'e_cnpj' CHECK (titular IN ('e_cnpj', 'e_cpf')),
        emissor TEXT,
        emitido_em DATE,
        vence_em DATE NOT NULL,
        observacao TEXT,
        -- Quem registrou: 'escritorio' (painel) ou 'cliente' (portal).
        origem TEXT NOT NULL DEFAULT 'escritorio' CHECK (origem IN ('escritorio', 'cliente')),
        avisado_em TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_company_certificados_vigente
        ON company_certificados(company_id, vence_em DESC);
    `);
    // Arquivo .pfx e senha, ambos cifrados (certificadoArquivo.js). Nunca em texto puro.
    await db.query(`
      ALTER TABLE company_certificados ADD COLUMN IF NOT EXISTS arquivo_cifrado BYTEA;
      ALTER TABLE company_certificados ADD COLUMN IF NOT EXISTS arquivo_tamanho INTEGER;
      ALTER TABLE company_certificados ADD COLUMN IF NOT EXISTS arquivo_em TIMESTAMPTZ;
      ALTER TABLE company_certificados ADD COLUMN IF NOT EXISTS senha_cifrada TEXT;
    `);
    // Código por e-mail para o cliente ver a senha.
    await db.query(`
      CREATE TABLE IF NOT EXISTS certificado_senha_codigos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        codigo_hash TEXT NOT NULL,
        email TEXT NOT NULL,
        expira_em TIMESTAMPTZ NOT NULL,
        tentativas INTEGER NOT NULL DEFAULT 0,
        usado_em TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_cert_senha_codigos_company
        ON certificado_senha_codigos(company_id, created_at DESC);
    `);
    // Quem baixou o arquivo e quem viu a senha.
    await db.query(`
      CREATE TABLE IF NOT EXISTS certificado_acessos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        certificado_id UUID REFERENCES company_certificados(id) ON DELETE SET NULL,
        acao TEXT NOT NULL CHECK (acao IN ('download', 'senha_vista', 'codigo_enviado', 'codigo_errado')),
        ip TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_cert_acessos_company ON certificado_acessos(company_id, created_at DESC);
    `);
    console.log("[DB] certificado digital: tabela verificada/criada.");
  } catch (err) {
    console.error("[DB] ensureCertificadosSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureCertificadosSchema };
