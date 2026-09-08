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
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS escala_12x36 BOOLEAN`);
    // Semeadura ÚNICA: só preenche quem ainda está NULL. A escala passou a ser editável
    // na tela de Empresas, então um UPDATE incondicional (como era antes) apagaria a
    // configuração do escritório a cada deploy.
    await db.query(
      `UPDATE companies SET escala_12x36 =
         regexp_replace(COALESCE(cnpj, ''), '[^0-9]', '', 'g') IN ($1, $2)
       WHERE escala_12x36 IS NULL`,
      ["52191264000173", "54803962000108"]
    );
    console.log("[DB] whatsapp DP: sessão e escala 12x36 verificadas.");
  } catch (err) {
    console.error("[DB] ensureWhatsappDpSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureWhatsappDpSchema };
