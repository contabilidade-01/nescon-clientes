/**
 * Envio de guias do MEI (DAS MEI e parcelas) pelo WhatsApp, a pedido do central-ecac.
 *
 * Uma linha por guia enviada, idempotente por `external_ref` (o central-ecac manda a
 * mesma referência se o escritório clicar duas vezes). O PDF vira um `deliverable`
 * liberado, com `access_token`: é a URL pública que a uazapi baixa para anexar no WhatsApp.
 *
 * status: enviada | na_fila (fora da janela ou teto/hora) | falhou | sem_whatsapp | ignorada
 */
async function ensureGuiasMeiSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS guias_mei_envios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        external_ref TEXT NOT NULL UNIQUE,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        deliverable_id UUID,
        tipo TEXT NOT NULL,
        competencia TEXT NOT NULL,
        vencimento DATE,
        valor NUMERIC(12,2),
        status TEXT NOT NULL DEFAULT 'na_fila',
        motivo TEXT,
        tentativas INTEGER NOT NULL DEFAULT 0,
        numero TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        enviado_em TIMESTAMPTZ,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_guias_mei_status ON guias_mei_envios(status, criado_em);`
    );
  } catch (err) {
    console.error("[ensureGuiasMeiSchema]", err.message);
  }
}

module.exports = { ensureGuiasMeiSchema };
