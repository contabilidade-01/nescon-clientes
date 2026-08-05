/**
 * Mensagens de incentivo para quem nunca abriu o portal.
 *
 * O escritório já manda um WhatsApp por cliente sempre que libera as guias. A ideia é
 * pegar carona nesse envio: **a cada 3 avisos**, quem nunca entrou recebe junto uma frase
 * curta contando um benefício do portal. Nada de mensagem avulsa, nada de todo dia.
 *
 * Três travas contra encher o saco do cliente, todas obrigatórias:
 *  1. só recebe quem **nunca acessou** — quem já entrou uma vez sai da lista para sempre;
 *  2. só a cada N avisos (padrão 3);
 *  3. só se passaram M dias desde a última (padrão 7) — senão três guias na mesma semana
 *     virariam três mensagens.
 *
 * O texto NÃO é fixo no código: fica em `engagement_messages`, editável em
 * `/admin/mensagens`. A rotação usa o histórico em `engagement_sends`, então o cliente
 * nunca recebe a mesma frase duas vezes antes de esgotar o repositório.
 */

/** Sementes do repositório. Só entram se a tabela estiver vazia — nunca sobrescrevem. */
const MENSAGENS_INICIAIS = [
  {
    categoria: "acesso",
    titulo: "Primeiro acesso",
    texto:
      "Seu acesso ao portal já está liberado 🙂 Entre com o CNPJ da empresa — a primeira senha são os 14 dígitos. {portal}",
  },
  {
    categoria: "ferias",
    titulo: "Quem tem direito a férias",
    texto:
      "Sabia que dá para ver quando cada funcionário completa o período de férias, sem precisar pedir? Está tudo no portal. {portal}",
  },
  {
    categoria: "ferias",
    titulo: "Quanto vão custar as férias",
    texto:
      "No portal você já vê quanto vão custar as férias de cada funcionário, com o terço e o FGTS somados. Ajuda a se programar. {portal}",
  },
  {
    categoria: "ferias",
    titulo: "Faltas reduzem as férias",
    texto:
      "Faltas demais tiram dias de férias do funcionário. O portal avisa antes que isso aconteça. {portal}",
  },
  {
    categoria: "documentos",
    titulo: "Nada se perde",
    texto:
      "Toda guia e folha que enviamos fica guardada no portal, organizada por mês. Nada se perde no WhatsApp. {portal}",
  },
  {
    categoria: "documentos",
    titulo: "Calendário de vencimentos",
    texto:
      "O portal mostra num calendário tudo o que vence no mês — guias, boletos e prazos. {portal}",
  },
  {
    categoria: "dp",
    titulo: "Advertência e suspensão",
    texto:
      "Precisa aplicar advertência ou suspensão? O portal gera o documento pronto para assinar, em um minuto. {portal}",
  },
  {
    categoria: "dp",
    titulo: "Quadro de funcionários",
    texto:
      "Seu quadro de funcionários fica atualizado no portal a cada folha, sem você precisar mandar nada. {portal}",
  },
];

async function ensureEngagementSchema(db) {
  try {
    // Sem isto não dá para saber quem nunca entrou. Preenchido no login (routes/auth.js).
    await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS ultimo_login_em TIMESTAMPTZ;`);
    // Contador de avisos desde a última mensagem de incentivo.
    await db.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS envios_desde_incentivo INTEGER NOT NULL DEFAULT 0;`
    );

    await db.query(`
      CREATE TABLE IF NOT EXISTS engagement_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        titulo TEXT NOT NULL,
        texto TEXT NOT NULL,
        categoria TEXT NOT NULL DEFAULT 'geral',
        ativa BOOLEAN NOT NULL DEFAULT true,
        ordem INTEGER NOT NULL DEFAULT 0,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Histórico: é o que permite rodar as mensagens sem repetir e mostrar ao escritório
    // o que cada cliente já recebeu.
    await db.query(`
      CREATE TABLE IF NOT EXISTS engagement_sends (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        message_id UUID REFERENCES engagement_messages(id) ON DELETE SET NULL,
        texto TEXT NOT NULL,
        enviado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_engagement_sends_empresa
        ON engagement_sends(company_id, enviado_em DESC);
    `);

    const { rows } = await db.query("SELECT 1 FROM engagement_messages LIMIT 1");
    if (!rows.length) {
      let ordem = 0;
      for (const m of MENSAGENS_INICIAIS) {
        ordem += 1;
        await db.query(
          `INSERT INTO engagement_messages (titulo, texto, categoria, ordem)
           VALUES ($1, $2, $3, $4)`,
          [m.titulo, m.texto, m.categoria, ordem]
        );
      }
      console.log(`[DB] engagement: ${MENSAGENS_INICIAIS.length} mensagens iniciais criadas.`);
    }

    console.log("[DB] engagement: tabelas verificadas/criadas.");
  } catch (err) {
    console.error("[DB] ensureEngagementSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureEngagementSchema, MENSAGENS_INICIAIS };
