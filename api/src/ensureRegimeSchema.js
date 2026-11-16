/**
 * Simulador de regime no Simples (IBS/CBS). Ver docs/PLANO-SIMULADOR-REGIME.md.
 *
 * regime_simulacoes: o questionário e os dados de cada empresa, em JSONB — a forma do dado
 * é do simulador (src/lib/regime/simular.ts) e muda junto com ele, sem migração. Uma linha
 * por empresa; o histórico de simulações salvas fica dentro de `dados`.
 */
async function ensureRegimeSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS regime_simulacoes (
        company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
        dados JSONB NOT NULL DEFAULT '{}'::jsonb,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_por TEXT
      );
    `);
    console.log("[DB] regime: tabela verificada.");
  } catch (err) {
    console.error("[DB] ensureRegimeSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureRegimeSchema };
