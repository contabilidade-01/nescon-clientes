/**
 * Arquivo (.pfx) e senha do certificado digital da empresa, guardados cifrados.
 *
 * - O arquivo vai cifrado (AES-256-GCM) no banco e só é decifrado no download do
 *   próprio cliente (login da empresa).
 * - A senha vai cifrada à parte e só é mostrada depois de um código enviado ao e-mail
 *   da empresa (ver rotas em routes/certificadosDigitais.js).
 * - Chave: CERT_ENC_KEY (ou SETTINGS_ENC_KEY). Sem chave, NADA é gravado — nunca em texto puro.
 */
const crypto = require("crypto");
const tls = require("tls");

const MAX_PFX_BYTES = 200 * 1024;
const CODIGO_MINUTOS = 10;
const CODIGO_TENTATIVAS = 5;
const CODIGO_REENVIO_SEGUNDOS = 60;

function chave() {
  const raw = process.env.CERT_ENC_KEY || process.env.SETTINGS_ENC_KEY;
  if (!raw) return null;
  // Deriva uma chave própria do certificado, mesmo quando reaproveita SETTINGS_ENC_KEY.
  return crypto.createHash("sha256").update(`certificado-digital:${raw}`).digest();
}

function cifraDisponivel() {
  return chave() !== null;
}

/** Buffer → Buffer [iv 12][tag 16][dados]. Lança se não houver chave. */
function cifrar(plano) {
  const k = chave();
  if (!k) throw new Error("CERT_ENC_KEY não configurada: o arquivo não pode ser guardado");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const dados = Buffer.concat([c.update(plano), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), dados]);
}

function decifrar(buf) {
  const k = chave();
  if (!k) throw new Error("CERT_ENC_KEY não configurada");
  const b = Buffer.from(buf);
  const d = crypto.createDecipheriv("aes-256-gcm", k, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

const cifrarTexto = (s) => cifrar(Buffer.from(String(s), "utf8")).toString("base64");
const decifrarTexto = (s) => decifrar(Buffer.from(String(s), "base64")).toString("utf8");

/**
 * Confere se a senha abre o .pfx. Retorna { ok } ou { ok:false, motivo }.
 * Certificados antigos com cifra que o OpenSSL 3 não lê mais passam como "nao_verificado".
 */
function conferirPfx(pfx, senha) {
  try {
    tls.createSecureContext({ pfx, passphrase: senha });
    return { ok: true };
  } catch (err) {
    const msg = String(err && err.message || "");
    if (/mac verify|bad decrypt|wrong password|mac_verify/i.test(msg)) return { ok: false, motivo: "senha_incorreta" };
    if (/unsupported|algorithm/i.test(msg)) return { ok: true, nao_verificado: true };
    return { ok: false, motivo: "arquivo_invalido" };
  }
}

/** Nome do arquivo que o cliente baixa: nunca leva a senha. */
function nomeDownload(cnpj, venceEm) {
  const doc = String(cnpj || "").replace(/\D/g, "") || "empresa";
  const v = String(venceEm || "").slice(0, 10);
  return `Certificado digital ${doc}${v ? ` - vence ${v}` : ""}.pfx`;
}

function gerarCodigo() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashCodigo(companyId, codigo) {
  return crypto.createHash("sha256").update(`${companyId}:${String(codigo).trim()}`).digest("hex");
}

module.exports = {
  MAX_PFX_BYTES,
  CODIGO_MINUTOS,
  CODIGO_TENTATIVAS,
  CODIGO_REENVIO_SEGUNDOS,
  cifraDisponivel,
  cifrar,
  decifrar,
  cifrarTexto,
  decifrarTexto,
  conferirPfx,
  nomeDownload,
  gerarCodigo,
  hashCodigo,
};
