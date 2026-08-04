/**
 * Leitura automática do Extrato Mensal + aviso de saída da folha.
 *
 * O extrato já chega sozinho do G-Click; o que era manual era só a leitura. Agora ela
 * roda ao fim de cada sincronização — mas com uma separação deliberada:
 *
 *  - **cadastrar e atualizar** quem está no extrato é aditivo e roda sozinho;
 *  - **inativar quem sumiu** NÃO roda sozinho. Vira um aviso para alguém confirmar.
 *
 * O motivo é o modo de falha: um PDF lido pela metade traz 8 de 15 funcionários, e os
 * outros 7 seriam inativados em silêncio — sumiriam da tela do cliente e só apareceria
 * quando ele reclamasse. Cadastrar a mais é visível e reversível; inativar a menos, não.
 */
async function ensureExtratoAutoSchema(db) {
  try {
    // Marca do último extrato JÁ processado. Guardamos o id da entrega (não só a
    // competência) para que uma retificação do mesmo mês também seja reprocessada.
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS extrato_processado_id UUID;`);
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS extrato_processado_competencia TEXT;`);
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS extrato_processado_em TIMESTAMPTZ;`);

    await db.query(`
      CREATE TABLE IF NOT EXISTS employee_exit_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        nome TEXT NOT NULL,
        cpf TEXT NOT NULL,
        competencia TEXT,
        situacao TEXT NOT NULL DEFAULT 'pendente'
          CHECK (situacao IN ('pendente', 'resolvido')),
        resolucao TEXT CHECK (resolucao IN ('inativado', 'mantido')),
        resolvido_em TIMESTAMPTZ,
        resolvido_por UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Um aviso aberto por funcionário: reprocessar não empilha o mesmo alerta.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_exit_alerts_abertos
        ON employee_exit_alerts(employee_id) WHERE situacao = 'pendente';
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_exit_alerts_empresa
        ON employee_exit_alerts(company_id, situacao);
    `);

    console.log("[DB] extrato automático: colunas e avisos de saída verificados.");
  } catch (err) {
    console.error("[DB] ensureExtratoAutoSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureExtratoAutoSchema };
