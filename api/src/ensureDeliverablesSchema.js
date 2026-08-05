/**
 * Entregas da contabilidade ao cliente (guias fiscais, folha de pagamento, documentos avulsos).
 * Alimenta o Portal do Cliente: listagens, calendário de vencimentos e próximos pagamentos.
 *
 * Origem 'gclick' = empurrado pelo sistema de envio de guias (idempotente por external_ref);
 * origem 'manual' = enviado pelo escritório no painel admin.
 */
async function ensureDeliverablesSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS deliverables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        doc_type TEXT,
        title TEXT NOT NULL,
        competencia TEXT,
        due_date DATE,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        paid_at TIMESTAMPTZ,
        source TEXT NOT NULL DEFAULT 'manual',
        external_ref TEXT,
        access_token TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    // Documento puxado do G-Click fica RETIDO até o escritório liberar: released_at
    // nulo = invisível para o cliente. Só a liberação (feita pelo sistema de guias,
    // no mesmo clique que dispara o aviso no WhatsApp) torna visível.
    await db.query(`
      ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
    `);
    // Versão da atividade no G-Click (respondidaEm): detecta retificação sem
    // rebaixar o PDF a cada sync.
    await db.query(`
      ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS gclick_versao_em TEXT;
    `);
    await db.query(`
      ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS gclick_atividade_id TEXT;
    `);
    await db.query(`
      ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS num_versoes INTEGER NOT NULL DEFAULT 1;
    `);
    /**
     * Documento de CARGA HISTÓRICA: entra para o cliente ter o arquivo, não para ser
     * cobrado.
     *
     * Sem esta marca, puxar de janeiro encheria "próximos pagamentos" com meses de
     * guias atrasadas — `/deliverables/upcoming` inclui vencidas de propósito, porque
     * "o que pagar a seguir" começa pelo que já passou. O cliente abriria o portal e
     * veria uma dívida que não existe.
     *
     * Marcar como `paid` seria mais fácil e seria mentira: afirmaria um pagamento que
     * ninguém conferiu. `historico` diz o que é de verdade — documento de arquivo.
     */
    await db.query(`
      ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS historico BOOLEAN NOT NULL DEFAULT false;
    `);
    // Entregas que já existiam antes da retenção continuam visíveis (não sumir do
    // cliente numa atualização). Só vale para linhas antigas: a coluna nasce nula.
    await db.query(`
      UPDATE deliverables SET released_at = created_at
      WHERE released_at IS NULL AND source <> 'gclick';
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_deliverables_company_due
        ON deliverables(company_id, due_date);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_deliverables_released
        ON deliverables(company_id, released_at);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_deliverables_token
        ON deliverables(access_token);
    `);
    // Idempotência do push do GCLICK: reenvio/retificação da mesma atividade atualiza a linha.
    // Índice parcial — várias linhas manuais (external_ref NULL) continuam permitidas.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_deliverables_company_external_ref
        ON deliverables(company_id, external_ref)
        WHERE external_ref IS NOT NULL;
    `);

    // Rastreio de abertura/download (append-only). O sistema de guias consulta estes
    // números para manter a tela de auditoria dele como painel único.
    await db.query(`
      CREATE TABLE IF NOT EXISTS deliverable_accesses (
        id BIGSERIAL PRIMARY KEY,
        deliverable_id UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
        evento TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        eh_bot BOOLEAN NOT NULL DEFAULT false,
        acessado_em TIMESTAMPTZ DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_deliverable_accesses_doc
        ON deliverable_accesses(deliverable_id, acessado_em);
    `);
    console.log("[DB] deliverables: tabela verificada/criada.");
  } catch (err) {
    console.error("[DB] ensureDeliverablesSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureDeliverablesSchema };
