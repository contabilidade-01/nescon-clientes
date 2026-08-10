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
