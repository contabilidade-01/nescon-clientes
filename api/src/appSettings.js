/**
 * Configurações que o escritório muda pela tela, sem redeploy.
 *
 * Tabela chave/valor de propósito: são poucas opções e cada uma nasceria como uma
 * coluna nova. Variável de ambiente continua valendo como padrão — a tela só entra
 * quando alguém escolhe explicitamente.
 */
const crypto = require("crypto");

// Prefixo que marca um valor cifrado — sem ele, é texto puro legado (lido normalmente,
// mas nunca mais gravado assim: a próxima gravação já sai cifrada).
const ENC_PREFIX = "enc:v1:";

/** SETTINGS_ENC_KEY vira chave AES-256 por hash — aceita qualquer tamanho de string. */
function chaveCifra() {
  const raw = process.env.SETTINGS_ENC_KEY;
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

/** Cifra um segredo (ex.: chave de API de IA). Sem SETTINGS_ENC_KEY, grava em texto puro. */
function encryptSecret(valor) {
  if (valor === null || valor === undefined) return valor;
  const chave = chaveCifra();
  if (!chave) {
    console.warn(
      "[app_settings] SETTINGS_ENC_KEY não definida — credencial será gravada em texto puro."
    );
    return String(valor);
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", chave, iv);
  const ciphertext = Buffer.concat([cipher.update(String(valor), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decifra um segredo. Valor sem o prefixo é texto puro legado — devolvido como está. */
function decryptSecret(valor) {
  if (valor === null || valor === undefined) return valor;
  if (!valor.startsWith(ENC_PREFIX)) return valor;

  const chave = chaveCifra();
  if (!chave) {
    console.error(
      "[app_settings] credencial cifrada, mas SETTINGS_ENC_KEY não está definida — não é possível decifrar."
    );
    return null;
  }
  try {
    const buf = Buffer.from(valor.slice(ENC_PREFIX.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", chave, iv);
    decipher.setAuthTag(tag);
    const plano = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plano.toString("utf8");
  } catch (err) {
    console.error("[app_settings] falha ao decifrar credencial:", err.message);
    return null;
  }
}

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

/** Grava um segredo (chave de API) cifrado — usar sempre que o valor for uma credencial. */
async function setSecretSetting(db, chave, valor) {
  await setSetting(db, chave, encryptSecret(valor));
}

/** Lê um segredo, decifrando se necessário. Transparente para valores legados em texto puro. */
async function getSecretSetting(db, chave) {
  const v = await getSetting(db, chave);
  return decryptSecret(v);
}

module.exports = {
  ensureAppSettings,
  getSetting,
  getBoolSetting,
  setSetting,
  setSecretSetting,
  getSecretSetting,
};
