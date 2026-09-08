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
    // Queijeiro 3 e 4 são 12x36 POR DEFINIÇÃO — sempre automático, sem chaveamento. Força
    // `true` no banco (idempotente) mesmo que a linha já tenha ficado false, casando com a
    // lista fixa do front (src/lib/suspensaoPeriodo.ts). O `IS DISTINCT FROM true` evita
    // escrita à toa quando já está correto.
    await db.query(
      `UPDATE companies SET escala_12x36 = true
         WHERE regexp_replace(COALESCE(cnpj, ''), '[^0-9]', '', 'g') IN ($1, $2)
           AND escala_12x36 IS DISTINCT FROM true`,
      ["52191264000173", "54803962000108"]
    );
    // Demais empresas: default false só na PRIMEIRA vez (coluna NULL). A escala é editável
    // na tela de Empresas, então nunca sobrescrevemos a configuração do escritório aqui —
    // um UPDATE incondicional (como era antes) apagaria a edição a cada deploy.
    await db.query(
      `UPDATE companies SET escala_12x36 = false
         WHERE escala_12x36 IS NULL
           AND regexp_replace(COALESCE(cnpj, ''), '[^0-9]', '', 'g') NOT IN ($1, $2)`,
      ["52191264000173", "54803962000108"]
    );
    console.log("[DB] whatsapp DP: sessão e escala 12x36 verificadas.");
  } catch (err) {
    console.error("[DB] ensureWhatsappDpSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureWhatsappDpSchema };
