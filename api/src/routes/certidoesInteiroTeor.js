/**
 * Certidão de inteiro teor por empresa (painel, área "entregas").
 *
 *   GET    /api/admin/certidoes-inteiro-teor            lista (retidas e liberadas)
 *   POST   /api/admin/certidoes-inteiro-teor/importar   envia PDFs (lote); entram RETIDAS
 *   POST   /api/admin/certidoes-inteiro-teor/:id/liberar   publica para o cliente
 *   POST   /api/admin/certidoes-inteiro-teor/:id/reter     volta a esconder do cliente
 *   DELETE /api/admin/certidoes-inteiro-teor/:id        descarta
 *
 * O PDF de conferência sai pela rota que já existe: GET /api/deliverables/:id/file (o
 * admin enxerga entregas retidas; o cliente, só as liberadas). Regras em
 * certidaoInteiroTeor.js.
 */
const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID } = require("../middleware/validate");
const { uploadPdf, resolveUploadPath, removeUploadFile } = require("../uploads");
const { DOC_TYPE, CATEGORY, lerCertidao, tituloCertidao } = require("../certidaoInteiroTeor");

const router = express.Router();
router.use(authMiddleware);
router.use(requireArea("entregas"));

async function textoDoPdf(buffer) {
  try {
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const { text } = await parser.getText();
    try { await parser.destroy(); } catch { /* nada */ }
    return text || "";
  } catch (err) {
    console.error("[certidoes] falha ao ler o PDF:", err.message);
    return "";
  }
}

const EMPRESA_ATIVA = "c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE";

router.get("/", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT d.id, d.company_id, c.name AS company_name, c.cnpj AS company_cnpj,
              d.title, d.file_name, d.competencia, d.created_at, d.released_at, d.cancelado,
              d.external_ref
         FROM deliverables d
         JOIN companies c ON c.id = d.company_id
        WHERE d.doc_type = $1
        ORDER BY (d.released_at IS NULL) DESC, c.name, d.created_at DESC`,
      [DOC_TYPE]
    );
    res.json(rows);
  } catch (err) {
    console.error("[certidoes listar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Lote de PDFs. Cada arquivo volta com o que aconteceu:
 *   importada     entrou retida para a empresa encontrada
 *   duplicada     o mesmo PDF já estava lá
 *   sem_empresa   nenhum CNPJ do PDF bate com empresa ativa (o painel pede para escolher
 *                 e reenvia com company_id)
 *   nao_certidao  o PDF não parece certidão de inteiro teor
 *
 * `company_id` no corpo força a empresa (vale para todos os arquivos do envio).
 */
router.post("/importar", uploadPdf.array("files", 40), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "Envie ao menos um PDF" });
  const forcada = (req.body?.company_id || "").toString().trim();
  if (forcada && !validateUUID(forcada)) {
    files.forEach((f) => removeUploadFile(f.filename));
    return res.status(400).json({ error: "company_id inválido" });
  }

  const resultados = [];
  for (const file of files) {
    const base = { arquivo: file.originalname };
    try {
      const full = resolveUploadPath(file.filename);
      const buffer = fs.readFileSync(full);
      const sha = crypto.createHash("sha256").update(buffer).digest("hex");
      const lido = lerCertidao(await textoDoPdf(buffer), file.originalname);
      const info = {
        nome: lido.nome,
        cnpjs: lido.cnpjs,
        expedicao: lido.expedicao,
        arquivamento: lido.arquivamento,
      };

      if (!lido.ehCertidao && !forcada) {
        removeUploadFile(file.filename);
        resultados.push({ ...base, ...info, status: "nao_certidao" });
        continue;
      }

      let empresa = null;
      if (forcada) {
        const r = await db.query(`SELECT c.id, c.name, c.cnpj FROM companies c WHERE c.id = $1`, [forcada]);
        empresa = r.rows[0] || null;
      } else if (lido.cnpjs.length) {
        // Na ordem de confiança devolvida pela leitura (quadro do topo primeiro).
        const r = await db.query(
          `SELECT c.id, c.name, c.cnpj, regexp_replace(c.cnpj, '\\D', '', 'g') AS doc
             FROM companies c
            WHERE ${EMPRESA_ATIVA} AND regexp_replace(c.cnpj, '\\D', '', 'g') = ANY($1::text[])`,
          [lido.cnpjs]
        );
        empresa = lido.cnpjs.map((d) => r.rows.find((x) => x.doc === d)).find(Boolean) || null;
      }
      if (!empresa) {
        removeUploadFile(file.filename);
        resultados.push({ ...base, ...info, status: "sem_empresa" });
        continue;
      }

      const ref = `certidao_it:${sha.slice(0, 32)}`;
      const ins = await db.query(
        `INSERT INTO deliverables
           (company_id, category, doc_type, title, competencia, file_path, file_name,
            source, external_ref, access_token, historico, released_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9,true,NULL)
         ON CONFLICT (company_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          empresa.id,
          CATEGORY,
          DOC_TYPE,
          tituloCertidao(lido.expedicao),
          lido.expedicao ? lido.expedicao.slice(0, 7) : null,
          file.filename,
          file.originalname,
          ref,
          crypto.randomBytes(24).toString("hex"),
        ]
      );
      if (!ins.rows.length) {
        removeUploadFile(file.filename);
        resultados.push({ ...base, ...info, status: "duplicada", company_id: empresa.id, empresa: empresa.name });
        continue;
      }
      resultados.push({
        ...base,
        ...info,
        status: "importada",
        id: ins.rows[0].id,
        company_id: empresa.id,
        empresa: empresa.name,
      });
    } catch (err) {
      console.error("[certidoes importar]", file.originalname, err);
      removeUploadFile(file.filename);
      resultados.push({ ...base, status: "erro", erro: "Falha ao processar o arquivo" });
    }
  }
  res.json({ resultados });
});

/**
 * Libera para o cliente. As outras certidões já liberadas da mesma empresa saem da tela
 * do cliente (cancelado), para ele ver só a mais recente; continuam no painel.
 */
router.post("/:id/liberar", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE deliverables SET released_at = COALESCE(released_at, now()), cancelado = false
        WHERE id = $1 AND doc_type = $2
        RETURNING id, company_id`,
      [req.params.id, DOC_TYPE]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Certidão não encontrada" });
    }
    const { rowCount: substituidas } = await client.query(
      `UPDATE deliverables SET cancelado = true
        WHERE company_id = $1 AND doc_type = $2 AND id <> $3
          AND released_at IS NOT NULL AND cancelado IS NOT TRUE`,
      [rows[0].company_id, DOC_TYPE, rows[0].id]
    );
    await client.query("COMMIT");
    res.json({ ok: true, substituidas });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[certidoes liberar]", err);
    res.status(500).json({ error: "Erro interno" });
  } finally {
    client.release();
  }
});

router.post("/:id/reter", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const { rowCount } = await db.query(
      `UPDATE deliverables SET released_at = NULL WHERE id = $1 AND doc_type = $2`,
      [req.params.id, DOC_TYPE]
    );
    if (!rowCount) return res.status(404).json({ error: "Certidão não encontrada" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[certidoes reter]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const { rows } = await db.query(
      `DELETE FROM deliverables WHERE id = $1 AND doc_type = $2 RETURNING file_path`,
      [req.params.id, DOC_TYPE]
    );
    if (!rows.length) return res.status(404).json({ error: "Certidão não encontrada" });
    removeUploadFile(rows[0].file_path);
    res.json({ ok: true });
  } catch (err) {
    console.error("[certidoes descartar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.use((err, req, res, next) => {
  if (!err) return next();
  (req.files || []).forEach((f) => removeUploadFile(f.filename));
  res.status(400).json({ error: err.message || "Envio inválido" });
});

module.exports = router;
