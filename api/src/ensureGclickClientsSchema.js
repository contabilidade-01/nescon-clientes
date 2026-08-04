/**
 * Espelho dos clientes do G-Click + fila de alertas para o escritório.
 *
 * Três camadas que hoje estavam misturadas numa só (ver docs/PLANO-CLIENTES-GCLICK.md):
 *
 *  - `gclick_clients` ESPELHO: cópia crua do que existe no G-Click, reescrita a cada
 *    sincronização. Nunca é mostrada ao cliente final.
 *  - `gclick_clients.decisao` DECISÃO do escritório (pendente/aceito/rejeitado). A
 *    sincronização NUNCA altera esta coluna.
 *  - `companies` CADASTRO, que é nosso. O espelho não escreve nele.
 *
 * `gclick_pendencias` é a caixa de entrada: cliente novo (decisão) e mudança de status
 * (ciência). O índice único parcial garante que sincronizar dez vezes não empilha dez
 * alertas iguais.
 */
const gclickClient = require("./gclick/client");

async function ensureGclickClientsSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS gclick_clients (
        cnpj TEXT PRIMARY KEY,
        nome TEXT,
        email TEXT,
        phone TEXT,
        status_gclick TEXT,
        decisao TEXT NOT NULL DEFAULT 'pendente'
          CHECK (decisao IN ('pendente', 'aceito', 'rejeitado')),
        company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
        decidido_em TIMESTAMPTZ,
        motivo_rejeicao TEXT,
        primeiro_visto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_gclick_clients_decisao
        ON gclick_clients(decisao, status_gclick);
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS gclick_pendencias (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cnpj TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('novo_cliente', 'status_alterado')),
        dados JSONB NOT NULL DEFAULT '{}',
        situacao TEXT NOT NULL DEFAULT 'pendente'
          CHECK (situacao IN ('pendente', 'resolvido')),
        resolucao TEXT CHECK (resolucao IN ('cadastrado', 'rejeitado', 'ciente')),
        resolvido_em TIMESTAMPTZ,
        resolvido_por UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Uma pendência ABERTA por CNPJ e tipo. É isto que torna a sincronização
    // idempotente — rodar de novo não duplica alerta.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gclick_pendencias_abertas
        ON gclick_pendencias(cnpj, tipo) WHERE situacao = 'pendente';
    `);

    // Informativo: selo "inativo no G-Click" no cadastro. NÃO bloqueia o login do
    // cliente nem mexe em permissões — inativação é notícia, não ação.
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS gclick_status TEXT;`);

    console.log("[DB] gclick_clients/pendencias: tabelas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureGclickClientsSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

/**
 * Primeira carga do espelho.
 *
 * Sem ela, todo cliente já existente pareceria "novo" e o escritório abriria o painel
 * com dezenas de alertas falsos. Quem já tem empresa no portal entra como **aceito**;
 * os demais ficam **pendentes**. Nenhuma pendência é criada aqui — a fila de alertas
 * é responsabilidade da sincronização de clientes (fase seguinte).
 *
 * Roda uma única vez: "espelho vazio" é o sinal de primeira execução.
 * Nunca derruba o arranque — se o G-Click estiver fora, tenta no próximo boot.
 */
async function backfillGclickClients(db) {
  try {
    const { rows: jaTem } = await db.query("SELECT 1 FROM gclick_clients LIMIT 1");
    if (jaTem.length) return { pulado: "espelho já populado" };
    if (!gclickClient.isConfigured()) return { pulado: "G-Click não configurado" };

    const clientes = await gclickClient.listarClientes();
    const dados = clientes
      .map((c) => gclickClient.extrairDadosCliente(c))
      .filter((c) => c.cnpj);
    if (!dados.length) return { pulado: "G-Click não devolveu clientes" };

    const { rows: empresas } = await db.query("SELECT id, cnpj FROM companies");
    const porCnpj = new Map(empresas.map((e) => [String(e.cnpj).replace(/\D/g, ""), e.id]));

    let aceitos = 0;
    let pendentes = 0;
    for (const c of dados) {
      const companyId = porCnpj.get(c.cnpj) || null;
      const decisao = companyId ? "aceito" : "pendente";
      try {
        await db.query(
          `INSERT INTO gclick_clients
             (cnpj, nome, email, phone, status_gclick, decisao, company_id, decidido_em)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 = 'aceito' THEN now() ELSE NULL END)
           ON CONFLICT (cnpj) DO NOTHING`,
          [c.cnpj, c.name || null, c.email || null, c.phone || null, c.status || null, decisao, companyId]
        );
        if (companyId) aceitos++;
        else pendentes++;
      } catch (err) {
        console.error("[backfill gclick]", c.cnpj, err.message);
      }
    }

    // Selo informativo nas empresas que já existem.
    await db.query(`
      UPDATE companies c SET gclick_status = g.status_gclick
        FROM gclick_clients g
       WHERE g.company_id = c.id AND g.status_gclick IS NOT NULL;
    `);

    console.log(
      `[backfill gclick] espelho criado: ${dados.length} cliente(s) — ` +
        `${aceitos} já cadastrado(s), ${pendentes} sem cadastro no portal. Nenhum alerta gerado.`
    );
    return { total: dados.length, aceitos, pendentes };
  } catch (err) {
    // Boot não pode cair por causa do G-Click: tenta de novo no próximo arranque.
    console.error("[backfill gclick] falhou (será tentado no próximo arranque):", err.message);
    return { erro: err.message };
  }
}

module.exports = { ensureGclickClientsSchema, backfillGclickClients };
