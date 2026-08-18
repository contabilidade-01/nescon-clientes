/**
 * Schema para MATRIZ + FILIAIS: vínculo de empresas do mesmo grupo.
 *
 * Antes: cada empresa era uma ilha isolada — 1 login = 1 empresa.
 * Agora: filiais podem apontar para uma matriz (`matriz_id`), e o login na matriz
 * dá acesso a TODAS as filiais via um seletor no header.
 *
 * Apenas 1 nível de hierarquia: filiais não podem ser matrizes de outras. Isso
 * evita cadeia confusa (Rosely → Filial → Subfilial) e mantém a regra simples:
 * cada empresa tem NO MÁXIMO uma matriz, e matrizes não têm matriz_id.
 */
async function ensureCompanyMatriz(db) {
  try {
    // Coluna matriz_id: se preenchida, esta empresa é FILIAL da matriz daquele id.
    // ON DELETE SET NULL: se a matriz for excluída, as filiais voltam a ser independentes.
    await db.query(`
      ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS matriz_id UUID REFERENCES companies(id) ON DELETE SET NULL
    `);

    // Índice para a busca por filiais de uma matriz. Parcial: só indexa quem TEM matriz.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_companies_matriz
        ON companies(matriz_id) WHERE matriz_id IS NOT NULL
    `);

    // Validação: matriz_id não pode apontar para si mesmo (empresa seria matriz de si mesma).
    // Isso fica no nível de rota (admin); em DB é mais barato confiar na aplicação.

    console.log("[DB] matriz_id: coluna verificada.");
  } catch (err) {
    console.error("[DB] ensureCompanyMatriz falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureCompanyMatriz };