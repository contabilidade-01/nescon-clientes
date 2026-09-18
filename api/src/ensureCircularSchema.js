/**
 * Circular: mensagem (texto + vídeo/imagem) do escritório para as empresas ativas.
 *
 * `circulares` guarda o que foi composto; `circular_envios` guarda para quem foi e como
 * terminou — uma linha por destinatário. A mesma circular pode ter vários lotes (primeiro
 * o teste para uma empresa, depois "todas"): quem já recebeu não entra de novo.
 */
async function ensureCircularSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS circulares (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      texto TEXT NOT NULL DEFAULT '',
      midia_arquivo TEXT,
      midia_nome TEXT,
      midia_tipo TEXT,
      status TEXT NOT NULL DEFAULT 'rascunho',
      ultimo_erro TEXT,
      criado_por UUID,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS circular_envios (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      circular_id UUID NOT NULL REFERENCES circulares(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
      empresa_nome TEXT,
      numero TEXT,
      status TEXT NOT NULL DEFAULT 'pendente',
      erro TEXT,
      enviado_em TIMESTAMPTZ,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(
    "CREATE INDEX IF NOT EXISTS idx_circular_envios_circular ON circular_envios (circular_id, status)"
  );
  console.log("[DB] circulares verificadas.");
}

module.exports = { ensureCircularSchema };
