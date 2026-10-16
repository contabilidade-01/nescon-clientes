/**
 * Planejador de escalas (fim da 6x1, EC 141/2026). Ver docs/PLANO-ESCALA-6X1.md.
 *
 * Duas tabelas, ambas com o conteúdo em JSONB — a forma do dado é do planejador
 * (src/lib/escala/planejamento.ts) e muda junto com ele, sem migração:
 *  - escala_config: o que vale para a empresa toda (segmento, acordo coletivo, feriados
 *    municipais, bloqueio de jornada, demanda de pessoas por dia).
 *  - escala_planejamentos: a escala de um mês ('YYYY-MM'), uma linha por empresa e mês.
 */
async function ensureEscalasSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS escala_config (
        company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
        dados JSONB NOT NULL DEFAULT '{}'::jsonb,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_por TEXT
      );
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS escala_planejamentos (
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        mes TEXT NOT NULL CHECK (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
        dados JSONB NOT NULL,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_por TEXT,
        PRIMARY KEY (company_id, mes)
      );
    `);
    console.log("[DB] escalas: tabelas verificadas.");
  } catch (err) {
    console.error("[DB] ensureEscalasSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureEscalasSchema };
