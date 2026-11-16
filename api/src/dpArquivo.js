/**
 * Arquivo Word dos termos de advertência/suspensão (issued_documents.file_docx).
 * Usado pelo link avulso e pelo portal: o Word gerado no navegador fica guardado no
 * servidor e pode ser baixado depois pelo link /api/dp-docs/<token>/docx.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { UPLOAD_DIR } = require("./uploads");

function gravarDocx(buffer, nome) {
  const seguro = String(nome || "documento.docx").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const arquivo = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${seguro}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, arquivo), buffer);
  return arquivo;
}

/** DOCX é um ZIP: começa com "PK\x03\x04". Barra qualquer outro arquivo. */
function ehDocx(file) {
  return Boolean(file && file.buffer && file.buffer.length > 4 && file.buffer.readUInt32LE(0) === 0x04034b50);
}

function novoToken() {
  return crypto.randomBytes(24).toString("hex");
}

module.exports = { gravarDocx, ehDocx, novoToken };
