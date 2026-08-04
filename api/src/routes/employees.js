const router = require("express").Router();
const db = require("../db");
const { authMiddleware, requireCompanyUser } = require("../middleware/auth");
const { companyHasAnyTool, companyHasTool, EMPLOYEE_LIST_TOOLS } = require("../middleware/companyToolAccess");
const { validateCPF, validateString, validateUUID } = require("../middleware/validate");
const { importEmployeesForCompany } = require("../employeeImport");

// All routes require auth
router.use(authMiddleware);

router.get("/", async (req, res) => {
  try {
    if (req.isAdmin) {
      const filterId = (req.query.company_id || "").toString();
      if (filterId) {
        if (!validateUUID(filterId)) {
          return res.status(400).json({ error: "company_id inválido" });
        }
        const { rows } = await db.query(
          `SELECT e.*, c.name AS company_name, c.cnpj AS company_cnpj
           FROM employees e
           JOIN companies c ON c.id = e.company_id
           WHERE e.company_id = $1
           ORDER BY e.name`,
          [filterId]
        );
        return res.json(rows);
      }
      const { rows } = await db.query(
        `SELECT e.*, c.name AS company_name, c.cnpj AS company_cnpj
         FROM employees e
         JOIN companies c ON c.id = e.company_id
         ORDER BY c.name, e.name`
      );
      return res.json(rows);
    }
    if (!req.company?.id) {
      return res.status(403).json({ error: "Sessão de empresa inválida" });
    }
    if (!companyHasAnyTool(req, EMPLOYEE_LIST_TOOLS)) {
      return res.status(403).json({ error: "Esta ferramenta não está ativa para a sua empresa." });
    }
    const companyId = req.company.id;
    // A empresa vê só ativos; demitidos (active=false) ficam só para o admin.
    const { rows } = await db.query(
      "SELECT * FROM employees WHERE company_id = $1 AND active IS TRUE ORDER BY name",
      [companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/", requireCompanyUser, (req, res, next) => {
  if (!companyHasTool(req, "employees")) {
    return res.status(403).json({ error: "Cadastro de funcionários não está ativo para a sua empresa." });
  }
  next();
}, async (req, res) => {
  try {
    const companyId = req.company.id;
    const { name, cpf, pis } = req.body;

    if (!name || !validateString(name, 2, 200)) {
      return res.status(400).json({ error: "Nome inválido (2-200 caracteres)" });
    }
    if (!cpf || !validateCPF(cpf)) {
      return res.status(400).json({ error: "CPF inválido (11 dígitos)" });
    }
    if (pis && !validateString(pis, 1, 20)) {
      return res.status(400).json({ error: "PIS inválido" });
    }

    const { rows } = await db.query(
      "INSERT INTO employees (company_id, name, cpf, pis) VALUES ($1,$2,$3,$4) RETURNING *",
      [companyId, name.trim(), cpf.replace(/\D/g, ""), pis || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/import", requireCompanyUser, (req, res, next) => {
  if (!companyHasTool(req, "employees")) {
    return res.status(403).json({ error: "Cadastro de funcionários não está ativo para a sua empresa." });
  }
  next();
}, async (req, res) => {
  const companyId = req.company.id;
  const companyCnpj = (req.company.cnpj || "").replace(/\D/g, "");
  const fileCnpj = (req.body?.fileCnpj || "").toString();
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await importEmployeesForCompany(client, companyId, companyCnpj, fileCnpj, rows);
    if (result.status !== 201) {
      await client.query("ROLLBACK");
      return res.status(result.status).json(result.body);
    }
    await client.query("COMMIT");
    return res.status(201).json(result.body);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ error: "Erro interno ao importar funcionários" });
  } finally {
    client.release();
  }
});

router.put("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const { name, cpf, pis, active } = req.body;
    const sets = [];
    const vals = [];
    let i = 1;
    if (name !== undefined) {
      if (!validateString(name, 2, 200)) return res.status(400).json({ error: "Nome inválido" });
      sets.push(`name=$${i++}`); vals.push(name.trim());
    }
    if (cpf !== undefined) {
      if (!validateCPF(cpf)) return res.status(400).json({ error: "CPF inválido" });
      sets.push(`cpf=$${i++}`); vals.push(cpf.replace(/\D/g, ""));
    }
    if (pis !== undefined) { sets.push(`pis=$${i++}`); vals.push(pis); }
    if (active !== undefined) { sets.push(`active=$${i++}`); vals.push(active); }

    if (!sets.length) return res.status(400).json({ error: "Nenhum campo para atualizar" });

    if (req.isAdmin) {
      vals.push(req.params.id);
      const { rows } = await db.query(
        `UPDATE employees SET ${sets.join(",")} WHERE id=$${i} RETURNING *`,
        vals
      );
      if (!rows.length) return res.status(404).json({ error: "Funcionário não encontrado" });
      return res.json(rows[0]);
    }

    if (!companyHasTool(req, "employees")) {
      return res.status(403).json({ error: "Cadastro de funcionários não está ativo para a sua empresa." });
    }
    const companyId = req.company.id;
    vals.push(req.params.id);
    vals.push(companyId);
    const { rows } = await db.query(
      `UPDATE employees SET ${sets.join(",")} WHERE id=$${i} AND company_id=$${i + 1} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Funcionário não encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) {
      return res.status(400).json({ error: "ID inválido" });
    }
    if (req.isAdmin) {
      const { rowCount } = await db.query("DELETE FROM employees WHERE id=$1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Funcionário não encontrado" });
      return res.json({ ok: true });
    }
    if (!companyHasTool(req, "employees")) {
      return res.status(403).json({ error: "Cadastro de funcionários não está ativo para a sua empresa." });
    }
    const companyId = req.company.id;
    const { rowCount } = await db.query(
      "DELETE FROM employees WHERE id=$1 AND company_id=$2",
      [req.params.id, companyId]
    );
    if (!rowCount) return res.status(404).json({ error: "Funcionário não encontrado" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
