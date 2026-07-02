const router = require("express").Router();
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { validateUUID, validateEmailFormat, validateString, validateCNPJ } = require("../middleware/validate");
const { mergeToolAccess } = require("../companyTools");
const { listCompanies, insertCompanyRow, PG_UNDEFINED_COLUMN } = require("../toolAccessDb");
const { importEmployeesForCompany } = require("../employeeImport");

const QUEIJEIRO_COMPANY_SEEDS = [
  { name: "RESTAURANTE DO QUEIJEIRO 3 LIMITADA", cnpj: "52191264000173" },
  { name: "RESTAURANTE DO QUEIJEIRO 4 LTDA", cnpj: "54803962000108" },
];

function adminOnly(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: "Acesso restrito a administradores" });
  }
  next();
}

router.use(authMiddleware);
router.use(adminOnly);

router.get("/summary", async (_req, res) => {
  try {
    const [c, d, e, cert] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS n FROM companies"),
      db.query("SELECT COUNT(*)::int AS n FROM issued_documents"),
      db.query("SELECT COUNT(*)::int AS n FROM employees"),
      db.query("SELECT COUNT(*)::int AS n FROM medical_certificates"),
    ]);
    res.json({
      companies: c.rows[0].n,
      documents: d.rows[0].n,
      employees: e.rows[0].n,
      certificates: cert.rows[0].n,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/companies", async (_req, res) => {
  try {
    const rows = await listCompanies(db);
    res.json(rows.map((r) => ({ ...r, tool_access: mergeToolAccess(r.tool_access) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

function normalizePhone(val) {
  if (val === null || val === undefined || val === "") return null;
  const d = String(val).replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return null;
  return d;
}

/** Senha inicial = CNPJ só dígitos (igual aos seeds). */
router.post("/companies", async (req, res) => {
  try {
    const { name, cnpj, contact_email, phone } = req.body;
    if (!validateString(name, 2, 200)) {
      return res.status(400).json({ error: "Razão social inválida (2–200 caracteres)" });
    }
    const rawCnpj = (cnpj || "").toString();
    const cnpjDigits = rawCnpj.replace(/\D/g, "");
    if (!validateCNPJ(rawCnpj) || cnpjDigits.length !== 14) {
      return res.status(400).json({ error: "CNPJ inválido (14 dígitos)" });
    }
    let emailNorm = null;
    if (contact_email !== undefined && contact_email !== null && String(contact_email).trim()) {
      emailNorm = normalizeEmailField(contact_email);
      if (!validateEmailFormat(emailNorm)) {
        return res.status(400).json({ error: "E-mail inválido" });
      }
    }
    let phoneNorm = null;
    if (phone !== undefined && phone !== null && String(phone).trim()) {
      phoneNorm = normalizePhone(phone);
      if (!phoneNorm) {
        return res.status(400).json({ error: "Telefone inválido (mínimo 8 dígitos)" });
      }
    }
    const passwordHash = await bcrypt.hash(cnpjDigits, 10);
    const created = await insertCompanyRow(db, {
      name: name.trim(),
      cnpjDigits,
      passwordHash,
      emailNorm,
      phoneNorm,
    });
    res.status(201).json({
      company: { ...created, tool_access: mergeToolAccess(created.tool_access) },
      message: "Empresa criada. Login: CNPJ com ou sem máscara. Senha inicial: só os 14 dígitos do CNPJ.",
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "CNPJ já cadastrado" });
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

function normalizeEmailField(val) {
  if (val === null || val === undefined || val === "") return null;
  return String(val).trim().toLowerCase();
}

router.get("/me", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, cpf, contact_email FROM platform_admins WHERE id = $1",
      [req.admin.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Não encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/me/contact-email", async (req, res) => {
  try {
    if (!Object.prototype.hasOwnProperty.call(req.body, "contact_email")) {
      return res.status(400).json({ error: "contact_email é obrigatório no corpo (use null ou \"\" para limpar)" });
    }
    const norm = normalizeEmailField(req.body.contact_email);
    if (norm && !validateEmailFormat(norm)) {
      return res.status(400).json({ error: "E-mail inválido" });
    }
    await db.query("UPDATE platform_admins SET contact_email = $1 WHERE id = $2", [
      norm,
      req.admin.id,
    ]);
    res.json({ ok: true, contact_email: norm });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/companies/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });

    const sets = [];
    const vals = [];
    let i = 1;
    let newRazaoSocial = null;

    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      const n = req.body.name;
      if (n === null || n === "") {
        return res.status(400).json({ error: "Razão social não pode ser vazia" });
      }
      if (!validateString(n, 2, 200)) {
        return res.status(400).json({ error: "Razão social inválida (2–200 caracteres)" });
      }
      newRazaoSocial = String(n).trim();
      sets.push(`name = $${i++}`);
      vals.push(newRazaoSocial);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "contact_email")) {
      const norm = normalizeEmailField(req.body.contact_email);
      if (norm && !validateEmailFormat(norm)) {
        return res.status(400).json({ error: "E-mail inválido" });
      }
      sets.push(`contact_email = $${i++}`);
      vals.push(norm);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "phone")) {
      const p = req.body.phone === null || req.body.phone === "" ? null : normalizePhone(req.body.phone);
      if (p === null && (req.body.phone === null || req.body.phone === "")) {
        sets.push(`phone = $${i++}`);
        vals.push(null);
      } else if (!p) {
        return res.status(400).json({ error: "Telefone inválido" });
      } else {
        sets.push(`phone = $${i++}`);
        vals.push(p);
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "tool_access")) {
      const ta = req.body.tool_access;
      if (ta === null || typeof ta !== "object" || Array.isArray(ta)) {
        return res.status(400).json({ error: "tool_access deve ser um objeto com as chaves das ferramentas" });
      }
      sets.push(`tool_access = $${i++}::jsonb`);
      vals.push(JSON.stringify(mergeToolAccess(ta)));
    }

    if (!sets.length) {
      return res.status(400).json({
        error: "Envie ao menos um campo: name, contact_email, phone ou tool_access",
      });
    }

    vals.push(id);
    const hasToolAccessSet = sets.some((s) => s.startsWith("tool_access"));
    const sqlBase = `UPDATE companies SET ${sets.join(", ")} WHERE id = $${i}`;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      let rows;
      let rowCount;
      try {
        const r = await client.query(
          `${sqlBase} RETURNING id, name, cnpj, contact_email, phone, tool_access, created_at`,
          vals
        );
        rows = r.rows;
        rowCount = r.rowCount;
      } catch (e) {
        if (e.code === PG_UNDEFINED_COLUMN && hasToolAccessSet) {
          await client.query("ROLLBACK");
          return res.status(503).json({
            error:
              "A base ainda não tem a coluna tool_access. Reinicie o contentor da API (migração no arranque) ou execute db/migration-add-tool-access.sql no Postgres.",
          });
        }
        if (e.code === PG_UNDEFINED_COLUMN) {
          await client.query("ROLLBACK");
          await client.query("BEGIN");
          const r = await client.query(
            `${sqlBase} RETURNING id, name, cnpj, contact_email, phone, created_at`,
            vals
          );
          rows = r.rows.map((row) => ({ ...row, tool_access: null }));
          rowCount = r.rowCount;
        } else {
          throw e;
        }
      }
      if (!rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Empresa não encontrada" });
      }
      if (newRazaoSocial) {
        await client.query(`UPDATE issued_documents SET company_name = $1 WHERE company_id = $2`, [
          newRazaoSocial,
          id,
        ]);
      }
      await client.query("COMMIT");
      const row = rows[0];
      res.json({ ...row, tool_access: mergeToolAccess(row.tool_access) });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/seed/queijeiros-companies", async (_req, res) => {
  try {
    const results = [];
    for (const seed of QUEIJEIRO_COMPANY_SEEDS) {
      const passwordHash = await bcrypt.hash(seed.cnpj, 10);
      try {
        const created = await insertCompanyRow(db, {
          name: seed.name,
          cnpjDigits: seed.cnpj,
          passwordHash,
          emailNorm: null,
          phoneNorm: null,
        });
        results.push({ cnpj: seed.cnpj, name: seed.name, status: "created", id: created.id });
      } catch (err) {
        if (err.code === "23505") {
          const { rows } = await db.query(
            "SELECT id, name, cnpj FROM companies WHERE cnpj = $1 LIMIT 1",
            [seed.cnpj]
          );
          results.push({
            cnpj: seed.cnpj,
            name: rows[0]?.name ?? seed.name,
            status: "exists",
            id: rows[0]?.id,
          });
        } else {
          throw err;
        }
      }
    }
    res.json({ ok: true, companies: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno ao cadastrar empresas Queijeiro" });
  }
});

router.post("/companies/:id/import-employees", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });

    const { rows: companyRows } = await db.query(
      "SELECT id, cnpj FROM companies WHERE id = $1 LIMIT 1",
      [id]
    );
    if (!companyRows.length) return res.status(404).json({ error: "Empresa não encontrada" });

    const company = companyRows[0];
    const fileCnpj = (req.body?.fileCnpj || "").toString();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await importEmployeesForCompany(
        client,
        company.id,
        company.cnpj,
        fileCnpj,
        rows
      );
      if (result.status !== 201) {
        await client.query("ROLLBACK");
        return res.status(result.status).json(result.body);
      }
      await client.query("COMMIT");
      return res.status(201).json(result.body);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno ao importar funcionários" });
  }
});

module.exports = router;
