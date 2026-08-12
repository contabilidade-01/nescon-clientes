/**
 * Fila de revisão de vencimentos sugeridos (reconhecimento em lote, determinístico ou
 * por IA). Nunca grava due_date em `deliverables` direto — o admin decide, mesmo
 * princípio já usado no reconhecimento de CNPJ (sugestão != fato).
 *
 * Documento processado sem nenhuma data encontrada não vira linha aqui — "sem
 * vencimento identificável" é um resultado tranquilo (holerite, contrato sem prazo),
 * não um erro para revisar.
 */
async function ensureDueDateSugestoesSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS due_date_sugestoes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        deliverable_id UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
        data_sugerida DATE NOT NULL,
        origem TEXT NOT NULL CHECK (origem IN ('deterministico', 'ia')),
        confianca INTEGER,
        provider_ia TEXT,
        motivo TEXT,
        status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'rejeitada')),
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        decidido_em TIMESTAMPTZ,
        decidido_por UUID REFERENCES platform_admins(id) ON DELETE SET NULL
      );
    `);

    // Uma sugestão em aberto por documento — reprocessar não duplica a fila.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_due_date_sugestoes_pendente
        ON due_date_sugestoes(deliverable_id) WHERE status = 'pendente';
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_due_date_sugestoes_status
        ON due_date_sugestoes(status, criado_em);
    `);

    console.log("[DB] due_date_sugestoes: tabela verificada/criada.");
  } catch (err) {
    console.error("[DB] ensureDueDateSugestoesSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureDueDateSugestoesSchema };
