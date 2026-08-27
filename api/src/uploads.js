/**
 * Armazenamento de arquivos em disco (volume `uploads` do compose), partilhado por
 * atestados e entregas da contabilidade.
 *
 * O limite acompanha `client_max_body_size` no nginx/default.conf — mexer nos dois juntos.
 */
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/app/uploads";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Recupera o nome de arquivo quebrado pela decodificação do multer/busboy.
 *
 * O parâmetro `filename` de um multipart é lido como latin1 (ISO-8859-1) por padrão. Um
 * nome enviado em UTF-8 ("Programação de Férias.pdf") chega então como mojibake
 * ("ProgramaÃ§Ã£o de FÃ©rias.pdf"). Reinterpretar os MESMOS bytes como UTF-8 recupera o
 * original.
 *
 * A troca só acontece se o resultado for UTF-8 válido (sem o caractere de substituição
 * U+FFFD): assim, nome puro ASCII fica igual, e o caso raro de um nome que já chegou
 * correto não é corrompido — um nome já-UTF-8 reinterpretado como latin1 produz U+FFFD e
 * mantém-se o original.
 */
function corrigirNomeUtf8(nome) {
  if (!nome || typeof nome !== "string") return nome;
  try {
    const recuperado = Buffer.from(nome, "latin1").toString("utf8");
    if (recuperado && !recuperado.includes("�")) return recuperado;
  } catch {
    /* mantém o original */
  }
  return nome;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Corrige o nome na fronteira: `file.originalname` é o mesmo objeto que vira
    // `req.file.originalname`, então todo consumidor a jusante (título da entrega, nome
    // exibido, classificação) recebe o nome já certo.
    file.originalname = corrigirNomeUtf8(file.originalname);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

function pdfOnlyFilter(_req, file, cb) {
  const isPdf = file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname || "");
  if (!isPdf) return cb(new Error("Apenas arquivos PDF são aceitos"));
  cb(null, true);
}

/** Atestados: o cliente fotografa o atestado, então imagem também vale. */
const uploadAny = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES } });

/** Guias e folha: sempre PDF. */
const uploadPdf = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: pdfOnlyFilter,
});

/** Caminho absoluto dentro de UPLOAD_DIR, ou null se escapar do diretório (path traversal). */
function resolveUploadPath(fileName) {
  const raw = String(fileName || "").replace(/\\/g, "/");
  if (!raw || raw.includes("..")) return null;
  const rel = raw.replace(/^\/+/, "");
  const full = path.resolve(UPLOAD_DIR, rel);
  if (!full.startsWith(path.resolve(UPLOAD_DIR))) return null;
  return full;
}

function removeUploadFile(fileName) {
  const full = resolveUploadPath(fileName);
  if (!full || !fs.existsSync(full)) return;
  try {
    fs.unlinkSync(full);
  } catch (err) {
    console.error("[uploads] falha ao remover", full, err.message);
  }
}

module.exports = {
  UPLOAD_DIR,
  MAX_UPLOAD_BYTES,
  uploadAny,
  uploadPdf,
  resolveUploadPath,
  removeUploadFile,
};
