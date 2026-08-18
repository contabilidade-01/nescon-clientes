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

    /*
     * Marca boletos que são honorários mensais do escritório.
     *
     * REGRA ATUAL: TODO boleto que vem da Cora é honorário — é a única fonte de boleto do
     * escritório hoje. Por isso o `coraSync` grava is_honorario=true ao criar, e há um
     * backfill único que marca os antigos (ver coraSync.js). O DEFAULT da coluna segue
     * `false` de propósito: vale para boletos de OUTRAS fontes (a ajustar depois); Cora
     * força true na inserção. A diferenciação honorário × comum importa porque:
     * - A cobrança de honorário usa régua própria em 2 fases (ver honorariosCobranca.js);
     *   o boleto comum usaria os marcos [3, 10, 30] do motor geral.
     * - Mensagem de honorário é mais firme (aviso de bloqueio das entregas / multas).
     * Desmarcar um boleto Cora (torná-lo comum) continua possível pela tela, caso um dia
     * exista um boleto Cora que não seja honorário.
     */
    await db.query(`
      ALTER TABLE deliverables
      ADD COLUMN IF NOT EXISTS is_honorario BOOLEAN NOT NULL DEFAULT false
    `);

    /*
     * Quantas cobranças de honorário já saíram para este boleto.
     *
     * É o que decide a FASE da mensagem (ver honorariosCobranca.js): as 2 primeiras são
     * firmes (aviso de bloqueio); da 3ª em diante, empáticas (estrutura de custos/juros).
     * Contagem, e não data, porque "após 2 mensagens" precisa valer mesmo que um envio
     * tenha escorregado num fim de semana.
     */
    await db.query(`
      ALTER TABLE deliverables
      ADD COLUMN IF NOT EXISTS honorario_cobrancas_enviadas INTEGER NOT NULL DEFAULT 0
    `);

    console.log("[DB] cora: colunas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureCoraSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureCoraSchema };
