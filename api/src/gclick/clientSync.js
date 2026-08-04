/**
 * Sincronização dos CLIENTES do G-Click (não dos documentos — isso é o sync.js).
 *
 * O que ela faz: atualiza o espelho (`gclick_clients`) e abre alertas na fila
 * (`gclick_pendencias`). O que ela NÃO faz: criar empresa, mexer em `companies` ou
 * tocar na coluna `decisao`. Decidir é do escritório.
 *
 * O espelho traz TODOS os clientes, inclusive os desativados — é a única forma de
 * perceber que alguém FOI desativado. A opção "só ativos" filtra quem vira alerta de
 * cadastro, não quem entra no espelho.
 */
const db = require("../db");
const client = require("./client");
const { getBoolSetting } = require("../appSettings");

const ATIVO = "ATIVO";

const CHAVE_SO_ATIVOS = "gclick_alerta_so_ativos";

/** Padrão vindo do ambiente: só cliente ativo no G-Click gera alerta de cadastro. */
function alertaSoAtivosPadrao() {
  return process.env.GCLICK_ALERTA_SO_ATIVOS !== "false";
}

/** A escolha feita na tela vence a variável de ambiente. */
async function alertaSoAtivosAtual() {
  return getBoolSetting(db, CHAVE_SO_ATIVOS, alertaSoAtivosPadrao());
}

/**
 * Regra de decisão — função PURA, sem banco. É aqui que mora o risco do módulo, e é
 * por isso que ela é testável sozinha (ver src/test/gclickClientSync.test.ts).
 *
 * @param espelho            Map cnpj → linha atual de gclick_clients
 * @param clientes           lista normalizada do G-Click ({cnpj, name, email, phone, status})
 * @param pendenciasAbertas  Set com "cnpj|tipo" das pendências ainda abertas
 * @param alertaSoAtivos     true = cliente desativado não vira alerta de cadastro
 */
function decidirEventos({ espelho, clientes, pendenciasAbertas = new Set(), alertaSoAtivos = true }) {
  const inserir = [];
  const atualizar = [];
  const pendencias = [];
  const statusAlterado = [];

  const jaVaiAbrir = new Set();
  const abrir = (cnpj, tipo, dados) => {
    const chave = `${cnpj}|${tipo}`;
    // Já existe alerta aberto (ou já enfileiramos agora): não duplica. O índice único
    // parcial no banco é a segunda linha de defesa.
    if (pendenciasAbertas.has(chave) || jaVaiAbrir.has(chave)) return;
    jaVaiAbrir.add(chave);
    pendencias.push({ cnpj, tipo, dados });
  };

  for (const c of clientes) {
    if (!c.cnpj) continue;
    const atual = espelho.get(c.cnpj);
    const ativo = c.status === ATIVO;

    if (!atual) {
      inserir.push(c);
      // Cliente que nasce já desativado não incomoda ninguém.
      if (ativo || !alertaSoAtivos) abrir(c.cnpj, "novo_cliente", dadosDe(c));
      continue;
    }

    if (mudou(atual, c)) atualizar.push(c);

    const mudouStatus = (atual.status_gclick || null) !== (c.status || null);

    if (mudouStatus && atual.decisao === "aceito") {
      abrir(c.cnpj, "status_alterado", {
        nome: c.name || atual.nome,
        de: atual.status_gclick || null,
        para: c.status || null,
      });
      statusAlterado.push({ cnpj: c.cnpj, companyId: atual.company_id, status: c.status || null });
    }

    // Rejeitado que volta a ficar ativo: vale reperguntar. Rejeitado que continua
    // igual não gera nada — é o efeito que o controle de rejeitados precisa ter.
    if (mudouStatus && atual.decisao === "rejeitado" && ativo) {
      abrir(c.cnpj, "novo_cliente", dadosDe(c));
    }

    // Herança do backfill: linhas que ficaram pendentes na primeira carga nunca
    // passariam pelo ramo "não existe no espelho" e ficariam invisíveis para sempre.
    // Alertar toda linha pendente sem alerta aberto também torna isto auto-corretivo.
    if (atual.decisao === "pendente" && (ativo || !alertaSoAtivos)) {
      abrir(c.cnpj, "novo_cliente", dadosDe(c));
    }
  }

  return { inserir, atualizar, pendencias, statusAlterado };
}

function dadosDe(c) {
  return { nome: c.name || null, email: c.email || null, phone: c.phone || null, status: c.status || null };
}

function mudou(atual, c) {
  return (
    (atual.nome || null) !== (c.name || null) ||
    (atual.email || null) !== (c.email || null) ||
    (atual.phone || null) !== (c.phone || null) ||
    (atual.status_gclick || null) !== (c.status || null)
  );
}

let emExecucao = false;
let ultimoResultado = null;

function estaRodando() {
  return emExecucao;
}
function ultimaExecucao() {
  return ultimoResultado;
}

/** Aplica o resultado da regra no banco. */
async function sincronizarClientes({ alertaSoAtivos = null } = {}) {
  if (!client.isConfigured()) {
    return { ok: false, erro: "G-Click não configurado (GCLICK_CLIENT_ID/SECRET)" };
  }
  if (emExecucao) return { ok: false, erro: "Já existe uma sincronização de clientes em andamento" };

  emExecucao = true;
  const inicio = Date.now();
  try {
    const soAtivos = alertaSoAtivos === null ? await alertaSoAtivosAtual() : alertaSoAtivos;
    const brutos = await client.listarClientes();
    const clientes = brutos.map((c) => client.extrairDadosCliente(c)).filter((c) => c.cnpj);
    if (!clientes.length) {
      return { ok: false, erro: "G-Click não devolveu clientes" };
    }

    const { rows: espelhoRows } = await db.query(
      "SELECT cnpj, nome, email, phone, status_gclick, decisao, company_id FROM gclick_clients"
    );
    const espelho = new Map(espelhoRows.map((r) => [r.cnpj, r]));

    const { rows: abertas } = await db.query(
      "SELECT cnpj, tipo FROM gclick_pendencias WHERE situacao = 'pendente'"
    );
    const pendenciasAbertas = new Set(abertas.map((p) => `${p.cnpj}|${p.tipo}`));

    const plano = decidirEventos({ espelho, clientes, pendenciasAbertas, alertaSoAtivos: soAtivos });

    for (const c of plano.inserir) {
      await db.query(
        `INSERT INTO gclick_clients (cnpj, nome, email, phone, status_gclick)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (cnpj) DO NOTHING`,
        [c.cnpj, c.name || null, c.email || null, c.phone || null, c.status || null]
      );
    }

    for (const c of plano.atualizar) {
      // Repare: `decisao` fica de fora de propósito — a sincronização não decide.
      await db.query(
        `UPDATE gclick_clients
            SET nome = $2, email = $3, phone = $4, status_gclick = $5, atualizado_em = now()
          WHERE cnpj = $1`,
        [c.cnpj, c.name || null, c.email || null, c.phone || null, c.status || null]
      );
    }

    let alertas = 0;
    for (const p of plano.pendencias) {
      // ON CONFLICT no índice parcial: se outra execução abriu o mesmo alerta no
      // meio do caminho, esta simplesmente não duplica.
      const r = await db.query(
        `INSERT INTO gclick_pendencias (cnpj, tipo, dados)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (cnpj, tipo) WHERE situacao = 'pendente' DO NOTHING`,
        [p.cnpj, p.tipo, JSON.stringify(p.dados || {})]
      );
      alertas += r.rowCount;
    }

    // Selo informativo na empresa já cadastrada.
    for (const s of plano.statusAlterado) {
      if (!s.companyId) continue;
      await db.query("UPDATE companies SET gclick_status = $1 WHERE id = $2", [s.status, s.companyId]);
    }

    ultimoResultado = {
      clientes: clientes.length,
      novos: plano.inserir.length,
      atualizados: plano.atualizar.length,
      alertas,
      segundos: Math.round((Date.now() - inicio) / 1000),
      em: new Date().toISOString(),
    };
    console.log("[sync clientes] concluído:", JSON.stringify(ultimoResultado));
    return { ok: true, ...ultimoResultado };
  } catch (err) {
    console.error("[sync clientes] falhou:", err.message);
    return { ok: false, erro: err.message };
  } finally {
    emExecucao = false;
  }
}

module.exports = {
  CHAVE_SO_ATIVOS,
  alertaSoAtivosAtual,
  decidirEventos,
  sincronizarClientes,
  estaRodando,
  ultimaExecucao,
  alertaSoAtivosPadrao,
};
