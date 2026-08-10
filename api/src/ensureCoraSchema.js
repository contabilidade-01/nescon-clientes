/**
 * Garante que a tabela deliverables tenha a coluna `pdf_url` para boletos
 * que não possuem arquivo local (ex: Cora).
 *
 * Padrão idempotente: ADD COLUMN IF NOT EXISTS — re-runs são no-ops.
 */
async function ensureCoraSchema(db) {
  try {
    // Coluna para guardar a URL pública do PDF (Google Storage via Cora)
    await db.query(`
      ALTER TABLE deliverables
      ADD COLUMN IF NOT EXISTS pdf_url TEXT
    `);

    // Coluna para guardar o valor do boleto em centavos (opcional, para exibição futura)
    await db.query(`
      ALTER TABLE deliverables
      ADD COLUMN IF NOT EXISTS valor_centavos BIGINT
    `);

    console.log("[DB] cora: colunas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureCoraSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureCoraSchema };
