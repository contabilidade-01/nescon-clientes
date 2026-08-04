/**
 * Programação de Férias importada.
 *
 * Duas tabelas, pelo mesmo motivo do espelho do G-Click: o que chegou fica registrado
 * (auditoria) e quem manda nas telas é a **última** importação da empresa.
 *
 * `source` nasce como 'manual' porque hoje o G-Click não expõe este relatório na API.
 * Quando houver a tarefa lá, a mesma gravação atende com `source = 'gclick'` — por isso
 * a coluna existe desde já, em vez de ser acrescentada depois.
 */
async function ensureVacationSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS vacation_uploads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        data_base DATE,
        emissao DATE,
        arquivo_nome TEXT,
        total_empregados INTEGER,
        total_declarado INTEGER,
        source TEXT NOT NULL DEFAULT 'manual',
        criado_por UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_vacation_uploads_empresa
        ON vacation_uploads(company_id, criado_em DESC);
    `);

    // Uma linha por funcionário × período aquisitivo. Nada aqui é calculado: os dias de
    // direito vêm do próprio relatório (ver o comentário no topo de vacationRules.js).
    await db.query(`
      CREATE TABLE IF NOT EXISTS vacation_periods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        upload_id UUID NOT NULL REFERENCES vacation_uploads(id) ON DELETE CASCADE,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        codigo TEXT,
        nome TEXT NOT NULL,
        admissao DATE,
        ferias_vencidas INTEGER NOT NULL DEFAULT 0,
        inicio_aquisitivo DATE,
        fim_aquisitivo DATE,
        inicio_gozo DATE,
        limite_gozo DATE,
        dias_acumulados NUMERIC(5,1) NOT NULL DEFAULT 0,
        dias_gozados NUMERIC(5,1) NOT NULL DEFAULT 0,
        dias_direito NUMERIC(5,1) NOT NULL DEFAULT 0,
        dias_afastamento INTEGER NOT NULL DEFAULT 0,
        faltas INTEGER NOT NULL DEFAULT 0,
        ordem INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_vacation_periods_upload
        ON vacation_periods(upload_id, ordem);
    `);
    // O portal do cliente lista pelo vencimento mais próximo.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_vacation_periods_limite
        ON vacation_periods(company_id, limite_gozo);
    `);

    console.log("[DB] férias: tabelas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureVacationSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureVacationSchema };
