/**
 * Pendências do e-CAC (vindas do central-ecac) e a cobrança amigável que sai daqui.
 *
 * Divisão de responsabilidades (revisão do plano de notificações, 29/09/2026):
 *
 *   central-ecac  → puxa a situação fiscal na Receita, emite guia, cobra o custo SERPRO.
 *   este portal   → dono do cliente: contato, canal, opt-out, janela de envio, histórico
 *                   e a MÁQUINA DE ESTADOS da cobrança (aviso → lembrete → recálculo →
 *                   regeração → cobrança → escalada).
 *
 * Por isso o contato NÃO é copiado para lá e o e-mail NÃO sai de lá.
 *
 * Tabelas:
 *   ecac_pendencias    espelho do último relatório de cada empresa (por relatorio_id)
 *   ecac_cobrancas     um ciclo de cobrança por empresa e mês (estado + próximos passos)
 *   ecac_notificacoes  cada mensagem que saiu (ou falhou), com rastreio de clique/abertura
 *   ecac_guias         guias que o cliente (ou o escritório) gerou pelo portal
 *   ecac_eventos       trilha: importação, clique, guia gerada, mudança de estado, erro
 *
 * Em `companies`: `ecac_cobranca_ativa` é a pausa POR EMPRESA (em negociação, parcelando,
 * cadastro errado). Abaixo de `alertas_ativos`, que continua sendo a chave geral.
 */
async function ensureEcacSchema(db) {
  try {
    await db.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS ecac_cobranca_ativa BOOLEAN NOT NULL DEFAULT true;`
    );
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS ecac_pausado_motivo TEXT;`);
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS ecac_pausado_em TIMESTAMPTZ;`);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ecac_pendencias (
        id BIGSERIAL PRIMARY KEY,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        cnpj TEXT NOT NULL,
        relatorio_id INTEGER NOT NULL,
        relatorio_data TIMESTAMPTZ,
        debitos JSONB NOT NULL DEFAULT '[]'::jsonb,
        omissoes JSONB NOT NULL DEFAULT '[]'::jsonb,
        parcelamento TEXT,
        pgfn TEXT,
        qtd_atraso INTEGER NOT NULL DEFAULT 0,
        total_atraso NUMERIC(15,2) NOT NULL DEFAULT 0,
        qtd_a_vencer INTEGER NOT NULL DEFAULT 0,
        qtd_invalidos INTEGER NOT NULL DEFAULT 0,
        importado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (company_id, relatorio_id)
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_ecac_pendencias_empresa
        ON ecac_pendencias(company_id, relatorio_id DESC);
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ecac_cobrancas (
        id BIGSERIAL PRIMARY KEY,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        pendencia_id BIGINT NOT NULL REFERENCES ecac_pendencias(id) ON DELETE CASCADE,
        relatorio_id INTEGER NOT NULL,
        ciclo TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'aberta',
        iniciado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        estado_desde DATE NOT NULL DEFAULT CURRENT_DATE,
        proxima_acao TEXT,
        proxima_acao_em DATE,
        regeracoes INTEGER NOT NULL DEFAULT 0,
        emails INTEGER NOT NULL DEFAULT 0,
        whatsapps INTEGER NOT NULL DEFAULT 0,
        ultimo_recalculo_em TIMESTAMPTZ,
        regeracao_pedida_em DATE,
        encerrado_em TIMESTAMPTZ,
        encerrado_motivo TEXT,
        UNIQUE (company_id, ciclo)
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_ecac_cobrancas_abertas
        ON ecac_cobrancas(estado, proxima_acao_em) WHERE encerrado_em IS NULL;
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ecac_notificacoes (
        id BIGSERIAL PRIMARY KEY,
        cobranca_id BIGINT NOT NULL REFERENCES ecac_cobrancas(id) ON DELETE CASCADE,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        etapa TEXT NOT NULL,
        canal TEXT NOT NULL,
        destino TEXT,
        token TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'pendente',
        erro TEXT,
        mensagem_id TEXT,
        status_entrega TEXT,
        status_entrega_em TIMESTAMPTZ,
        aberto_em TIMESTAMPTZ,
        clicado_em TIMESTAMPTZ,
        tentativas INTEGER NOT NULL DEFAULT 0,
        proxima_tentativa_em TIMESTAMPTZ,
        assunto TEXT,
        texto TEXT,
        modo_teste BOOLEAN NOT NULL DEFAULT false,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        enviado_em TIMESTAMPTZ,
        UNIQUE (cobranca_id, etapa, canal)
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_ecac_notificacoes_mensagem
        ON ecac_notificacoes(mensagem_id) WHERE mensagem_id IS NOT NULL;
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_ecac_notificacoes_pendentes
        ON ecac_notificacoes(status, proxima_tentativa_em) WHERE status = 'pendente';
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ecac_guias (
        id BIGSERIAL PRIMARY KEY,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        cobranca_id BIGINT REFERENCES ecac_cobrancas(id) ON DELETE SET NULL,
        emissao_id INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        periodo_apuracao TEXT NOT NULL,
        data_consolidacao TEXT,
        numero_documento TEXT,
        vencimento TEXT,
        valor_total NUMERIC(15,2),
        reuso BOOLEAN NOT NULL DEFAULT false,
        solicitado_por TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_ecac_guias_empresa ON ecac_guias(company_id, criado_em DESC);
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ecac_eventos (
        id BIGSERIAL PRIMARY KEY,
        company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
        cobranca_id BIGINT REFERENCES ecac_cobrancas(id) ON DELETE SET NULL,
        tipo TEXT NOT NULL,
        dados JSONB,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_ecac_eventos_empresa ON ecac_eventos(company_id, criado_em DESC);
    `);

    console.log("[DB] ecac_*: tabelas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureEcacSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureEcacSchema };
