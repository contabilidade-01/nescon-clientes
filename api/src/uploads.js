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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
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
  const base = path.basename(fileName || "");
  if (!base) return null;
  const full = path.resolve(UPLOAD_DIR, base);
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
