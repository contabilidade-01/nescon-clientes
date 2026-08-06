const router = require("express").Router();
const fs = require("fs");
const db = require("../db");
const { authMiddleware, requireCompanyUser } = require("../middleware/auth");
const { adminHasArea } = require("../middleware/adminArea");
const { companyHasTool } = require("../middleware/companyToolAccess");
const { validateUUID, validateDate, validateString } = require("../middleware/validate");
const { uploadAny: upload, resolveUploadPath, removeUploadFile } = require("../uploads");

router.use(authMiddleware);

router.get("/", async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let sql;
    const params = [];

    if (req.isAdmin) {
      if (!adminHasArea(req, "entregas")) {
        return res.status(403).json({ error: "Você não tem acesso a esta área do painel" });
      }
      sql = `SELECT mc.*, e.name AS employee_name, c.name AS company_name, c.cnpj AS company_cnpj
             FROM medical_certificates mc
             JOIN employees e ON mc.employee_id = e.id
             JOIN companies c ON c.id = mc.company_id
             WHERE 1=1`;
      const filterCid = (req.query.company_id || "").toString();
      if (filterCid) {
        if (!validateUUID(filterCid)) {
          return res.status(400).json({ error: "company_id inválido" });
        }
        params.push(filterCid);
        sql += ` AND mc.company_id = $${params.length}`;
      }
    } else {
      if (!req.company?.id) {
        return res.status(403).json({ error: "Sessão de empresa inválida" });
      }
      if (!companyHasTool(req, "certificates")) {
        return res.status(403).json({ error: "Atestados não estão ativos para a sua empresa." });
      }
      const companyId = req.company.id;
      params.push(companyId);
      sql = `SELECT mc.*, e.name AS employee_name 
             FROM medical_certificates mc 
             JOIN employees e ON mc.employee_id = e.id 
             WHERE mc.company_id = $1`;
    }

    if (start_date) {
      if (!validateDate(start_date)) return res.status(400).json({ error: "Data início inválida" });
      params.push(start_date); sql += ` AND mc.certificate_date >= $${params.length}`;
    }
    if (end_date) {
      if (!validateDate(end_date)) return res.status(400).json({ error: "Data fim inválida" });
      params.push(end_date); sql += ` AND mc.certificate_date <= $${params.length}`;
    }

    sql += " ORDER BY mc.certificate_date DESC";
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/", requireCompanyUser, (req, res, next) => {
  if (!companyHasTool(req, "certificates")) {
    return res.status(403).json({ error: "Atestados não estão ativos para a sua empresa." });
  }
  next();
}, upload.single("file"), async (req, res) => {
  try {
    const companyId = req.company.id;
    const { employee_id, certificate_date, notes } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "Arquivo obrigatório" });
    if (!employee_id || !validateUUID(employee_id)) {
      return res.status(400).json({ error: "employee_id inválido" });
    }
    if (certificate_date && !validateDate(certificate_date)) {
      return res.status(400).json({ error: "Data inválida" });
    }
    if (notes && !validateString(notes, 1, 1000)) {
      return res.status(400).json({ error: "Notas muito longas (máx 1000)" });
    }

    // Verify employee belongs to this company
    const empCheck = await db.query("SELECT id FROM employees WHERE id=$1 AND company_id=$2", [employee_id, companyId]);
    if (!empCheck.rows.length) {
      return res.status(403).json({ error: "Funcionário não pertence à sua empresa" });
    }

    const { rows } = await db.query(
      `INSERT INTO medical_certificates (company_id, employee_id, file_path, file_name, certificate_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [companyId, employee_id, file.filename, file.originalname,
       certificate_date || new Date().toISOString().slice(0, 10), notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Download de atestado — CONFERE O DONO, não só o caminho.
 *
 * Antes esta rota validava apenas que o nome não escapava do diretório (path traversal)
 * e entregava o arquivo a qualquer usuário autenticado. Isso é um IDOR: o nome gravado
 * é `<timestamp>-<nome original>`, então bastava conhecer ou adivinhar o nome para uma
 * empresa baixar o atestado médico de funcionário de OUTRA — dado de saúde, o mais
 * sensível que este sistema guarda.
 *
 * Agora o arquivo é localizado pela linha do banco, e a linha é filtrada pela empresa da
 * sessão. Nome que não corresponde a nenhum atestado da empresa devolve 404 — e não 403,
 * que confirmaria a existência do arquivo para quem está sondando.
 */
router.get("/file/:filename", async (req, res) => {
  const nome = String(req.params.filename || "");
  try {
    const params = [nome];
    let sql = "SELECT file_path, file_name, company_id FROM medical_certificates WHERE file_path = $1";
    if (!req.isAdmin) {
      if (!req.company?.id) return res.status(403).json({ error: "Acesso negado" });
      params.push(req.company.id);
      sql += ` AND company_id = $${params.length}`;
    } else if (!adminHasArea(req, "entregas")) {
      return res.status(403).json({ error: "Você não tem acesso a esta área do painel" });
    }

    const { rows } = await db.query(sql, params);
    if (!rows.length) return res.status(404).json({ error: "Arquivo não encontrado" });

    const filePath = resolveUploadPath(rows[0].file_path);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Arquivo não encontrado" });
    }
    // `nosniff` + disposition: impede que um arquivo forjado seja interpretado como
    // página no domínio do portal.
    const seguro = String(rows[0].file_name || "atestado").replace(/[^\w.\- ]/g, "_");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${seguro}"`);
    return res.sendFile(filePath);
  } catch (err) {
    console.error("[certificates] file:", err.message);
    return res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) {
      return res.status(400).json({ error: "ID inválido" });
    }
    let rows;
    if (req.isAdmin) {
      if (!adminHasArea(req, "entregas")) {
        return res.status(403).json({ error: "Você não tem acesso a esta área do painel" });
      }
      const r = await db.query(
        "DELETE FROM medical_certificates WHERE id=$1 RETURNING file_path",
        [req.params.id]
      );
      rows = r.rows;
    } else {
      if (!companyHasTool(req, "certificates")) {
        return res.status(403).json({ error: "Atestados não estão ativos para a sua empresa." });
      }
      const companyId = req.company.id;
      const r = await db.query(
        "DELETE FROM medical_certificates WHERE id=$1 AND company_id=$2 RETURNING file_path",
        [req.params.id, companyId]
      );
      rows = r.rows;
    }
    if (!rows.length) return res.status(404).json({ error: "Atestado não encontrado" });
    if (rows[0]?.file_path) removeUploadFile(rows[0].file_path);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
