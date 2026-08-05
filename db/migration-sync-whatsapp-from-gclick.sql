-- Migration: copiar phone do gclick_clients para companies.whatsapp
-- Executa UMA VEZ para popular os números. Depois, a tela de preferências mantém.
-- Só preenche onde companies.whatsapp está vazio (não sobrescreve edição manual).
--
-- Lógica: gclick_clients.company_id referencia companies.id (quando o escritório
-- já vinculou o cliente G-Click a uma empresa do portal).

UPDATE companies c
SET whatsapp = gc.phone
FROM gclick_clients gc
WHERE gc.company_id = c.id
  AND gc.phone IS NOT NULL
  AND gc.phone != ''
  AND (c.whatsapp IS NULL OR c.whatsapp = '');
