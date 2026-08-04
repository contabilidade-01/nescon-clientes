/**
 * Configurações que o escritório muda pela tela, sem redeploy.
 *
 * Tabela chave/valor de propósito: são poucas opções e cada uma nasceria como uma
 * coluna nova. Variável de ambiente continua valendo como padrão — a tela só entra
 * quando alguém escolhe explicitamente.
 */
async function ensureAppSettings(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        chave TEXT PRIMARY KEY,
        valor TEXT,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    console.log("[DB] app_settings: tabela verificada/criada.");
  } catch (err) {
    console.error("[DB] ensureAppSettings falhou:", err.message, err.code || "");
    throw err;
  }
}

async function getSetting(db, chave) {
  try {
    const { rows } = await db.query("SELECT valor FROM app_settings WHERE chave = $1", [chave]);
    return rows.length ? rows[0].valor : null;
  } catch (err) {
    // Base ainda sem a tabela: cai no padrão em vez de derrubar quem chamou.
    console.error("[app_settings] leitura falhou:", err.message);
    return null;
  }
}

/** `padrao` vale quando ninguém escolheu nada na tela ainda. */
async function getBoolSetting(db, chave, padrao) {
  const v = await getSetting(db, chave);
  if (v === null) return padrao;
  return v === "true";
}

async function setSetting(db, chave, valor) {
  await db.query(
    `INSERT INTO app_settings (chave, valor) VALUES ($1, $2)
     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
    [chave, valor === null || valor === undefined ? null : String(valor)]
  );
}

module.exports = { ensureAppSettings, getSetting, getBoolSetting, setSetting };
