/**
 * Garante coluna de permissões por ferramenta (empresas já existentes recebem o default JSON).
 */
const DEFAULT_TOOL_ACCESS_JSON =
  '{"fiscal_guides":true,"boletos":true,"payroll_files":true,"documents":true,"calendar":true,' +
  '"suspension":true,"warning":true,"chatbot":true,"salary_adhoc":true,' +
  '"employees":true,"certificates":true,"history":true}';

async function ensureToolAccessSchema(db) {
  try {
    await db.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS tool_access JSONB
        DEFAULT '${DEFAULT_TOOL_ACCESS_JSON}'::jsonb;
    `);
    await db.query(`
      ALTER TABLE companies ALTER COLUMN tool_access
        SET DEFAULT '${DEFAULT_TOOL_ACCESS_JSON}'::jsonb;
    `);
    await db.query(`
      UPDATE companies
      SET tool_access = '${DEFAULT_TOOL_ACCESS_JSON}'::jsonb
      WHERE tool_access IS NULL;
    `);
    // Chaves novas entram como default nas empresas já existentes; o operador `||` com o
    // valor atual à direita preserva as escolhas que o admin já tinha gravado.
    await db.query(`
      UPDATE companies
      SET tool_access = '${DEFAULT_TOOL_ACCESS_JSON}'::jsonb || tool_access
      WHERE tool_access IS NOT NULL
        AND NOT (tool_access ?& array['fiscal_guides','boletos','payroll_files','documents','calendar']);
    `);
    console.log("[DB] tool_access: coluna verificada/atualizada.");
  } catch (err) {
    console.error("[DB] ensureToolAccessSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureToolAccessSchema };
