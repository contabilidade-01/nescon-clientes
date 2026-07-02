const { validateCPF, validateString } = require("./middleware/validate");

async function importEmployeesForCompany(client, companyId, companyCnpj, fileCnpj, rows) {
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
      skipped += 1;
      continue;
    }

    await client.query(
      "INSERT INTO employees (company_id, name, cpf, pis, active) VALUES ($1, $2, $3, $4, true)",
      [companyId, name, cpf, pis]
    );
    inserted += 1;
  }

  return { status: 201, body: { inserted, skipped, errors } };
}

module.exports = { importEmployeesForCompany };
