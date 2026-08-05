/**
 * Quem recebe alerta de vencimento, e o registro do que já foi mandado.
 *
 * Duas tabelas só, porque quase tudo aqui é **calculado**: a data de vencimento sai do
 * catálogo (obrigacoes.js) e a sugestão de qual obrigação a empresa tem sai das guias
 * que já estão no portal. O banco guarda apenas o que não dá para deduzir — a decisão
 * do escritório e o histórico de envio.
 *
 * `company_obligations` guarda **decisão, não estado**: uma linha com `ativo = false`
 * é o admin dizendo "não, esta empresa não recolhe isso". Sem essa linha negativa a
 * sugestão voltaria a aparecer toda vez que o cliente recebesse mais uma guia daquele
 * tipo, e o escritório passaria a vida dispensando a mesma sugestão.
 *
 * `alert_sends` existe para o envio ser idempotente: o índice único
 * (empresa, obrigação, vencimento) faz a rotina diária poder rodar duas vezes — por
 * redeploy, por retentativa — sem mandar dois WhatsApps para o mesmo cliente.
 */
async function ensureAlertasSchema(db) {
  try {
    // Cliente que não gosta de mensagem: uma chave só desliga tudo, sem ter de
    // desmarcar obrigação por obrigação (e sem perder a marcação quando religar).
    await db.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS alertas_ativos BOOLEAN NOT NULL DEFAULT true;`
    );
    // Desliga só a carona da mensagem de incentivo, mantendo o alerta de vencimento.
    await db.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS incentivo_ativo BOOLEAN NOT NULL DEFAULT true;`
    );
    // Para onde vai o alerta. Fora do G-Click de propósito: o objetivo é o portal
    // deixar de depender dele para avisar o cliente.
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp TEXT;`);

    await db.query(`
      CREATE TABLE IF NOT EXISTS company_obligations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        obrigacao TEXT NOT NULL,
        ativo BOOLEAN NOT NULL DEFAULT true,
        -- 'auto'   = marcada pela regra (tem funcionário, tem DAS no portal...)
        -- 'manual' = o admin marcou ou desmarcou. NUNCA é sobrescrita pela regra.
        origem TEXT NOT NULL DEFAULT 'manual',
        observacao TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_company_obligations_unica
        ON company_obligations(company_id, obrigacao);
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS alert_sends (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        -- Várias obrigações que vencem no mesmo dia viram UMA mensagem; esta coluna
        -- guarda os códigos separados por vírgula, na ordem em que saíram no texto.
        obrigacoes TEXT NOT NULL,
        -- O DIA EM QUE O AVISO SAIU, não o vencimento. São coisas diferentes: uma
        -- mensagem pode carregar o salário que vence hoje e a guia que vence amanhã.
        -- A regra que queremos garantir é "uma mensagem por cliente por dia", e é o
        -- dia do aviso que expressa isso.
        dia_alerta DATE NOT NULL,
        texto TEXT NOT NULL,
        incentivo_message_id UUID,
        enviado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // A trava contra mandar duas vezes o mesmo aviso.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_sends_unico
        ON alert_sends(company_id, dia_alerta, obrigacoes);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_sends_empresa
        ON alert_sends(company_id, enviado_em DESC);
    `);

    console.log("[DB] alertas: tabelas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureAlertasSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureAlertasSchema };
