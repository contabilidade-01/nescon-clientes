const { validateCPF, validateString } = require("./middleware/validate");

/** "1.412,00" ou 1412 → 1412. Null quando não dá para ler ou é zero. */
function salarioValido(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function importEmployeesForCompany(client, companyId, companyCnpj, fileCnpj, rows, opts = {}) {
  const cnpjDigits = (companyCnpj || "").replace(/\D/g, "");
  const fileDigits = (fileCnpj || "").toString().replace(/\D/g, "");

  if (!fileDigits || fileDigits.length !== 14) {
    return { status: 400, body: { error: "CNPJ do arquivo não identificado" } };
  }
  if (fileDigits !== cnpjDigits) {
    return { status: 403, body: { error: "CNPJ do arquivo não corresponde à empresa" } };
  }
  if (!rows.length) {
    return { status: 400, body: { error: "Nenhum funcionário enviado para importação" } };
  }
  if (rows.length > 1000) {
    return { status: 400, body: { error: "Limite de 1000 funcionários por importação" } };
  }

  let inserted = 0;
  let skipped = 0;
  const errors = [];

  for (let idx = 0; idx < rows.length; idx += 1) {
    const item = rows[idx] || {};
    const name = (item.name || "").toString().trim().toUpperCase();
    const cpf = (item.cpf || "").toString().replace(/\D/g, "");
    const pis = item.pis ? item.pis.toString().replace(/\D/g, "") : null;
    const codigo = item.codigo ? String(item.codigo).trim().slice(0, 20) : null;
    const salario = salarioValido(item.salarioBase ?? item.salario_base);
    const cargo = item.cargo ? String(item.cargo).trim().slice(0, 120) : null;
    const competencia = opts.competencia || null;

    if (!validateString(name, 2, 200) || !validateCPF(cpf)) {
      errors.push({ row: idx + 1, message: "Nome/CPF inválido" });
      continue;
    }
    if (pis && !validateString(pis, 1, 20)) {
      errors.push({ row: idx + 1, message: "PIS inválido" });
      continue;
    }
    if (item.active === false) {
      skipped += 1;
      continue;
    }

    const exists = await client.query(
      "SELECT 1 FROM employees WHERE company_id = $1 AND cpf = $2 LIMIT 1",
      [companyId, cpf]
    );
    if (exists.rowCount) {
      // Já cadastrado: não recria, mas ATUALIZA o que a folha nova traz de fresco.
      // COALESCE mantém o valor antigo quando o extrato veio sem o campo — melhor um
      // salário de meses atrás do que apagar o único que temos.
      await client.query(
        `UPDATE employees
            SET codigo = COALESCE($3, codigo),
                cargo = COALESCE($6, cargo),
                salario_base = COALESCE($4, salario_base),
                salario_competencia = CASE WHEN $4 IS NULL THEN salario_competencia
                                           ELSE COALESCE($5, salario_competencia) END
          WHERE company_id = $1 AND cpf = $2`,
        [companyId, cpf, codigo, salario, competencia, cargo]
      );
      skipped += 1;
      continue;
    }

    await client.query(
      `INSERT INTO employees
         (company_id, name, cpf, pis, active, codigo, salario_base, salario_competencia, cargo)
       VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8)`,
      [companyId, name, cpf, pis, codigo, salario, salario ? competencia : null, cargo]
    );
    inserted += 1;
  }

  return { status: 201, body: { inserted, skipped, errors } };
}

module.exports = { importEmployeesForCompany };
