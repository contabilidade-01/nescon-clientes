/**
 * Licenças e taxas do cliente + consentimento LGPD.
 *
 * Regra central: NÃO existe coluna de "situação da licença". Guardamos só a data de
 * vencimento e o estado (ativa / a vencer / vencida / ausente) é CALCULADO na leitura
 * (ver licenseStatus.js). Assim nada envelhece na base e o painel nunca mente.
 *
 * Renovação = nova linha em company_licenses. A licença "vigente" de um tipo é sempre
 * a de maior vence_em — o histórico fica preservado.
 */
async function ensureLicensesSchema(db) {
  try {
    // Empresa "estabelecida" = tem endereço/ponto físico e por isso precisa de licenças.
    // Não estabelecida (ex.: prestador sem sede aberta) fica fora da cobrança do painel.
    await db.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS established BOOLEAN NOT NULL DEFAULT true;
    `);
    // LGPD: carimbo do aceite. Nulo = ainda não concordou.
    await db.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS lgpd_consent_at TIMESTAMPTZ;
    `);
    await db.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS lgpd_consent_ip TEXT;
    `);
    await db.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS lgpd_consent_version TEXT;
    `);
    // Consentimento é opcional (não bloqueia o portal), mas o aviso só aparece uma vez:
    // esta marca guarda quando foi exibido, mesmo sem aceite.
    await db.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS lgpd_prompt_seen_at TIMESTAMPTZ;
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS company_licenses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (tipo IN ('funcionamento', 'avcb_clcb', 'sanitaria')),
        numero TEXT,
        orgao TEXT,
        emitida_em DATE,
        vence_em DATE NOT NULL,
        observacao TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_company_licenses_vigente
        ON company_licenses(company_id, tipo, vence_em DESC);
    `);

    // Guia da taxa anual da prefeitura: uma linha por empresa e ano.
    // 'pendente' = ainda não saiu; 'enviado' = escritório mandou; 'confirmado' = cliente
    // confirmou o recebimento.
    await db.query(`
      CREATE TABLE IF NOT EXISTS annual_tax_receipts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        ano INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pendente'
          CHECK (status IN ('pendente', 'enviado', 'confirmado')),
        enviado_em TIMESTAMPTZ,
        confirmado_em TIMESTAMPTZ,
        observacao TEXT,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (company_id, ano)
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_annual_tax_receipts_ano
        ON annual_tax_receipts(ano, status);
    `);

    console.log("[DB] licencas/taxas/LGPD: tabelas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureLicensesSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureLicensesSchema };
