/**
 * Jornada no cadastro do funcionário (fim da 6x1, EC 141/2026; ver docs/PLANO-JORNADAS-42-40.md).
 *
 * Antes a jornada só existia na ficha de admissão e na escala salva do mês. Sem ela no
 * cadastro, o escritório não conseguia dizer quais clientes ainda têm gente acima de 42h.
 * Todos os campos são opcionais: quem não preencheu aparece como "jornada não informada".
 *
 *  - carga_semanal: horas contratuais por semana (44, 42, 40, 36…).
 *  - escala: '5x2' | '6x1' | '12x36' | '4x3' | 'outra'.
 *  - folga: texto livre na mesma lista da ficha de admissão ("Domingo", "Segunda-feira"…).
 *  - horario_entrada / horario_saida: 'HH:MM'.
 *  - hipersuficiente: nível superior e salário >= 2,5x o teto do RGPS (art. 8º da EC).
 *
 * Em companies, a conferência da lista pelo cliente: quando e quem confirmou que a lista
 * de funcionários está certa.
 */
async function ensureJornadaSchema(db) {
  try {
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS carga_semanal NUMERIC(5,2);`);
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS escala TEXT;`);
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS folga TEXT;`);
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS horario_entrada TEXT;`);
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS horario_saida TEXT;`);
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS hipersuficiente BOOLEAN NOT NULL DEFAULT false;`);
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS jornada_atualizada_em TIMESTAMPTZ;`);
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS funcionarios_conferidos_em TIMESTAMPTZ;`);
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS funcionarios_conferidos_por TEXT;`);
    console.log("[DB] jornada: campos de funcionário e conferência verificados.");
  } catch (err) {
    console.error("[DB] ensureJornadaSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureJornadaSchema };
