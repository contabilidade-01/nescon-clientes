/**
 * Propostas comerciais geradas no painel (assistente + formulário).
 *
 * Uma linha por proposta: os dados do formulário ficam em `dados` (JSONB) para reabrir e
 * ajustar; o PDF vai para o volume de uploads. Quando a proposta é de uma empresa já
 * cadastrada e o escritório marca "disponibilizar no portal", o PDF é espelhado em
 * `deliverables` (categoria 'outro', doc_type 'proposta').
 *
 * Os totais ficam em colunas só para a lista mostrar valor sem abrir cada proposta; quem
 * calcula é o navegador (src/lib/propostaModelo.ts).
 *
 * status: rascunho | salva | enviada | aceita | recusada
 */
async function ensurePropostasSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS propostas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
      titulo TEXT NOT NULL,
      cliente_nome TEXT NOT NULL DEFAULT '',
      dados JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'rascunho',
      total_unico NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_mensal NUMERIC(12,2) NOT NULL DEFAULT 0,
      validade_ate DATE,
      file_path TEXT,
      file_name TEXT,
      deliverable_id UUID,
      enviada_em TIMESTAMPTZ,
      decidida_em TIMESTAMPTZ,
      criado_por TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_propostas_company ON propostas(company_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_propostas_status ON propostas(status, updated_at DESC);`);
}

module.exports = { ensurePropostasSchema };
