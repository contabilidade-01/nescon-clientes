/**
 * Regra de honorário por empresa, para o cálculo por headcount da folha.
 *
 * Cada empresa cobrada por essa métrica tem UMA linha: base (cobre até `registros_base`
 * registros) + `adicional` por colaborador a partir do próximo. É por empresa porque
 * unidades diferentes têm valores diferentes (Queijeiros x Maria x futuras).
 *
 * "Estar na cobrança por headcount" = ter uma linha aqui. A tela adiciona/remove.
 *
 * Semeadura idempotente: as empresas que já cobrávamos assim (Queijeiros e Maria
 * Aparecida ... Xavier), quando ativas e ainda sem regra, entram com o padrão 350/3/50
 * — o admin ajusta os números de cada uma na tela depois. Só INSERT ON CONFLICT DO
 * NOTHING, então rodar de novo não sobrescreve o que o escritório já editou.
 */
async function ensureHonorarioRegrasSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS honorario_regras (
        company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
        base NUMERIC(12,2) NOT NULL DEFAULT 350,
        registros_base INTEGER NOT NULL DEFAULT 3,
        adicional NUMERIC(12,2) NOT NULL DEFAULT 50,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await db.query(`
      INSERT INTO honorario_regras (company_id, base, registros_base, adicional)
      SELECT c.id, 350, 3, 50
        FROM companies c
       WHERE c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
         AND (c.name ILIKE '%queijeiro%' OR c.name ILIKE '%maria aparecida%xavier%')
      ON CONFLICT (company_id) DO NOTHING
    `);

    console.log("[DB] honorario_regras: tabela verificada/semeada.");
  } catch (err) {
    console.error("[DB] ensureHonorarioRegrasSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureHonorarioRegrasSchema };
