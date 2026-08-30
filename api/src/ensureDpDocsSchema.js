/**
 * Arquivos dos termos de advertência/suspensão emitidos.
 *
 * Até aqui `issued_documents` guardava só os DADOS da emissão — o arquivo era gerado no
 * navegador e nunca chegava ao servidor. O fluxo do WhatsApp gera PDF+DOCX no servidor,
 * então precisamos de onde guardar o caminho e de um token opaco para o cliente baixar
 * pelo link da conversa (o WhatsApp precisa de uma URL pública para anexar o arquivo).
 *
 * Mesmo modelo de link já usado nas entregas (`deliverables.access_token`): id sequencial
 * nenhum, token aleatório e nada de sessão.
 */
async function ensureDpDocsSchema(db) {
  try {
    await db.query(`ALTER TABLE issued_documents ADD COLUMN IF NOT EXISTS file_pdf TEXT;`);
    await db.query(`ALTER TABLE issued_documents ADD COLUMN IF NOT EXISTS file_docx TEXT;`);
    await db.query(`ALTER TABLE issued_documents ADD COLUMN IF NOT EXISTS access_token TEXT;`);
    // 'portal' (emitido na tela) | 'whatsapp' (emitido pelo assistente). Serve para o
    // escritório saber a procedência sem adivinhar.
    await db.query(`ALTER TABLE issued_documents ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'portal';`);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_issued_documents_token
        ON issued_documents(access_token) WHERE access_token IS NOT NULL;
    `);
    console.log("[DB] documentos DP (arquivos/token): verificado.");
  } catch (err) {
    console.error("[DB] ensureDpDocsSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureDpDocsSchema };
