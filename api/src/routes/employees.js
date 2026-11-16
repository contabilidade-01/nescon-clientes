const router = require("express").Router();
const db = require("../db");
const { authMiddleware, requireCompanyUser } = require("../middleware/auth");
const { adminHasArea } = require("../middleware/adminArea");
const { companyHasAnyTool, companyHasTool, EMPLOYEE_LIST_TOOLS } = require("../middleware/companyToolAccess");
const { validateCPF, validateString, validateUUID } = require("../middleware/validate");
const { importEmployeesForCompany } = require("../employeeImport");
const { lerJornada } = require("../employeeJornada");

/**
 * Poderes do cliente sobre a lista: quem usa alguma ferramenta que depende da lista de
 * funcionários (advertência, suspensão, atestados, escalas…) pode adicionar, editar e
 * excluir. Antes o cadastro aceitava qualquer uma dessas ferramentas, mas editar e excluir
 * exigiam a ferramenta "Funcionários": o cliente adicionava e não conseguia corrigir.
 */
function podeGerirLista(req) {
  return companyHasAnyTool(req, EMPLOYEE_LIST_TOOLS);
}
const SEM_PODER = "Cadastro de funcionários não está ativo para a sua empresa.";

// All routes require auth
router.use(authMiddleware);

router.get("/", async (req, res) => {
  try {
    if (req.isAdmin) {
      if (!adminHasArea(req, "funcionarios")) {
        return res.status(403).json({ error: "Você não tem acesso a esta área do painel" });
      }
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
    // A empresa vê só ativos (é a lista das advertências, atestados…). Com ?inativos=1
    // devolve os que saíram, para a tela de Funcionários mostrar à parte e reativar.
    const inativos = req.query.inativos === "1" || req.query.inativos === "true";
    const { rows } = await db.query(
      `SELECT * FROM employees WHERE company_id = $1 AND active IS ${inativos ? "NOT TRUE" : "TRUE"}
        ORDER BY ${inativos ? "inativado_em DESC NULLS LAST, name" : "name"}`,
      [companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Cadastro pelo cliente, sem aprovação do escritório: quem entrou no dia 01 precisa
 * poder receber advertência/atestado antes da folha chegar. Basta a empresa ter alguma
 * ferramenta que usa a lista de funcionários. O cadastro nasce `origem = 'cliente'` e
 * é unificado com o do escritório quando a folha chegar (ver employeeUnify.js).
 */
router.post("/", requireCompanyUser, (req, res, next) => {
  if (!podeGerirLista(req)) return res.status(403).json({ error: SEM_PODER });
  next();
}, async (req, res) => {
  try {
    const companyId = req.company.id;
    const { name, cpf, pis } = req.body;
    const jornada = lerJornada(req.body);
    if (jornada.erro) return res.status(400).json({ error: jornada.erro });

    if (!name || !validateString(name, 2, 200)) {
      return res.status(400).json({ error: "Nome inválido (2-200 caracteres)" });
    }
    if (!cpf || !validateCPF(cpf)) {
      return res.status(400).json({ error: "CPF inválido (11 dígitos)" });
    }
    if (pis && !validateString(pis, 1, 20)) {
      return res.status(400).json({ error: "PIS inválido" });
    }

    const cpfDigits = cpf.replace(/\D/g, "");
    const { rows: existentes } = await db.query(
      "SELECT * FROM employees WHERE company_id = $1 AND cpf = $2 ORDER BY active DESC LIMIT 1",
      [companyId, cpfDigits]
    );
    if (existentes.length) {
      if (existentes[0].active) {
        return res.status(409).json({ error: "Já existe um funcionário ativo com este CPF", employee: existentes[0] });
      }
      // Recontratação: o cadastro antigo volta a valer (histórico preservado).
      const { rows } = await db.query(
        "UPDATE employees SET active = true, pis = COALESCE($2, pis) WHERE id = $1 RETURNING *",
        [existentes[0].id, pis || null]
      );
      return res.status(200).json(rows[0]);
    }

    const j = jornada.campos;
    const temJornada = Object.keys(j).length > 0;
    const { rows } = await db.query(
      `INSERT INTO employees (company_id, name, cpf, pis, origem, carga_semanal, escala, folga,
                              horario_entrada, horario_saida, hipersuficiente, jornada_atualizada_em)
       VALUES ($1,$2,$3,$4,'cliente',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        companyId, name.trim().toUpperCase(), cpfDigits, pis || null,
        j.carga_semanal ?? null, j.escala ?? null, j.folga ?? null,
        j.horario_entrada ?? null, j.horario_saida ?? null, j.hipersuficiente ?? false,
        temJornada ? new Date() : null,
      ]
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
    const result = await importEmployeesForCompany(client, companyId, companyCnpj, fileCnpj, rows, {
      origem: "cliente",
    });
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

/** Inativado à mão: o aviso "sumiu da folha" daquela pessoa perde o sentido. */
async function fecharAvisosDeSaida(employeeId) {
  await db.query(
    `UPDATE employee_exit_alerts
        SET situacao = 'resolvido', resolucao = 'inativado', resolvido_em = now()
      WHERE situacao = 'pendente' AND employee_id = $1`,
    [employeeId]
  );
}

/**
 * Conferência da lista pelo cliente: ele revisa quem está na lista (exclui, adiciona,
 * edita a jornada) e confirma que está certa. O escritório vê quando foi a última vez.
 */
router.get("/conferencia", async (req, res) => {
  try {
    if (req.isAdmin && !adminHasArea(req, "funcionarios")) {
      return res.status(403).json({ error: "Você não tem acesso a esta área do painel" });
    }
    const companyId = req.isAdmin ? (req.query.company_id || "").toString() : req.company?.id;
    if (!companyId || !validateUUID(companyId)) return res.status(400).json({ error: "Empresa inválida" });
    const { rows } = await db.query(
      `SELECT funcionarios_conferidos_em AS conferido_em, funcionarios_conferidos_por AS conferido_por
         FROM companies WHERE id = $1`,
      [companyId]
    );
    res.json(rows[0] || { conferido_em: null, conferido_por: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/conferencia", requireCompanyUser, async (req, res) => {
  try {
    if (!podeGerirLista(req)) return res.status(403).json({ error: SEM_PODER });
    const { rows } = await db.query(
      `UPDATE companies SET funcionarios_conferidos_em = now(), funcionarios_conferidos_por = $2
        WHERE id = $1
        RETURNING funcionarios_conferidos_em AS conferido_em, funcionarios_conferidos_por AS conferido_por`,
      [req.company.id, req.companyUser ? "gerente" : "empresa"]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
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
    if (active !== undefined) {
      if (typeof active !== "boolean") return res.status(400).json({ error: "Situação inválida" });
      sets.push(`active=$${i++}`); vals.push(active);
      // Quem inativou e quando: o cliente pode dar a saída antes da folha chegar, e o
      // escritório precisa saber que não foi a folha que tirou a pessoa.
      sets.push(`inativado_em = ${active ? "NULL" : "now()"}`);
      sets.push(`inativado_por=$${i++}`); vals.push(active ? null : req.isAdmin ? "escritorio" : "cliente");
    }

    const jornada = lerJornada(req.body);
    if (jornada.erro) return res.status(400).json({ error: jornada.erro });
    const camposJornada = Object.entries(jornada.campos);
    for (const [col, val] of camposJornada) {
      sets.push(`${col}=$${i++}`); vals.push(val);
    }
    if (camposJornada.length) sets.push("jornada_atualizada_em = now()");

    if (!sets.length) return res.status(400).json({ error: "Nenhum campo para atualizar" });

    if (req.isAdmin) {
      if (!adminHasArea(req, "funcionarios")) {
        return res.status(403).json({ error: "Você não tem acesso a esta área do painel" });
      }
      vals.push(req.params.id);
      const { rows } = await db.query(
        `UPDATE employees SET ${sets.join(",")} WHERE id=$${i} RETURNING *`,
        vals
      );
      if (!rows.length) return res.status(404).json({ error: "Funcionário não encontrado" });
      if (active === false) await fecharAvisosDeSaida(rows[0].id);
      return res.json(rows[0]);
    }

    if (!podeGerirLista(req)) return res.status(403).json({ error: SEM_PODER });
    const companyId = req.company.id;
    vals.push(req.params.id);
    vals.push(companyId);
    const { rows } = await db.query(
      `UPDATE employees SET ${sets.join(",")} WHERE id=$${i} AND company_id=$${i + 1} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Funcionário não encontrado" });
    if (active === false) await fecharAvisosDeSaida(rows[0].id);
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
      if (!adminHasArea(req, "funcionarios")) {
        return res.status(403).json({ error: "Você não tem acesso a esta área do painel" });
      }
      const { rowCount } = await db.query("DELETE FROM employees WHERE id=$1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Funcionário não encontrado" });
      return res.json({ ok: true });
    }
    if (!podeGerirLista(req)) return res.status(403).json({ error: SEM_PODER });
    const companyId = req.company.id;
    // Excluir apaga junto os atestados da pessoa (ON DELETE CASCADE). Quem tem atestado
    // saiu da empresa, não foi cadastrado por engano: inativar guarda o histórico.
    const { rows: atestados } = await db.query(
      `SELECT count(*)::int AS n FROM medical_certificates m
         JOIN employees e ON e.id = m.employee_id
        WHERE m.employee_id = $1 AND e.company_id = $2`,
      [req.params.id, companyId]
    );
    if (atestados[0]?.n > 0) {
      return res.status(409).json({
        error: "Este funcionário tem atestados no histórico. Use Inativar: ele sai da lista e o histórico fica guardado.",
        code: "TEM_HISTORICO",
      });
    }
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
