/**
 * Acompanhamentos mensais do escritório: ramificações (folha, impostos, NF MEI),
 * tarefas geradas por competência e cofre de credenciais dos MEIs.
 */
async function ensureMonthlyFollowSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS monthly_follow_kinds (
        id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        descricao TEXT,
        prazo_tipo TEXT NOT NULL,
        prazo_n INTEGER,
        default_assignee_id UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
        ordem INTEGER NOT NULL DEFAULT 0,
        ativo BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS monthly_follow_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind_id TEXT NOT NULL REFERENCES monthly_follow_kinds(id) ON DELETE CASCADE,
        competencia TEXT NOT NULL,
        due_date DATE NOT NULL,
        assigned_admin_id UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pendente',
        notes TEXT,
        completed_at TIMESTAMPTZ,
        completed_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (kind_id, competencia)
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_monthly_follow_tasks_comp
        ON monthly_follow_tasks(competencia, kind_id);
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS mei_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
        nome TEXT NOT NULL,
        cnpj TEXT,
        portal TEXT,
        login TEXT,
        senha_enc TEXT,
        observacao TEXT,
        assigned_admin_id UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
        ativo BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_mei_credentials_ativo
        ON mei_credentials(ativo, nome);
    `);

    await db.query(
      `INSERT INTO monthly_follow_kinds (id, titulo, descricao, prazo_tipo, prazo_n, ordem)
       VALUES
         ('folha', 'Conferir folha', 'Conferir a folha de pagamento até o 5º dia útil do mês.', 'n_dia_bancario', 5, 1),
         ('impostos', 'Conferir impostos', 'Conferir impostos até o 10º dia útil do mês.', 'n_dia_bancario', 10, 2),
         ('nf_mei', 'Emitir NFs MEIs', 'Emitir as notas fiscais dos MEIs no último dia útil do mês.', 'ultimo_dia_bancario', NULL, 3)
       ON CONFLICT (id) DO NOTHING`
    );

    console.log("[DB] acompanhamentos mensais: tabelas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureMonthlyFollowSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureMonthlyFollowSchema };
