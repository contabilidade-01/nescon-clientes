-- Permissões por ferramenta (executar uma vez em bases já existentes, ou confiar no ensureToolAccessSchema na API)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tool_access JSONB
  DEFAULT '{"fiscal_guides":true,"boletos":true,"payroll_files":true,"documents":true,"calendar":true,"suspension":true,"warning":true,"chatbot":true,"salary_adhoc":true,"employees":true,"certificates":true,"history":true}'::jsonb;

ALTER TABLE companies ALTER COLUMN tool_access
  SET DEFAULT '{"fiscal_guides":true,"boletos":true,"payroll_files":true,"documents":true,"calendar":true,"suspension":true,"warning":true,"chatbot":true,"salary_adhoc":true,"employees":true,"certificates":true,"history":true}'::jsonb;

UPDATE companies
SET tool_access = '{"fiscal_guides":true,"boletos":true,"payroll_files":true,"documents":true,"calendar":true,"suspension":true,"warning":true,"chatbot":true,"salary_adhoc":true,"employees":true,"certificates":true,"history":true}'::jsonb
WHERE tool_access IS NULL;

-- Chaves do Portal do Cliente nas empresas antigas; o valor atual fica à direita do `||`
-- para não sobrepor as escolhas já gravadas pelo admin.
UPDATE companies
SET tool_access = '{"fiscal_guides":true,"boletos":true,"payroll_files":true,"documents":true,"calendar":true,"suspension":true,"warning":true,"chatbot":true,"salary_adhoc":true,"employees":true,"certificates":true,"history":true}'::jsonb || tool_access
WHERE tool_access IS NOT NULL
  AND NOT (tool_access ?& array['fiscal_guides','boletos','payroll_files','documents','calendar']);
