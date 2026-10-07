/**
 * Contratos de prestação de serviços gerados no painel (modelo preenchido na tela).
 *
 * Uma linha por contrato: os dados do formulário ficam em `dados` (JSONB) para o
 * escritório reabrir e ajustar; o PDF gerado vai para o volume de uploads e é
 * espelhado em `deliverables` (categoria 'outro') para aparecer no portal do cliente.
 *
 * Assinatura eletrônica: integração com a ZapSign (API). `zapsign_token` identifica o
 * documento lá; o webhook `doc_signed` (ou o botão "Atualizar") baixa o arquivo
 * assinado, grava `signed_file_path` e cria a entrega "Contrato assinado".
 *
 * status: rascunho | salvo | enviado | assinado
 */
const fs = require("fs");
const path = require("path");

async function ensureContratosSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS contratos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
      titulo TEXT NOT NULL,
      dados JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'rascunho',
      file_path TEXT,
      file_name TEXT,
      signed_file_path TEXT,
      signed_file_name TEXT,
      deliverable_id UUID,
      signed_deliverable_id UUID,
      zapsign_token TEXT,
      zapsign_signers JSONB,
      zapsign_enviado_em TIMESTAMPTZ,
      assinado_em TIMESTAMPTZ,
      criado_por TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_contratos_company ON contratos(company_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_contratos_zapsign ON contratos(zapsign_token);`);
  // Cadastro prévio: uma ficha por empresa com os dados que entram no contrato.
  await db.query(`
    CREATE TABLE IF NOT EXISTS contrato_cadastros (
      company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      dados JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Aditivos: um aditivo é uma linha em `contratos` ligada ao contrato original assinado.
  await db.query(`ALTER TABLE contratos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'contrato'`);
  await db.query(`ALTER TABLE contratos ADD COLUMN IF NOT EXISTS contrato_pai_id UUID REFERENCES contratos(id) ON DELETE SET NULL`);
  await db.query(`ALTER TABLE contratos ADD COLUMN IF NOT EXISTS aditivo_numero INTEGER`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_contratos_pai ON contratos(contrato_pai_id)`);
  // Perfis de honorário: predefinições (valor, regras, prazos) aplicáveis por situação.
  await db.query(`
    CREATE TABLE IF NOT EXISTS contrato_presets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      criterios JSONB NOT NULL DEFAULT '{}'::jsonb,
      dados JSONB NOT NULL DEFAULT '{}'::jsonb,
      ordem INTEGER NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await semearPresets(db);
  await semearRascunhos(db);
}

/** Perfis iniciais (faixas do escritório). Só quando a tabela está vazia: excluir um não o recria. */
async function semearPresets(db) {
  try {
    const { rows } = await db.query(`SELECT 1 FROM contrato_presets LIMIT 1`);
    if (rows.length) return;
    const lista = JSON.parse(fs.readFileSync(path.join(__dirname, "seeds", "presets-honorarios.json"), "utf8"));
    for (const [i, p] of lista.entries()) {
      await db.query(
        `INSERT INTO contrato_presets (nome, descricao, criterios, dados, ordem) VALUES ($1, $2, $3, $4, $5)`,
        [p.nome, p.descricao || "", JSON.stringify(p.criterios || {}), JSON.stringify(p.dados || {}), i]
      );
    }
    console.log(`[contratos] ${lista.length} perfis de honorário iniciais criados`);
  } catch (err) {
    console.error("[contratos] seed de perfis falhou:", err.message);
  }
}

/**
 * Rascunhos iniciais (api/src/seeds/contrato-*.json): entram uma única vez, como
 * `rascunho`, sem PDF — o escritório abre na tela, completa o que falta e salva.
 * Idempotente pelo título: se já existe um contrato com o mesmo título, não repete.
 * Se houver empresa no portal cujo nome comece com `empresa_nome_prefixo`, já vincula.
 */
async function semearRascunhos(db) {
  const dir = path.join(__dirname, "seeds");
  let arquivos = [];
  try {
    arquivos = fs.readdirSync(dir).filter((f) => /^contrato-.*\.json$/i.test(f));
  } catch {
    return;
  }
  for (const nome of arquivos) {
    try {
      const seed = JSON.parse(fs.readFileSync(path.join(dir, nome), "utf8"));
      if (!seed?.titulo || !seed?.dados) continue;
      const { rows } = await db.query(`SELECT 1 FROM contratos WHERE titulo = $1 LIMIT 1`, [seed.titulo]);
      if (rows.length) continue;
      let companyId = null;
      if (seed.empresa_nome_prefixo) {
        const emp = await db.query(
          `SELECT id FROM companies WHERE name ILIKE $1 AND COALESCE(excluida, false) = false ORDER BY created_at LIMIT 1`,
          [`${seed.empresa_nome_prefixo}%`]
        );
        companyId = emp.rows[0]?.id || null;
      }
      await db.query(
        `INSERT INTO contratos (company_id, titulo, dados, status, criado_por) VALUES ($1, $2, $3, 'rascunho', 'seed')`,
        [companyId, seed.titulo, JSON.stringify(seed.dados)]
      );
      console.log(`[contratos] rascunho inicial criado: ${seed.titulo}`);
    } catch (err) {
      console.error(`[contratos] seed ${nome} falhou:`, err.message);
    }
  }
}

module.exports = { ensureContratosSchema };
