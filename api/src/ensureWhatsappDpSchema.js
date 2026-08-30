async function ensureWhatsappDpSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_dp_sessions (
        phone TEXT PRIMARY KEY,
        company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
        tema TEXT,
        step TEXT NOT NULL DEFAULT 'idle',
        dados JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    console.log("[DB] whatsapp DP: sessão verificada/criada.");
  } catch (err) {
    console.error("[DB] ensureWhatsappDpSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureWhatsappDpSchema };
