/**
 * Download público dos termos de advertência/suspensão emitidos pelo assistente do
 * WhatsApp — sem login, identificado por token opaco (mesmo modelo de
 * `/api/deliverables/public/:token`).
 *
 * Sem login porque quem pede pelo WhatsApp não está no portal, e o uazapi só anexa
 * arquivo a partir de uma URL que ele consiga baixar. O token é aleatório de 24 bytes:
 * não é adivinhável e não expõe id sequencial.
 */
const router = require("express").Router();
const fs = require("fs");
const db = require("../db");
const { resolveUploadPath } = require("../uploads");
const { validateString } = require("../middleware/validate");

const TIPOS = {
  pdf: { coluna: "file_pdf", mime: "application/pdf", disp: "inline" },
  docx: {
    coluna: "file_docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    disp: "attachment",
  },
};

router.get("/:token/:formato", async (req, res) => {
  try {
    const token = String(req.params.token || "");
    const formato = String(req.params.formato || "").toLowerCase();
    const tipo = TIPOS[formato];
    if (!tipo || !validateString(token, 16, 128)) {
      return res.status(404).json({ error: "Documento não encontrado" });
    }

    const { rows } = await db.query(
      `SELECT ${tipo.coluna} AS arquivo, document_type, employee_name
         FROM issued_documents
        WHERE access_token = $1`,
      [token]
    );
    if (!rows.length || !rows[0].arquivo) {
      return res.status(404).json({ error: "Documento não encontrado" });
    }

    const full = resolveUploadPath(rows[0].arquivo);
    if (!full || !fs.existsSync(full)) {
      return res.status(404).json({ error: "Arquivo não disponível" });
    }

    // Nome amigável, sem caractere que permita injeção de cabeçalho.
    const base = `${rows[0].document_type === "suspension" ? "suspensao" : "advertencia"}_${rows[0].employee_name}`
      .replace(/[^\w.\- ]/g, "_");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Content-Type", tipo.mime);
    res.setHeader("Content-Disposition", `${tipo.disp}; filename="${base}.${formato}"`);
    return res.sendFile(full);
  } catch (err) {
    console.error("[dp-docs]", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
