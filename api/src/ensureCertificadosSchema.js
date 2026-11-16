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
    console.log("[DB] certificado digital: tabela verificada/criada.");
  } catch (err) {
    console.error("[DB] ensureCertificadosSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureCertificadosSchema };
