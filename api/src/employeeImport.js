const { validateCPF, validateString } = require("./middleware/validate");
const { normalizarNome, unificarAutomatico } = require("./employeeUnify");

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
  let inativados = 0;
  let reativados = 0;
  let cpfsCompletados = 0;
  const errors = [];
  const origem = opts.origem === "cliente" ? "cliente" : "escritorio";

  // Listagem sem CPF (ex.: "Relação de Empregados" do Domínio) casa pelo nome.
  const porNome = new Map();
  const { rows: atuais } = await client.query(
    "SELECT id, name, cpf, active FROM employees WHERE company_id = $1",
    [companyId]
  );
  for (const e of atuais) {
    const k = normalizarNome(e.name);
    if (!porNome.has(k)) porNome.set(k, []);
    porNome.get(k).push(e);
  }

  /** Aplica a situação da planilha (demitido/trabalhando) a um cadastro existente. */
  const aplicarSituacao = async (id, ativoAgora, ativoPlanilha) => {
    if (typeof ativoPlanilha !== "boolean" || ativoAgora === ativoPlanilha) return;
    await client.query("UPDATE employees SET active = $2 WHERE id = $1", [id, ativoPlanilha]);
    if (ativoPlanilha) {
      reativados += 1;
    } else {
      inativados += 1;
      // A planilha diz que foi demitido: o aviso "sumiu da folha" perde o sentido.
      await client.query(
        `UPDATE employee_exit_alerts
            SET situacao = 'resolvido', resolucao = 'inativado', resolvido_em = now()
          WHERE situacao = 'pendente' AND employee_id = $1`,
        [id]
      );
    }
  };

  for (let idx = 0; idx < rows.length; idx += 1) {
    const item = rows[idx] || {};
    const name = (item.name || "").toString().trim().toUpperCase();
    const cpf = (item.cpf || "").toString().replace(/\D/g, "");
    const pis = item.pis ? item.pis.toString().replace(/\D/g, "") : null;
    const codigo = item.codigo ? String(item.codigo).trim().slice(0, 20) : null;
    const salario = salarioValido(item.salarioBase ?? item.salario_base);
    const cargo = item.cargo ? String(item.cargo).trim().slice(0, 120) : null;
    const vinculo = item.vinculo ? String(item.vinculo).trim().slice(0, 60) : null;
    const ehContribuinte = item.ehContribuinte === true;
    const competencia = opts.competencia || null;

    // `active` explícito vem da planilha (data de demissão / situação); o extrato não manda.
    const ativoPlanilha = typeof item.active === "boolean" ? item.active : undefined;

    if (!cpf) {
      // Linha só com nome: atualiza quem já existe; cadastra provisório quem é novo.
      if (!validateString(name, 2, 200)) {
        errors.push({ row: idx + 1, message: "Nome inválido" });
        continue;
      }
      const iguais = porNome.get(normalizarNome(name)) || [];
      if (iguais.length > 1) {
        errors.push({ row: idx + 1, message: `Mais de um cadastro com o nome ${name}` });
        continue;
      }
      if (iguais.length === 1) {
        await aplicarSituacao(iguais[0].id, iguais[0].active !== false, ativoPlanilha);
        iguais[0].active = ativoPlanilha ?? iguais[0].active;
        skipped += 1;
        continue;
      }
      if (ativoPlanilha === false) {
        skipped += 1;
        continue;
      }
      // Sem CPF ainda: fica provisório e a folha completa (unificação pelo nome).
      const { rows: novo } = await client.query(
        `INSERT INTO employees (company_id, name, cpf, active, origem)
         VALUES ($1, $2, '', true, $3) RETURNING id`,
        [companyId, name, origem]
      );
      porNome.set(normalizarNome(name), [{ id: novo[0].id, name, cpf: "", active: true }]);
      inserted += 1;
      continue;
    }

    if (!validateString(name, 2, 200) || !validateCPF(cpf)) {
      errors.push({ row: idx + 1, message: "Nome/CPF inválido" });
      continue;
    }
    if (pis && !validateString(pis, 1, 20)) {
      errors.push({ row: idx + 1, message: "PIS inválido" });
      continue;
    }

    let exists = await client.query(
      "SELECT id, active FROM employees WHERE company_id = $1 AND cpf = $2 LIMIT 1",
      [companyId, cpf]
    );
    if (!exists.rowCount) {
      // Já cadastrado pelo nome, mas sem CPF (veio de listagem sem CPF): completa o CPF
      // no mesmo cadastro em vez de criar outro.
      const semCpf = (porNome.get(normalizarNome(name)) || []).filter(
        (e) => String(e.cpf || "").replace(/\D/g, "").length !== 11
      );
      if (semCpf.length === 1) {
        await client.query("UPDATE employees SET cpf = $2, pis = COALESCE(pis, $3) WHERE id = $1", [
          semCpf[0].id,
          cpf,
          pis,
        ]);
        semCpf[0].cpf = cpf;
        cpfsCompletados += 1;
        exists = { rowCount: 1, rows: [{ id: semCpf[0].id, active: semCpf[0].active }] };
      }
    }
    if (exists.rowCount) {
      await aplicarSituacao(exists.rows[0].id, exists.rows[0].active !== false, ativoPlanilha);
      // Já cadastrado: não recria, mas ATUALIZA o que a folha nova traz de fresco.
      // COALESCE mantém o valor antigo quando o extrato veio sem o campo — melhor um
      // salário de meses atrás do que apagar o único que temos.
      // Cadastro provisório do cliente casado pelo CPF: o nome da folha passa a valer.
      await client.query(
        `UPDATE employees
            SET name = CASE WHEN codigo IS NULL AND origem = 'cliente' AND $3::text IS NOT NULL
                            THEN $9 ELSE name END,
                codigo = COALESCE($3, codigo),
                cargo = COALESCE($6, cargo),
                vinculo = COALESCE($7, vinculo),
                eh_contribuinte = CASE WHEN $8 THEN true ELSE eh_contribuinte END,
                salario_base = COALESCE($4, salario_base),
                salario_competencia = CASE WHEN $4 IS NULL THEN salario_competencia
                                           ELSE COALESCE($5, salario_competencia) END
          WHERE company_id = $1 AND cpf = $2`,
        [companyId, cpf, codigo, salario, competencia, cargo, vinculo, ehContribuinte, name]
      );
      skipped += 1;
      continue;
    }
    if (ativoPlanilha === false) {
      // Demitido e nunca cadastrado: nada a fazer.
      skipped += 1;
      continue;
    }

    await client.query(
      `INSERT INTO employees
         (company_id, name, cpf, pis, active, codigo, salario_base, salario_competencia, cargo, vinculo, eh_contribuinte, origem)
       VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, $10, $11)`,
      [companyId, name, cpf, pis, codigo, salario, salario ? competencia : null, cargo, vinculo, ehContribuinte, origem]
    );
    inserted += 1;
  }

  // Quem o cliente cadastrou antes da folha chegar vira um só com o cadastro oficial.
  const unificados = await unificarAutomatico(client, companyId);

  return { status: 201, body: { inserted, skipped, errors, inativados, reativados, unificados, cpfsCompletados } };
}

module.exports = { importEmployeesForCompany };
