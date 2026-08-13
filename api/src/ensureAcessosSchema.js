/**
 * Eventos de uso do portal pelo cliente — alimenta a tela admin "Controle de acessos".
 *
 * Uma tabela só, com `tipo` discriminando:
 *   - 'login' → cada entrada do cliente no portal (para "últimos 5 acessos" e "ativos").
 *   - 'uso'   → abertura de uma ferramenta/seção (para o ranking de mais usadas).
 *
 * Visualização/download de DOCUMENTOS não entra aqui: já é registrado em
 * `deliverable_accesses` (ver deliverableAccess.js). A tela admin junta as duas fontes.
 *
 * Append-only e best-effort: registrar um evento nunca pode quebrar o login nem a
 * navegação do cliente. Retenção não é tratada aqui — o volume é baixo (um punhado de
 * eventos por cliente por dia) e o histórico é o próprio valor da tela.
 */
async function ensureAcessosSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS portal_eventos (
        id BIGSERIAL PRIMARY KEY,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (tipo IN ('login', 'uso')),
        ferramenta TEXT,
        ip TEXT,
        user_agent TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Consulta principal: eventos de uma empresa, do mais recente ao mais antigo.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_portal_eventos_empresa
        ON portal_eventos(company_id, criado_em DESC);
    `);
    // Ranking de ferramentas: filtra por tipo e agrupa por ferramenta.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_portal_eventos_uso
        ON portal_eventos(tipo, ferramenta) WHERE tipo = 'uso';
    `);
    console.log("[DB] portal_eventos: tabela verificada/criada.");
  } catch (err) {
    console.error("[DB] ensureAcessosSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureAcessosSchema };
