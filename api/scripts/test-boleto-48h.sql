-- =============================================================================
-- Teste da trava de 48h do boleto (alertas.previsao, query de deliverables).
--
-- Cenários:
--   A) alert_sent_at IS NULL           → entra (nunca avisado)
--   B) alert_sent_at = now() - 24h     → NÃO entra (menos de 48h)
--   C) alert_sent_at = now() - 50h     → entra (mais de 48h)
--
-- Como rodar:
--   psql "$DATABASE_URL" -f api/scripts/test-boleto-48h.sql
--
-- Saída esperada: 2 linhas na CTE `resultado` (ids A e C).
-- =============================================================================

-- Empresa fake só para o teste. ON CONFLICT para re-rodar sem erro.
INSERT INTO companies (id, name, cnpj)
VALUES ('00000000-0000-0000-0000-000000000001', 'TESTE BOLETO 48H', '00000000000100')
ON CONFLICT (id) DO NOTHING;

-- Três boletos: um nunca avisado, um avisado 24h, um avisado 50h.
-- `hoje` = data corrente; `due_date` cai 3 dias no passado (match com o marco 3).
INSERT INTO deliverables (id, company_id, category, doc_type, title, valor_centavos,
                         due_date, released_at, status, cancelado, historico, alert_sent_at)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'boleto', 'BOLETO_CORA', 'Boleto A — nunca avisado', 10000,
   CURRENT_DATE - 3, now(), 'open', false, false, NULL),
  ('22222222-2222-2222-2222-222222222222',
   '00000000-0000-0000-0000-000000000001',
   'boleto', 'BOLETO_CORA', 'Boleto B — avisado há 24h', 10000,
   CURRENT_DATE - 3, now(), 'open', false, false, now() - interval '24 hours'),
  ('33333333-3333-3333-3333-333333333333',
   '00000000-0000-0000-0000-000000000001',
   'boleto', 'BOLETO_CORA', 'Boleto C — avisado há 50h', 10000,
   CURRENT_DATE - 3, now(), 'open', false, false, now() - interval '50 hours')
ON CONFLICT (id) DO UPDATE SET
  alert_sent_at = EXCLUDED.alert_sent_at,
  status = EXCLUDED.status,
  cancelado = EXCLUDED.cancelado,
  historico = EXCLUDED.historico;

-- Mesma SQL de alertas.js:previsao() (linhas 383-403), com $2 = 30 (max dos
-- marcos [3,10,30]). Resultado esperado: 2 linhas (A e C).
WITH resultado AS (
  SELECT id, title, alert_sent_at
    FROM deliverables
   WHERE category = 'boleto'
     AND status IS DISTINCT FROM 'paid'
     AND cancelado IS NOT TRUE
     AND released_at IS NOT NULL
     AND due_date IS NOT NULL
     AND due_date >= (CURRENT_DATE - $2::int)
     AND historico IS NOT TRUE
     AND (alert_sent_at IS NULL OR alert_sent_at < now() - interval '48 hours')
   ORDER BY due_date
)
SELECT id, title, alert_sent_at
  FROM resultado;

-- ============================================================================
-- Após enviar, alert_sent_at é atualizado para now(). Simula o UPDATE feito por
-- registrarEnvio() e roda a mesma query: AGORA nenhum dos 3 entra.
-- ============================================================================
UPDATE deliverables
   SET alert_sent_at = now()
 WHERE id IN (
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333'
 );

WITH resultado_pos_envio AS (
  SELECT id, title, alert_sent_at
    FROM deliverables
   WHERE category = 'boleto'
     AND status IS DISTINCT FROM 'paid'
     AND cancelado IS NOT TRUE
     AND released_at IS NOT NULL
     AND due_date IS NOT NULL
     AND due_date >= (CURRENT_DATE - $2::int)
     AND historico IS NOT TRUE
     AND (alert_sent_at IS NULL OR alert_sent_at < now() - interval '48 hours')
)
SELECT id, title, alert_sent_at
  FROM resultado_pos_envio;
-- Esperado: 0 linhas (todos foram marcados agora).

-- Limpeza
DELETE FROM deliverables
 WHERE id IN (
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333'
 );
DELETE FROM companies WHERE id = '00000000-0000-0000-0000-000000000001';
