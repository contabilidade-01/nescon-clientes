/**
 * Fichas de admissão (públicas e do portal). Isolamento por company_id quando o CNPJ
 * é de cliente; prospecto fica com company_id nulo para o admin acompanhar.
 */
async function ensureAdmissionSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS admission_forms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
        origem TEXT NOT NULL,
        edit_token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'novo',
        empresa_cnpj TEXT NOT NULL,
        empresa_nome TEXT NOT NULL,
        contato_email TEXT,
        contato_telefone TEXT,
        dados JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_admission_forms_company
        ON admission_forms(company_id, created_at DESC);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_admission_forms_cnpj
        ON admission_forms(empresa_cnpj);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_admission_forms_status
        ON admission_forms(status, created_at DESC);
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS admission_anexos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form_id UUID NOT NULL REFERENCES admission_forms(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`ALTER TABLE admission_anexos ADD COLUMN IF NOT EXISTS kind TEXT`);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_admission_anexos_form
        ON admission_anexos(form_id);
    `);

    console.log("[DB] admissão: tabelas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureAdmissionSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureAdmissionSchema };
