/**
 * Carteira do cliente: de quem é o cliente — do escritório (Nescon) ou pessoal do
 * Jean. Os dois emitem boleto pela mesma conta Cora; a gestão financeira do
 * escritório (FinanceHub) só traz para as transações os boletos da carteira
 * 'nescon', lendo esta coluna por /api/interno/clientes-carteira.
 *
 * Padrão 'nescon': toda empresa já cadastrada é do escritório até alguém marcar
 * o contrário.
 */
const CARTEIRAS = ["nescon", "jean"];

async function ensureCarteiraSchema(db) {
  try {
    await db.query(`
      ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS carteira TEXT NOT NULL DEFAULT 'nescon'
    `);
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_carteira_check') THEN
          ALTER TABLE companies ADD CONSTRAINT companies_carteira_check CHECK (carteira IN ('nescon', 'jean'));
        END IF;
      END $$;
    `);
    console.log("[DB] carteira: coluna verificada.");
  } catch (err) {
    console.error("[DB] ensureCarteiraSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureCarteiraSchema, CARTEIRAS };
