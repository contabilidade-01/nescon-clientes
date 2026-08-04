/**
 * Decisão do escritório sobre os clientes vindos do G-Click.
 *
 * IMPORTANTE — a criação automática de empresa continua LIGADA (a Fase 4 do plano
 * ficou fora de escopo). Consequências que estas rotas precisam respeitar:
 *
 *  - Ao aceitar, a empresa PODE JÁ EXISTIR (criada pela sincronização). Nesse caso
 *    apenas vinculamos: nada de duplicar CNPJ nem sobrescrever dados que já são nossos.
 *  - Ao rejeitar, a empresa criada automaticamente NÃO é apagada. Rejeitar significa
 *    "não quero este cliente na minha lista de novos", não "apague o cadastro". A
 *    resposta devolve `empresa_existente` para a tela poder dizer isso com todas as
 *    letras, em vez de dar a impressão falsa de que o acesso foi removido.
 *  - Decidir depois é normal: nada expira, nada bloqueia. O alerta espera.
 */
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireOwner } = require("../middleware/adminArea");
const { validateUUID, validateString } = require("../middleware/validate");
const { inscricaoValida, podeVirarEmpresa, tipoInscricao } = require("../gclick/inscricao");
const { PORTAL_ONLY_TOOL_ACCESS } = require("../companyTools");

function adminOnly(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: "Acesso restrito a administradores" });
  next();
}

router.use(authMiddleware);
router.use(adminOnly);
// Só o DONO. Decidir quem entra no portal é decisão de dono, não de operador —
// e é ele quem recebe o alerta de cliente novo.
router.use(requireOwner);

function limparCnpj(v) {
  return String(v || "").replace(/\D/g, "");
}

const ERRO_INSCRICAO = "Inscrição inválida (não é CPF nem CNPJ)";

/** Alertas abertos, separados por tipo — é o que o painel consulta ao abrir. */
router.get("/pendencias", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.id, p.cnpj, p.tipo, p.dados, p.criado_em,
              g.nome, g.status_gclick, g.decisao, g.company_id,
              c.id AS empresa_existente_id, c.name AS empresa_existente_nome
         FROM gclick_pendencias p
         LEFT JOIN gclick_clients g ON g.cnpj = p.cnpj
         LEFT JOIN companies c ON c.cnpj = p.cnpj
        WHERE p.situacao = 'pendente'
        ORDER BY p.tipo, p.criado_em`
    );
    const novos = rows.filter((r) => r.tipo === "novo_cliente");
    const mudancas = rows.filter((r) => r.tipo === "status_alterado");
    res.json({
      total: rows.length,
      novos_count: novos.length,
      mudancas_count: mudancas.length,
      novos,
      mudancas,
    });
  } catch (err) {
    console.error("[gclick pendencias]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Espelho completo — alimenta as abas, inclusive Rejeitados. */
router.get("/", async (req, res) => {
  try {
    const where = [];
    const vals = [];
    let i = 1;
    const { decisao, status, q } = req.query;

    if (decisao) {
      if (!["pendente", "aceito", "rejeitado"].includes(decisao)) {
        return res.status(400).json({ error: "decisao inválida" });
      }
      where.push(`g.decisao = $${i++}`);
      vals.push(decisao);
    }
    if (status) {
      where.push(`g.status_gclick = $${i++}`);
      vals.push(String(status));
    }
    if (q && String(q).trim()) {
      where.push(`(g.nome ILIKE $${i} OR g.cnpj ILIKE $${i})`);
      vals.push(`%${String(q).trim()}%`);
      i++;
    }

    const { rows } = await db.query(
      `SELECT g.*, c.id AS empresa_existente_id, c.name AS empresa_existente_nome
         FROM gclick_clients g
         LEFT JOIN companies c ON c.cnpj = g.cnpj
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY g.decisao, g.nome NULLS LAST, g.cnpj`,
      vals
    );
    res.json(rows);
  } catch (err) {
    console.error("[gclick clientes listar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Fecha o alerta aberto daquele CNPJ e tipo. Silencioso se não houver nenhum. */
async function resolverPendencia(client, cnpj, tipo, resolucao, adminId) {
  await client.query(
    `UPDATE gclick_pendencias
        SET situacao = 'resolvido', resolucao = $3, resolvido_em = now(), resolvido_por = $4
      WHERE cnpj = $1 AND tipo = $2 AND situacao = 'pendente'`,
    [cnpj, tipo, resolucao, adminId]
  );
}

/**
 * Aceita o cliente: garante a empresa no portal e marca a decisão.
 *
 * Tudo numa transação — se algo falhar no meio, não fica meia decisão gravada. E é
 * idempotente: aceitar duas vezes devolve a mesma empresa, sem criar outra.
 */
router.post("/:cnpj/aceitar", async (req, res) => {
  const cnpj = limparCnpj(req.params.cnpj);
  if (!inscricaoValida(cnpj)) return res.status(400).json({ error: ERRO_INSCRICAO });
  // Lixo do G-Click (ex.: inscrição "0") não pode virar cadastro — mas PODE ser
  // rejeitado, para sair da lista. A mensagem diz o caminho.
  if (!podeVirarEmpresa(cnpj)) {
    return res.status(400).json({
      error:
        "Este cliente não tem CPF nem CNPJ válido no G-Click, então não dá para criar o cadastro. " +
        'Use "Não cadastrar" para tirá-lo da lista, ou corrija a inscrição no G-Click.',
    });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE: duas abas do painel aceitando ao mesmo tempo não criam duas empresas.
    const { rows: espelho } = await client.query(
      "SELECT * FROM gclick_clients WHERE cnpj = $1 FOR UPDATE",
      [cnpj]
    );
    if (!espelho.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cliente não encontrado no espelho do G-Click" });
    }
    const g = espelho[0];

    const { rows: existentes } = await client.query(
      "SELECT id, name FROM companies WHERE cnpj = $1",
      [cnpj]
    );

    let companyId;
    let criada = false;
    if (existentes.length) {
      // Já existe (provavelmente criada pela sincronização): só vincula. NÃO mexemos
      // em nome, e-mail ou telefone — a partir do cadastro, o dado é nosso.
      companyId = existentes[0].id;
    } else {
      const nome = g.nome || `Empresa ${cnpj}`;
      const { rows: nova } = await client.query(
        `INSERT INTO companies
           (name, cnpj, password_hash, contact_email, phone, tool_access, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, true)
         RETURNING id`,
        [
          nome,
          cnpj,
          // Senha inicial = CNPJ, com troca obrigatória (o CNPJ é público).
          await bcrypt.hash(cnpj, 10),
          g.email || null,
          g.phone || null,
          JSON.stringify(PORTAL_ONLY_TOOL_ACCESS),
        ]
      );
      companyId = nova[0].id;
      criada = true;
    }

    await client.query(
      `UPDATE gclick_clients
          SET decisao = 'aceito', company_id = $2, decidido_em = now(),
              motivo_rejeicao = NULL, atualizado_em = now()
        WHERE cnpj = $1`,
      [cnpj, companyId]
    );
    if (g.status_gclick) {
      await client.query("UPDATE companies SET gclick_status = $1 WHERE id = $2", [
        g.status_gclick,
        companyId,
      ]);
    }
    await resolverPendencia(client, cnpj, "novo_cliente", "cadastrado", req.admin.id);

    await client.query("COMMIT");
    res.json({
      ok: true,
      company_id: companyId,
      criada,
      message: criada
        ? tipoInscricao(cnpj) === "cpf"
          ? "Cadastro criado (cliente pessoa física). Login: o CPF; senha inicial: os 11 dígitos do CPF."
          : "Empresa criada. Login: CNPJ; senha inicial: os 14 dígitos do CNPJ."
        : "Este cliente já tinha cadastro no portal — apenas vinculamos, sem alterar os dados.",
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") {
      return res.status(409).json({ error: "CNPJ já cadastrado por outro caminho. Recarregue a lista." });
    }
    console.error("[gclick aceitar]", err);
    res.status(500).json({ error: "Erro interno" });
  } finally {
    client.release();
  }
});

/**
 * Rejeita: sai da lista de novos e não volta a ser perguntado enquanto nada mudar.
 *
 * Não apaga empresa nenhuma. Se a sincronização já tinha criado o cadastro, ele
 * continua existindo — a resposta avisa, para a tela não mentir para o operador.
 */
router.post("/:cnpj/rejeitar", async (req, res) => {
  try {
    const cnpj = limparCnpj(req.params.cnpj);
    if (!inscricaoValida(cnpj)) return res.status(400).json({ error: ERRO_INSCRICAO });
    const motivo =
      req.body?.motivo === undefined || req.body?.motivo === null || req.body?.motivo === ""
        ? null
        : String(req.body.motivo).trim();
    if (motivo !== null && !validateString(motivo, 1, 300)) {
      return res.status(400).json({ error: "Motivo muito longo (máx. 300)" });
    }

    const { rowCount } = await db.query(
      `UPDATE gclick_clients
          SET decisao = 'rejeitado', motivo_rejeicao = $2, decidido_em = now(), atualizado_em = now()
        WHERE cnpj = $1`,
      [cnpj, motivo]
    );
    if (!rowCount) return res.status(404).json({ error: "Cliente não encontrado no espelho" });

    await resolverPendencia(db, cnpj, "novo_cliente", "rejeitado", req.admin.id);

    const { rows: empresa } = await db.query("SELECT id, name FROM companies WHERE cnpj = $1", [cnpj]);
    res.json({
      ok: true,
      empresa_existente: empresa.length > 0,
      message: empresa.length
        ? "Cliente marcado como rejeitado. Atenção: o cadastro no portal continua existindo (foi criado automaticamente ao chegar uma guia) — se quiser tirar o acesso, faça isso em Empresas."
        : "Cliente marcado como rejeitado. Ele fica em Rejeitados e pode ser cadastrado depois.",
    });
  } catch (err) {
    console.error("[gclick rejeitar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Rejeitado volta para a fila de decisão. */
router.post("/:cnpj/reconsiderar", async (req, res) => {
  try {
    const cnpj = limparCnpj(req.params.cnpj);
    if (!inscricaoValida(cnpj)) return res.status(400).json({ error: ERRO_INSCRICAO });
    const { rows, rowCount } = await db.query(
      `UPDATE gclick_clients
          SET decisao = 'pendente', motivo_rejeicao = NULL, decidido_em = NULL, atualizado_em = now()
        WHERE cnpj = $1
        RETURNING nome, email, phone, status_gclick`,
      [cnpj]
    );
    if (!rowCount) return res.status(404).json({ error: "Cliente não encontrado no espelho" });

    // Reabre o alerta na hora, em vez de esperar a próxima sincronização.
    const g = rows[0];
    await db.query(
      `INSERT INTO gclick_pendencias (cnpj, tipo, dados)
       VALUES ($1, 'novo_cliente', $2::jsonb)
       ON CONFLICT (cnpj, tipo) WHERE situacao = 'pendente' DO NOTHING`,
      [cnpj, JSON.stringify({ nome: g.nome, email: g.email, phone: g.phone, status: g.status_gclick })]
    );
    res.json({ ok: true, message: "Cliente voltou para a lista de novos." });
  } catch (err) {
    console.error("[gclick reconsiderar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** "OK, ciente" numa mudança de status. Só fecha o aviso — não muda nada no cadastro. */
router.post("/pendencias/:id/ciente", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const { rowCount } = await db.query(
      `UPDATE gclick_pendencias
          SET situacao = 'resolvido', resolucao = 'ciente', resolvido_em = now(), resolvido_por = $2
        WHERE id = $1 AND situacao = 'pendente'`,
      [id, req.admin.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Aviso não encontrado ou já resolvido" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[gclick ciente]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
