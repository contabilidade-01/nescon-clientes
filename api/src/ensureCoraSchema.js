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

    /*
     * Boleto cancelado/rejeitado na Cora.
     *
     * Antes ele era mapeado para `status = 'paid'`, porque o tipo do portal só admite
     * pendente ou pago e cancelado de fato não é conta a pagar. O efeito colateral era
     * ruim nos dois lados: o cliente via "Pago" num boleto que ninguém pagou, e o total
     * de pagos do painel vinha inflado.
     *
     * Coluna própria em vez de apagar a linha: é dado financeiro, e sumir do banco
     * impediria explicar depois por que aquele boleto deixou de existir. Some da TELA,
     * permanece no registro — e volta sozinho se a Cora reabrir a cobrança.
     */
    await db.query(`
      ALTER TABLE deliverables
      ADD COLUMN IF NOT EXISTS cancelado BOOLEAN NOT NULL DEFAULT false
    `);

    // Listagens filtram por isto em toda tela; sem índice, varredura a cada abertura.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_deliverables_cancelado
        ON deliverables(cancelado) WHERE cancelado IS TRUE
    `);

    console.log("[DB] cora: colunas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureCoraSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureCoraSchema };
