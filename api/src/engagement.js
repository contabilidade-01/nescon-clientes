/**
 * Mensagem de incentivo que pega carona no ALERTA DE VENCIMENTO.
 *
 * O portal avisa o cliente na véspera do vencimento (ver alertas.js). Este módulo
 * responde, naquele instante: "vai uma frase junto? qual?". A frase entra sorrateira,
 * no fim da mensagem — o cliente abriu um aviso que ele quis receber e encontra uma
 * linha a mais, não um anúncio.
 *
 * O gatilho mudou: antes era a liberação de guias (`/api/fiscal/release`), o que
 * amarrava o incentivo ao sistema de guias. Amarrado ao alerta, ele passa a sair do
 * portal, que é para onde o canal está indo.
 *
 * As travas estão em `engagementRules.js` — aqui é só o banco.
 */
const { getSetting, setSetting } = require("./appSettings");
const {
  A_CADA_ENVIOS,
  INTERVALO_MINIMO_DIAS,
  nuncaAcessou,
  deveEnviar,
  escolherMensagem,
  montarTexto,
} = require("./engagementRules");

const CHAVE_A_CADA = "engajamento_a_cada_envios";
const CHAVE_INTERVALO = "engajamento_intervalo_dias";

function inteiro(valor, padrao, min, max) {
  const n = parseInt(valor, 10);
  if (!Number.isInteger(n) || n < min || n > max) return padrao;
  return n;
}

/** Ajustes do escritório (tela de mensagens), com o padrão do código como piso. */
async function configuracao(db) {
  const [a, i] = await Promise.all([getSetting(db, CHAVE_A_CADA), getSetting(db, CHAVE_INTERVALO)]);
  return {
    aCadaEnvios: inteiro(a, A_CADA_ENVIOS, 1, 20),
    intervaloMinimoDias: inteiro(i, INTERVALO_MINIMO_DIAS, 0, 90),
  };
}

async function salvarConfiguracao(db, { aCadaEnvios, intervaloMinimoDias }) {
  if (aCadaEnvios !== undefined) {
    await setSetting(db, CHAVE_A_CADA, inteiro(aCadaEnvios, A_CADA_ENVIOS, 1, 20));
  }
  if (intervaloMinimoDias !== undefined) {
    await setSetting(db, CHAVE_INTERVALO, inteiro(intervaloMinimoDias, INTERVALO_MINIMO_DIAS, 0, 90));
  }
  return configuracao(db);
}

/**
 * Chamado a cada alerta de vencimento. Incrementa o contador da empresa e devolve o
 * texto quando for a vez — ou `null`, que é o caso comum.
 *
 * `simular = true` responde a mesma coisa sem gravar nada: é o modo da tela de
 * pré-visualização, que precisa mostrar a mensagem exata sem queimar o rodízio nem
 * marcar como enviada uma frase que ninguém recebeu.
 *
 * Nunca lança: se algo aqui falhar, o alerta de vencimento tem de sair do mesmo jeito.
 * Uma frase de marketing não pode segurar o aviso de que a guia vence amanhã.
 */
async function trechoDeIncentivo(db, { companyId, portalUrl, simular = false }) {
  try {
    const consulta = simular
      ? `SELECT name, ultimo_login_em, must_change_password,
                envios_desde_incentivo + 1 AS envios_desde_incentivo
           FROM companies WHERE id = $1`
      : `UPDATE companies
            SET envios_desde_incentivo = envios_desde_incentivo + 1
          WHERE id = $1
          RETURNING name, ultimo_login_em, must_change_password, envios_desde_incentivo`;
    const { rows } = await db.query(consulta, [companyId]);
    if (!rows.length) return null;
    const empresa = rows[0];

    const { rows: aberturas } = await db.query(
      `SELECT 1 FROM deliverable_accesses a
         JOIN deliverables d ON d.id = a.deliverable_id
        WHERE d.company_id = $1 AND a.eh_bot IS NOT TRUE
        LIMIT 1`,
      [companyId]
    );

    const nunca = nuncaAcessou({
      ultimoLoginEm: empresa.ultimo_login_em,
      mustChangePassword: empresa.must_change_password,
      aberturas: aberturas.length,
    });

    const { rows: ultimo } = await db.query(
      `SELECT enviado_em FROM engagement_sends
        WHERE company_id = $1 ORDER BY enviado_em DESC LIMIT 1`,
      [companyId]
    );

    const cfg = await configuracao(db);
    const decisao = deveEnviar({
      nuncaAcessou: nunca,
      enviosDesde: empresa.envios_desde_incentivo,
      ultimoIncentivoEm: ultimo[0]?.enviado_em ?? null,
      ...cfg,
    });
    if (!decisao.enviar) return null;

    const { rows: ativas } = await db.query(
      "SELECT id, titulo, texto, categoria, ordem FROM engagement_messages WHERE ativa IS TRUE"
    );
    const { rows: jaEnviadas } = await db.query(
      "SELECT message_id, enviado_em FROM engagement_sends WHERE company_id = $1",
      [companyId]
    );

    const escolhida = escolherMensagem(ativas, jaEnviadas);
    if (!escolhida) return null;

    const texto = montarTexto(escolhida.texto, { portal: portalUrl, empresa: empresa.name });
    if (simular) return { id: escolhida.id, titulo: escolhida.titulo, texto, simulado: true };

    // Zera o contador só quando a mensagem realmente sai — se não saiu, ela continua
    // "devendo" e vai no próximo alerta que passar nas travas.
    await db.query(
      `UPDATE companies SET envios_desde_incentivo = 0 WHERE id = $1`,
      [companyId]
    );
    await db.query(
      `INSERT INTO engagement_sends (company_id, message_id, texto) VALUES ($1, $2, $3)`,
      [companyId, escolhida.id, texto]
    );

    return { id: escolhida.id, titulo: escolhida.titulo, texto };
  } catch (err) {
    console.error("[engajamento] falhou (alerta segue sem mensagem):", err.message);
    return null;
  }
}

/** Painel: quem nunca entrou, quantas mensagens recebeu e qual foi a última. */
async function panoramaEngajamento(db) {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.cnpj, c.ultimo_login_em, c.must_change_password,
            c.envios_desde_incentivo,
            (SELECT count(*)::int FROM engagement_sends s WHERE s.company_id = c.id) AS mensagens,
            (SELECT max(s.enviado_em) FROM engagement_sends s WHERE s.company_id = c.id) AS ultima_em,
            EXISTS (SELECT 1 FROM deliverable_accesses a
                      JOIN deliverables d ON d.id = a.deliverable_id
                     WHERE d.company_id = c.id AND a.eh_bot IS NOT TRUE) AS abriu_documento
       FROM companies c
      ORDER BY c.name`
  );

  const empresas = rows.map((r) => ({
    ...r,
    nunca_acessou: nuncaAcessou({
      ultimoLoginEm: r.ultimo_login_em,
      mustChangePassword: r.must_change_password,
      aberturas: r.abriu_documento ? 1 : 0,
    }),
  }));

  return {
    total: empresas.length,
    nunca_acessaram: empresas.filter((e) => e.nunca_acessou).length,
    empresas,
  };
}

module.exports = { trechoDeIncentivo, panoramaEngajamento, configuracao, salvarConfiguracao };
