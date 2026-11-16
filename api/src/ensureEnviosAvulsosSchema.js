/**
 * Documentos que o cliente manda pela página pública /enviar (ver routes/envioAvulso.js).
 * Um envio = empresa + tipo + 1..10 arquivos. O arquivo fica em disco numa pasta própria,
 * fora do que /api/uploads serve (ver ARQUIVOS_DIR em routes/envioAvulso.js).
 */
async function ensureEnviosAvulsosSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS envios_avulsos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      protocolo TEXT UNIQUE NOT NULL,
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      observacao TEXT,
      remetente TEXT,
      ip TEXT,
      status TEXT NOT NULL DEFAULT 'novo',
      tratado_por TEXT,
      tratado_em TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS envios_avulsos_company_idx ON envios_avulsos (company_id, created_at DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS envios_avulsos_status_idx ON envios_avulsos (status, created_at DESC);`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS envios_avulsos_arquivos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      envio_id UUID NOT NULL REFERENCES envios_avulsos(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      tamanho INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS envios_avulsos_arquivos_envio_idx ON envios_avulsos_arquivos (envio_id);`);
}

module.exports = { ensureEnviosAvulsosSchema };
