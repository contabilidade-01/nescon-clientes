/**
 * Arquivamento de empresa: tirar um cliente do ar sem apagar o histórico dele.
 *
 * O escritório perde cliente — e até aqui não havia o que fazer com ele. A empresa
 * continuava nas listas, entrava na contagem dos painéis, recebia alerta de vencimento
 * e podia entrar no portal. Apagar também não servia: some a auditoria de tudo o que já
 * foi entregue, que é justamente o que se precisa guardar depois que o contrato acaba.
 *
 * Por isso ARQUIVA, não deleta:
 *
 *  - some das telas do escritório e da contagem dos cartões;
 *  - para de receber qualquer coisa (alerta, cobrança, aviso de documento, e-mail);
 *  - perde o acesso ao portal;
 *  - documentos, boletos e conversas continuam no banco, intactos.
 *
 * As colunas de auditoria (`por` e `em`) não são enfeite: seis meses depois, "por que
 * esta empresa sumiu?" é uma pergunta que alguém vai fazer, e sem o registro a resposta
 * dependeria de memória.
 *
 * Quem arquiva é qualquer administrador com a área `empresas`; quem REATIVA é só o dono
 * do sistema. A assimetria é proposital e foi pedida assim: tirar do ar é operação do
 * dia a dia, devolver ao ar é decisão de quem responde pelo escritório.
 */

async function ensureArquivamentoSchema(db) {
  try {
    await db.query(`
      ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS arquivada BOOLEAN NOT NULL DEFAULT false
    `);
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS arquivada_em TIMESTAMPTZ`);
    await db.query(`
      ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS arquivada_por UUID REFERENCES platform_admins(id) ON DELETE SET NULL
    `);
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS arquivada_motivo TEXT`);

    // Toda listagem do painel filtra por isto; índice parcial porque o normal é a
    // empresa NÃO estar arquivada — só as poucas arquivadas precisam ser encontradas.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_companies_arquivada
        ON companies(arquivada) WHERE arquivada IS TRUE
    `);

    // Exclusão (soft-delete): mesma lógica do arquivamento, mas irreversível para o
    // operador comum — só o dono pode reverter.
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS excluida BOOLEAN NOT NULL DEFAULT false`);
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS excluida_em TIMESTAMPTZ`);
    await db.query(`
      ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS excluida_por UUID REFERENCES platform_admins(id) ON DELETE SET NULL
    `);
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS excluida_motivo TEXT`);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_companies_excluida
        ON companies(excluida) WHERE excluida IS TRUE
    `);

    console.log("[DB] arquivamento/exclusão de empresas: colunas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureArquivamentoSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureArquivamentoSchema };
