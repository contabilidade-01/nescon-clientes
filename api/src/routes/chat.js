/**
 * Atendimento — lado do CLIENTE (portal).
 *
 * O cliente só enxerga as conversas da própria empresa. Isso não é filtro de tela: toda
 * consulta aqui carrega `company_id` da sessão, e `carregarConversa` devolve null (→ 404)
 * quando o id pedido é de outra empresa. Um id adivinhado não abre porta.
 *
 * Ver docs/PLANO-CHAT-ATENDIMENTO-V2.md para o desenho e o porquê de cada trava.
 */
const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { validateUUID } = require("../middleware/validate");
const chat = require("../chatCore");
const chatEmail = require("../chatEmail");

router.use(authMiddleware);

/**
 * A empresa da sessão. O admin pode abrir o chat de uma empresa (suporte), mas precisa
 * dizer qual — "empresa padrão" seria o caminho mais curto para escrever no fio errado.
 */
function empresaDe(req) {
  if (req.isAdmin) {
    const id = (req.query.company_id || req.body?.company_id || "").toString();
    if (!validateUUID(id)) return { erro: "Informe company_id" };
    return { companyId: id };
  }
  if (!req.company?.id) return { erro: "Sessão de empresa inválida" };
  return { companyId: req.company.id };
}

/**
 * Ritmo de envio por empresa. Não é segurança de verdade (reinicia com o processo) —
 * é o suficiente para um botão travado ou um script bobo não encher a tela do atendente
 * com centenas de balões.
 */
const ULTIMOS_ENVIOS = new Map();
const TETO_POR_MINUTO = 20;

function souRapidoDemais(companyId) {
  const agora = Date.now();
  const janela = (ULTIMOS_ENVIOS.get(companyId) || []).filter((t) => agora - t < 60_000);
  janela.push(agora);
  ULTIMOS_ENVIOS.set(companyId, janela);
  return janela.length > TETO_POR_MINUTO;
}

/** Conversas da empresa, mais recentes primeiro, com o contador de não lidas. */
router.get("/conversations", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(400).json({ error: erro });
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.subject, c.status, c.created_at, c.last_message_at,
              c.resolved_at, c.resolved_by,
              (SELECT count(*) FROM chat_messages m
                WHERE m.conversation_id = c.id
                  AND m.sender_type <> 'client'
                  AND (c.read_by_client_at IS NULL OR m.created_at > c.read_by_client_at)
              )::int AS nao_lidas,
              (SELECT m.body FROM chat_messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS ultima_mensagem
         FROM conversations c
        WHERE c.company_id = $1::uuid
        ORDER BY c.last_message_at DESC`,
      [companyId]
    );
    res.json({ conversations: rows });
  } catch (err) {
    console.error("[chat] listar conversas:", err.message);
    res.status(500).json({ error: "Não foi possível carregar as conversas" });
  }
});

/** Badge do menu: quantas mensagens não lidas a empresa tem no total. */
router.get("/unread", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(400).json({ error: erro });
  try {
    const { rows } = await db.query(
      `SELECT count(*)::int AS total
         FROM chat_messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.company_id = $1::uuid
          AND m.sender_type <> 'client'
          AND (c.read_by_client_at IS NULL OR m.created_at > c.read_by_client_at)`,
      [companyId]
    );
    res.json({ count: rows[0]?.total || 0 });
  } catch (err) {
    console.error("[chat] unread:", err.message);
    res.json({ count: 0 }); // badge não é motivo para quebrar a tela
  }
});

/** Abre conversa já com a primeira mensagem — conversa vazia não serve para ninguém. */
router.post("/conversations", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(400).json({ error: erro });

  const { body, erro: erroBody } = chat.validarBody(req.body?.body);
  if (erroBody) return res.status(400).json({ error: erroBody });
  const subject = chat.validarSubject(req.body?.subject);

  if (souRapidoDemais(companyId)) {
    return res.status(429).json({ error: "Muitas mensagens seguidas. Aguarde um instante." });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO conversations (company_id, subject) VALUES ($1::uuid, $2) RETURNING *`,
      [companyId, subject]
    );
    const conversa = rows[0];
    await chat.inserirMensagem(db, {
      conversationId: conversa.id,
      senderType: "client",
      senderId: companyId,
      senderName: req.company?.name || null,
      body,
      clientMsgId: req.body?.client_msg_id || null,
    });
    chatEmail.avisarAdminsNovaMensagem(db, conversa.id).catch(() => {});
    res.status(201).json({ conversation: conversa });
  } catch (err) {
    console.error("[chat] abrir conversa:", err.message);
    res.status(500).json({ error: "Não foi possível abrir a conversa" });
  }
});

/** Mensagens da conversa (mais antigas primeiro — é como se lê um diálogo). */
router.get("/conversations/:id/messages", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(400).json({ error: erro });
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });

  try {
    const conversa = await chat.carregarConversa(db, req.params.id, {
      tipo: "client",
      companyId,
    });
    if (!conversa) return res.status(404).json({ error: "Conversa não encontrada" });

    const { rows } = await db.query(
      `SELECT id, sender_type, sender_name, body, created_at
         FROM chat_messages
        WHERE conversation_id = $1::uuid
        ORDER BY created_at, id`,
      [conversa.id]
    );
    res.json({ conversation: conversa, messages: rows });
  } catch (err) {
    console.error("[chat] mensagens:", err.message);
    res.status(500).json({ error: "Não foi possível carregar a conversa" });
  }
});

/** Envia mensagem. Reabre sozinha se a conversa estava resolvida (ver chatCore). */
router.post("/conversations/:id/messages", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(400).json({ error: erro });
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });

  const { body, erro: erroBody } = chat.validarBody(req.body?.body);
  if (erroBody) return res.status(400).json({ error: erroBody });

  if (souRapidoDemais(companyId)) {
    return res.status(429).json({ error: "Muitas mensagens seguidas. Aguarde um instante." });
  }

  try {
    const conversa = await chat.carregarConversa(db, req.params.id, {
      tipo: "client",
      companyId,
    });
    if (!conversa) return res.status(404).json({ error: "Conversa não encontrada" });

    const out = await chat.inserirMensagem(db, {
      conversationId: conversa.id,
      senderType: "client",
      senderId: companyId,
      senderName: req.company?.name || null,
      body,
      clientMsgId: req.body?.client_msg_id || null,
    });

    if (!out.duplicada) {
      chatEmail.avisarAdminsNovaMensagem(db, conversa.id).catch(() => {});
    }
    res.status(201).json({ message: out.mensagem, reaberta: out.reaberta });
  } catch (err) {
    console.error("[chat] enviar:", err.message);
    res.status(500).json({ error: "Não foi possível enviar a mensagem" });
  }
});

/** Marca como lidas até agora (marcador por lado — ver ensureChatSchema). */
router.post("/conversations/:id/read", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(400).json({ error: erro });
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });
  try {
    await db.query(
      `UPDATE conversations SET read_by_client_at = now()
        WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, companyId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[chat] read:", err.message);
    res.status(500).json({ error: "Falha ao marcar como lida" });
  }
});

/** O próprio cliente encerra o atendimento. */
router.post("/conversations/:id/resolver", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(400).json({ error: erro });
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });
  try {
    const conversa = await chat.carregarConversa(db, req.params.id, {
      tipo: "client",
      companyId,
    });
    if (!conversa) return res.status(404).json({ error: "Conversa não encontrada" });

    const ok = await chat.resolver(db, conversa.id, "cliente");
    if (ok) {
      await chat.mensagemDeSistema(db, conversa.id, "Atendimento encerrado pelo cliente.");
    }
    res.json({ ok: true, ja_estava_resolvida: !ok });
  } catch (err) {
    console.error("[chat] resolver (cliente):", err.message);
    res.status(500).json({ error: "Não foi possível encerrar o atendimento" });
  }
});

module.exports = router;
