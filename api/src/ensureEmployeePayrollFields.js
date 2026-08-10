/**
 * Campos do funcionário que vêm do Extrato Mensal e faltavam no cadastro.
 *
 * Por que agora: sem **salário base** não dá para dizer quanto custarão as férias, e sem
 * o **código** o casamento entre a folha e a Programação de Férias teria de ser por nome
 * — que quebra com acento, nome composto e grafia diferente. O código é único dentro da
 * empresa e já vinha sendo lido do extrato; só era descartado na importação.
 *
 * `salario_competencia` guarda de qual folha veio o valor: um salário de seis meses atrás
 * ainda serve para estimar, mas a tela precisa poder dizer que é antigo.
 */
async function ensureEmployeePayrollFields(db) {
  try {
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS codigo TEXT;`);
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS salario_base NUMERIC(12,2);`);
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS salario_competencia TEXT;`);
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS cargo TEXT;`);
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS vinculo TEXT;`);
    // Backfill: preencher vinculo a partir do cargo para quem já estava no banco
    await db.query(`
      UPDATE employees SET vinculo = 'Diretor'
       WHERE vinculo IS NULL AND cargo IS NOT NULL
         AND cargo ~* '(diretor|diretora|s[oó]cio|s[oó]cia|titular|pr[oó] ?-? ?labore)';
    `);
    await db.query(`
      UPDATE employees SET vinculo = 'Estagiário'
       WHERE vinculo IS NULL AND cargo IS NOT NULL
         AND cargo ~* 'estagi[aá]ri';
    `);
    await db.query(`
      UPDATE employees SET vinculo = 'Celetista'
       WHERE vinculo IS NULL AND cargo IS NOT NULL
         AND cargo !~* '(diretor|diretora|s[oó]cio|s[oó]cia|titular|pr[oó] ?-? ?labore|estagi[aá]ri)';
    `);
    // Forçar reprocessamento do extrato para empresas que têm employees sem vínculo
    // (o extrato anterior não extraía vinculo, então o processado_id travou)
    const { rowCount } = await db.query(`
      UPDATE companies SET extrato_processado_id = NULL
       WHERE id IN (
         SELECT DISTINCT company_id FROM employees WHERE vinculo IS NULL AND active IS TRUE
       ) AND extrato_processado_id IS NOT NULL;
    `);
    if (rowCount > 0) {
      console.log(`[DB] ${rowCount} empresa(s) marcada(s) para reprocessar extrato (vinculo faltando).`);
    }
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_employees_company_codigo
        ON employees(company_id, codigo);
    `);
    console.log("[DB] employees: codigo/salario/vinculo verificados.");
  } catch (err) {
    console.error("[DB] ensureEmployeePayrollFields falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureEmployeePayrollFields };
