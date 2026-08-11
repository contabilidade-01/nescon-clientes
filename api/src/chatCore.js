/**
 * Miolo do Atendimento: visibilidade, transições de estado e envio de mensagem.
 *
 * Tudo o que decide QUEM VÊ O QUÊ e QUEM PODE MUDAR O QUÊ mora aqui, e não nas rotas.
 * Duas razões:
 *
 *  - a mesma regra é usada pela listagem, pela abertura da conversa e pelo PATCH; escrita
 *    três vezes, ela diverge na terceira e vira brecha;
 *  - regra de visibilidade em SQL é testável e não depende de o front lembrar de filtrar.
 *
 * ## A regra que dá nome ao módulo
 *
 * Conversa **sem dono** é da casa: todo atendente vê, para ninguém ficar esperando.
 * Assim que alguém **assume**, ela sai da vista dos outros — dois atendentes respondendo
 * o mesmo cliente é pior do que demorar. O **dono do sistema** (`is_owner`) vê tudo,
 * sempre: é quem responde pelo atendimento como um todo.
 *
 * Fora do escopo devolvemos **404, nunca 403**: 403 confirma que aquele id existe e
 * entrega, de graça, o mapa das conversas alheias.
 */

const LIMITE_BODY = 4000;
const LIMITE_SUBJECT = 120;

/**
 * Fragmento SQL da visibilidade do admin. Recebe os índices dos parâmetros para poder
 * ser encaixado em consultas com número variável de filtros.
 *
 * `$owner IS TRUE OR assigned_to IS NULL OR assigned_to = $eu`
 */
function sqlVisibilidadeAdmin(idxAdminId, idxIsOwner, alias = "c") {
  return `($${idxIsOwner}::boolean IS TRUE
           OR ${alias}.assigned_to IS NULL
           OR ${alias}.assigned_to = $${idxAdminId}::uuid)`;
}

/** Texto da mensagem: sempre trim, nunca vazio, nunca gigante. */
function validarBody(raw) {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) return { erro: "Escreva uma mensagem." };
  if (body.length > LIMITE_BODY) {
    return { erro: `A mensagem passa de ${LIMITE_BODY} caracteres.` };
  }
  return { body };
}

function validarSubject(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  return s.slice(0, LIMITE_SUBJECT);
}

/**
 * Carrega a conversa aplicando o escopo de quem pede. Devolve null quando a conversa
 * não existe OU está fora do escopo — o chamador responde 404 nos dois casos, de
 * propósito (ver nota no topo).
 *
 * `ator`: { tipo: 'client'|'admin', companyId?, adminId?, isOwner? }
 */
async function carregarConversa(db, id, ator) {
  if (ator.tipo === "client") {
    const { rows } = await db.query(
      `SELECT * FROM conversations WHERE id = $1::uuid AND company_id = $2::uuid`,
      [id, ator.companyId]
    );
    return rows[0] || null;
  }
  const { rows } = await db.query(
    `SELECT c.* FROM conversations c
      WHERE c.id = $1::uuid AND ${sqlVisibilidadeAdmin(2, 3)}`,
    [id, ator.adminId, Boolean(ator.isOwner)]
  );
  return rows[0] || null;
}

/**
 * Grava uma mensagem e mantém a conversa coerente, numa transação só.
 *
 * O que anda junto e por isso não pode ficar solto:
 *  - a mensagem;
 *  - `last_message_at` (é por ele que a conversa sobe na lista — sem o UPDATE, a
 *    resposta existe mas a conversa parece parada e ninguém a vê);
 *  - a REABERTURA quando o cliente escreve numa conversa já resolvida. Sem isso a
 *    mensagem entra numa conversa fechada, não aparece na fila e o cliente fica sem
 *    resposta — o pior defeito possível num canal de atendimento. Ela volta para a fila
 *    SEM dono: quem atendeu da última vez pode estar de férias hoje;
 *  - a marca de leitura do outro lado, que precisa voltar a zero (chegou coisa nova).
 *
 * Idempotência: `clientMsgId` cai no índice único parcial. Duplo clique ou retry do
 * navegador devolvem a mensagem já gravada em vez de repetir o balão.
 */
async function inserirMensagem(db, {
  conversationId,
  senderType,
  senderId = null,
  senderName = null,
  body,
  clientMsgId = null,
}) {
  const cliente = await db.connect();
  try {
    await cliente.query("BEGIN");

    const ins = await cliente.query(
      `INSERT INTO chat_messages
         (conversation_id, sender_type, sender_id, sender_name, body, client_msg_id)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6)
       ON CONFLICT (conversation_id, client_msg_id)
         WHERE client_msg_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [conversationId, senderType, senderId, senderName, body, clientMsgId]
    );

    // Nada inserido = repetição já conhecida. Devolve a original e não mexe na conversa.
    if (!ins.rows.length) {
      const { rows } = await cliente.query(
        `SELECT * FROM chat_messages
          WHERE conversation_id = $1::uuid AND client_msg_id = $2`,
        [conversationId, clientMsgId]
      );
      await cliente.query("COMMIT");
      return { mensagem: rows[0] || null, duplicada: true, reaberta: false };
    }

    // Zera a leitura de quem VAI receber, não de quem escreveu.
    const zeraLeitura =
      senderType === "client" ? "read_by_admin_at = NULL" : "read_by_client_at = NULL";

    // Reabertura só quando é o cliente que volta a falar. Mensagem de sistema ou do
    // próprio admin numa conversa resolvida não deve ressuscitá-la.
    const reabre = senderType === "client";
    const upd = await cliente.query(
      `UPDATE conversations
          SET last_message_at = now(),
              ${zeraLeitura},
              status = CASE WHEN $2::boolean AND status = 'resolvido'
                            THEN 'aberto' ELSE status END,
              assigned_to = CASE WHEN $2::boolean AND status = 'resolvido'
                                 THEN NULL ELSE assigned_to END,
              resolved_at = CASE WHEN $2::boolean AND status = 'resolvido'
                                 THEN NULL ELSE resolved_at END,
              resolved_by = CASE WHEN $2::boolean AND status = 'resolvido'
                                 THEN NULL ELSE resolved_by END
        WHERE id = $1::uuid
        RETURNING status, (status = 'aberto') AS agora_aberta`,
      [conversationId, reabre]
    );

    await cliente.query("COMMIT");
    return {
      mensagem: ins.rows[0],
      duplicada: false,
      reaberta: reabre && upd.rows[0]?.agora_aberta === true,
    };
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

/**
 * Assumir a conversa — condicional, e é isso que evita o defeito mais provável do
 * módulo: dois atendentes clicando "Assumir" no mesmo segundo.
 *
 * Sem o `WHERE assigned_to IS NULL`, os dois UPDATEs passam, o segundo sobrescreve o
 * primeiro, e os dois acham que a conversa é sua — o cliente recebe duas respostas
 * diferentes. Com ele, o segundo volta `rowCount = 0` e a rota responde 409.
 */
async function assumir(db, conversationId, adminId) {
  const { rowCount } = await db.query(
    `UPDATE conversations
        SET assigned_to = $2::uuid, status = 'em_atendimento'
      WHERE id = $1::uuid AND assigned_to IS NULL`,
    [conversationId, adminId]
  );
  return rowCount === 1;
}

/**
 * Transferir para outro atendente. Só o dono atual (ou o dono do sistema) transfere —
 * senão qualquer um puxaria para si a conversa alheia, que é justamente o que a regra
 * de visibilidade existe para impedir.
 */
async function transferir(db, conversationId, { deAdminId, paraAdminId, isOwner }) {
  const { rowCount } = await db.query(
    `UPDATE conversations
        SET assigned_to = $3::uuid, status = 'em_atendimento'
      WHERE id = $1::uuid
        AND ($4::boolean IS TRUE OR assigned_to = $2::uuid)`,
    [conversationId, deAdminId, paraAdminId, Boolean(isOwner)]
  );
  return rowCount === 1;
}

/** Encerra a conversa. `por` = 'admin' | 'cliente'. */
async function resolver(db, conversationId, por) {
  const { rowCount } = await db.query(
    `UPDATE conversations
        SET status = 'resolvido', resolved_at = now(), resolved_by = $2
      WHERE id = $1::uuid AND status <> 'resolvido'`,
    [conversationId, por]
  );
  return rowCount === 1;
}

/** Reabre manualmente (admin). Volta para a fila, sem dono. */
async function reabrir(db, conversationId) {
  const { rowCount } = await db.query(
    `UPDATE conversations
        SET status = 'aberto', assigned_to = NULL,
            resolved_at = NULL, resolved_by = NULL, last_message_at = now()
      WHERE id = $1::uuid AND status = 'resolvido'`,
    [conversationId]
  );
  return rowCount === 1;
}

/** Registra o rastro das ações no próprio fio da conversa. */
async function mensagemDeSistema(db, conversationId, texto) {
  await db.query(
    `INSERT INTO chat_messages (conversation_id, sender_type, body)
     VALUES ($1::uuid, 'system', $2)`,
    [conversationId, texto.slice(0, LIMITE_BODY)]
  );
  await db.query(
    `UPDATE conversations SET last_message_at = now() WHERE id = $1::uuid`,
    [conversationId]
  );
}

module.exports = {
  LIMITE_BODY,
  LIMITE_SUBJECT,
  sqlVisibilidadeAdmin,
  validarBody,
  validarSubject,
  carregarConversa,
  inserirMensagem,
  assumir,
  transferir,
  resolver,
  reabrir,
  mensagemDeSistema,
};
