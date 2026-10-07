const fs = require("fs");
const path = require("path");

/**
 * Onboarding de clientes novos: do contrato assinado ao primeiro mês rodando.
 *
 * - `onboarding_modelos`: o roteiro reutilizável (blocos em JSONB, na ordem). `regras` diz
 *   para qual contrato o modelo serve (áreas contratadas, enquadramento, tipo de empresa,
 *   se tem funcionários). Montado no painel por arrastar e soltar ou pelo agente de IA.
 * - `onboardings`: uma linha por contrato assinado (UNIQUE em contrato_id — o webhook do
 *   ZapSign pode chegar duas vezes). `itens` guarda os blocos já resolvidos com datas
 *   absolutas, para mudar o modelo depois não reescrever o que o cliente já viu.
 * - `onboarding_arquivos`: o que o cliente enviou, item a item.
 * - `onboarding_eventos`: trilha do que foi enviado/lembrado/aprovado.
 *
 * status do onboarding: aguardando | em_andamento | em_analise | concluido
 * status do arquivo:    enviado | aprovado | reprovado
 */
async function ensureOnboardingSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS onboarding_modelos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      regras JSONB NOT NULL DEFAULT '{}'::jsonb,
      blocos JSONB NOT NULL DEFAULT '[]'::jsonb,
      ordem INTEGER NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS onboardings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contrato_id UUID NOT NULL UNIQUE REFERENCES contratos(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
      modelo_id UUID REFERENCES onboarding_modelos(id) ON DELETE SET NULL,
      cliente_nome TEXT NOT NULL DEFAULT '',
      cliente_email TEXT NOT NULL DEFAULT '',
      dados_contrato JSONB NOT NULL DEFAULT '{}'::jsonb,
      itens JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'aguardando',
      token_publico TEXT NOT NULL UNIQUE,
      assinado_em DATE,
      inicio_em DATE,
      enviado_em TIMESTAMPTZ,
      concluido_em TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_onboardings_status ON onboardings(status, updated_at DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_onboardings_company ON onboardings(company_id);`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS onboarding_arquivos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      onboarding_id UUID NOT NULL REFERENCES onboardings(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'enviado',
      observacao TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_onboarding_arquivos_onb ON onboarding_arquivos(onboarding_id, item_id);`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS onboarding_eventos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      onboarding_id UUID NOT NULL REFERENCES onboardings(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      detalhe TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_onboarding_eventos_onb ON onboarding_eventos(onboarding_id, created_at DESC);`);

  await semearModelos(db);
}

/** Modelos iniciais (api/src/seeds/onboarding-modelos.json). Só com a tabela vazia: excluir um não o recria. */
async function semearModelos(db) {
  try {
    const { rows } = await db.query(`SELECT 1 FROM onboarding_modelos LIMIT 1`);
    if (rows.length) return;
    const lista = JSON.parse(fs.readFileSync(path.join(__dirname, "seeds", "onboarding-modelos.json"), "utf8"));
    for (const [i, m] of lista.entries()) {
      await db.query(
        `INSERT INTO onboarding_modelos (nome, descricao, regras, blocos, ordem) VALUES ($1, $2, $3, $4, $5)`,
        [m.nome, m.descricao || "", JSON.stringify(m.regras || {}), JSON.stringify(m.blocos || []), i]
      );
    }
    console.log(`[onboarding] ${lista.length} modelos iniciais criados`);
  } catch (err) {
    console.error("[onboarding] seed de modelos falhou:", err.message);
  }
}

module.exports = { ensureOnboardingSchema };
