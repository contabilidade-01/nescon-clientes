/**
 * Atendimento — lado do ESCRITÓRIO.
 *
 * A regra que este arquivo existe para cumprir:
 *
 *   conversa SEM DONO  → todo atendente vê (é a fila da casa);
 *   conversa ASSUMIDA  → só o dono vê;
 *   dono do sistema    → vê tudo, sempre.
 *
 * O filtro vive no SQL (`chatCore.sqlVisibilidadeAdmin`), nunca no React: esconder o
 * card na tela não impediria um `curl` de ler a conversa alheia.
 *
 * Fora do escopo devolvemos **404 e não 403**. 403 seria dizer "existe, mas não é sua" —
 * e isso entrega o mapa das conversas dos colegas para quem for procurar.
 */
const router = require("express").Router();
const db = require("../db");
const { uploadPdf } = require("../uploads");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID } = require("../middleware/validate");
const chat = require("../chatCore");
const chatEmail = require("../chatEmail");

router.use(authMiddleware, requireArea("atendimento"));

/** Quem está pedindo — usado em toda consulta abaixo. */
function ator(req) {
  return { tipo: "admin", adminId: req.admin.id, isOwner: Boolean(req.admin.isOwner) };
}

/**
 * Fila + minhas conversas. `status` e `company_id` são filtros opcionais; a visibilidade
 * NÃO é opcional e entra sempre.
 */
router.get("/", async (req, res) => {
  const { adminId, isOwner } = ator(req);
  const params = [adminId, isOwner];
  let where = `WHERE ${chat.sqlVisibilidadeAdmin(1, 2)}`;

  const status = (req.query.status || "").toString();
  if (["aberto", "em_atendimento", "resolvido"].includes(status)) {
    params.push(status);
    where += ` AND c.status = $${params.length}`;
  }
  const companyId = (req.query.company_id || "").toString();
  if (companyId && validateUUID(companyId)) {
    params.push(companyId);
    where += ` AND c.company_id = $${params.length}::uuid`;
  }

  try {
    const { rows } = await db.query(
      `SELECT c.id, c.subject, c.status, c.assigned_to, c.created_at,
              c.last_message_at, c.resolved_at, c.resolved_by,
              e.name AS empresa, e.cnpj,
              a.nome AS responsavel_nome,
              (SELECT count(*) FROM chat_messages m
                WHERE m.conversation_id = c.id
                  AND m.sender_type = 'client'
                  AND (c.read_by_admin_at IS NULL OR m.created_at > c.read_by_admin_at)
              )::int AS nao_lidas,
              (SELECT m.body FROM chat_messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS ultima_mensagem
         FROM conversations c
         JOIN companies e ON e.id = c.company_id
         LEFT JOIN platform_admins a ON a.id = c.assigned_to
         ${where}
        ORDER BY (c.assigned_to IS NULL) DESC, c.last_message_at DESC
        LIMIT 200`,
      params
    );
    res.json({ conversations: rows });
  } catch (err) {
    console.error("[adminChat] listar:", err.message);
    res.status(500).json({ error: "Não foi possível carregar os atendimentos" });
  }
});

/**
 * Cartões do topo — contados sobre o MESMO escopo que a pessoa enxerga.
 *
 * `espera_mais_antiga_h` é a métrica que realmente denuncia problema: os contadores
 * dizem QUANTAS conversas esperam, mas não há quanto tempo. Cinco conversas na fila há
 * dez minutos é uma manhã movimentada; UMA há dois dias é um cliente esquecido — e é
 * esse segundo caso que custa a conta. Por isso ela sai junto.
 */
router.get("/summary", async (req, res) => {
  const { adminId, isOwner } = ator(req);
  try {
    const { rows } = await db.query(
      `SELECT
         count(*) FILTER (WHERE c.status = 'aberto' AND c.assigned_to IS NULL)::int AS na_fila,
         count(*) FILTER (WHERE c.status = 'em_atendimento')::int AS em_atendimento,
         count(*) FILTER (WHERE c.status = 'em_atendimento'
                            AND c.assigned_to = $1::uuid)::int AS meus,
         count(*) FILTER (WHERE c.status = 'resolvido'
                            AND c.resolved_at::date = now()::date)::int AS resolvidos_hoje,
         count(*) FILTER (WHERE c.status = 'resolvido'
                            AND c.resolved_at >= now() - interval '7 days')::int AS resolvidos_7d,
         -- Espera do mais antigo que ainda não foi resolvido, em horas.
         COALESCE(
           EXTRACT(EPOCH FROM (now() - min(c.last_message_at)
             FILTER (WHERE c.status <> 'resolvido' AND c.assigned_to IS NULL))) / 3600,
           0)::int AS espera_mais_antiga_h
         FROM conversations c
        WHERE ${chat.sqlVisibilidadeAdmin(1, 2)}`,
      [adminId, isOwner]
    );
    res.json(
      rows[0] || {
        na_fila: 0, em_atendimento: 0, meus: 0,
        resolvidos_hoje: 0, resolvidos_7d: 0, espera_mais_antiga_h: 0,
      }
    );
  } catch (err) {
    console.error("[adminChat] summary:", err.message);
    res.status(500).json({ error: "Não foi possível carregar o resumo" });
  }
});

/** Badge do menu: quantas mensagens de cliente esperando, no escopo visível. */
router.get("/unread", async (req, res) => {
  const { adminId, isOwner } = ator(req);
  try {
    const { rows } = await db.query(
      `SELECT count(*)::int AS total
         FROM chat_messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.sender_type = 'client'
          AND (c.read_by_admin_at IS NULL OR m.created_at > c.read_by_admin_at)
          AND ${chat.sqlVisibilidadeAdmin(1, 2)}`,
      [adminId, isOwner]
    );
    res.json({ count: rows[0]?.total || 0 });
  } catch (err) {
    console.error("[adminChat] unread:", err.message);
    res.json({ count: 0 });
  }
});

/**
 * Colegas para o select de transferência.
 *
 * Declarada ANTES das rotas com `:id`: o Express casa na ordem, e uma rota estática
 * depois de `/:id` vira refém do parâmetro no dia em que alguém acrescentar `GET /:id`.
 */
router.get("/atendentes", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, nome FROM platform_admins
        WHERE active IS TRUE
          AND (is_owner IS TRUE OR areas IS NULL OR (areas->>'atendimento')::boolean IS TRUE)
        ORDER BY nome`
    );
    res.json({ atendentes: rows });
  } catch (err) {
    console.error("[adminChat] atendentes:", err.message);
    res.status(500).json({ error: "Não foi possível carregar os atendentes" });
  }
});

/** Conversa aberta + fio de mensagens. 404 se estiver fora do escopo. */
router.get("/:id/messages", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });
  try {
    const conversa = await chat.carregarConversa(db, req.params.id, ator(req));
    if (!conversa) return res.status(404).json({ error: "Atendimento não encontrado" });

    const { rows } = await db.query(
      `SELECT m.id, m.sender_type, m.sender_name, m.body, m.created_at,
              m.attachment_path, m.attachment_name
         FROM chat_messages m
        WHERE m.conversation_id = $1::uuid
        ORDER BY m.created_at, m.id`,
      [conversa.id]
    );
    const { rows: emp } = await db.query(
      `SELECT name, cnpj, contact_email, phone FROM companies WHERE id = $1::uuid`,
      [conversa.company_id]
    );
    res.json({ conversation: conversa, empresa: emp[0] || null, messages: rows });
  } catch (err) {
    console.error("[adminChat] mensagens:", err.message);
    res.status(500).json({ error: "Não foi possível carregar o atendimento" });
  }
});

/**
 * Responder. Exige ser o dono (ou o dono do sistema): responder conversa de colega
 * pelas costas é exatamente o que a regra de visibilidade evita.
 */
router.post("/:id/messages", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });
  const { body, erro } = chat.validarBody(req.body?.body);
  if (erro) return res.status(400).json({ error: erro });

  const a = ator(req);
  try {
    const conversa = await chat.carregarConversa(db, req.params.id, a);
    if (!conversa) return res.status(404).json({ error: "Atendimento não encontrado" });

    if (!a.isOwner && conversa.assigned_to && conversa.assigned_to !== a.adminId) {
      return res.status(403).json({ error: "Este atendimento é de outro colega." });
    }
    // Responder sem ter assumido é o caso comum (pega da fila e já responde): assume
    // junto, para a conversa não ficar sem dono depois de respondida.
    if (!conversa.assigned_to) await chat.assumir(db, conversa.id, a.adminId);

    const out = await chat.inserirMensagem(db, {
      conversationId: conversa.id,
      senderType: "admin",
      senderId: a.adminId,
      senderName: req.admin.nome || "Escritório",
      body,
      clientMsgId: req.body?.client_msg_id || null,
    });
    if (!out.duplicada) {
      chatEmail.avisarClienteNovaResposta(db, conversa.id).catch(() => {});
    }
    res.status(201).json({ message: out.mensagem });
  } catch (err) {
    console.error("[adminChat] responder:", err.message);
    res.status(500).json({ error: "Não foi possível enviar a resposta" });
  }
});

/**
 * POST /:id/upload — envia mensagem com documento anexo.
 * O body da mensagem é opcional (pode mandar só o arquivo).
 */
router.post("/:id/upload", uploadPdf.single("file"), async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });
  if (!req.file) return res.status(400).json({ error: "Envie um arquivo" });

  const a = ator(req);
  const body = (req.body?.body || "").toString().trim() || `📎 ${req.file.originalname}`;

  try {
    const conversa = await chat.carregarConversa(db, req.params.id, a);
    if (!conversa) return res.status(404).json({ error: "Atendimento não encontrado" });

    if (!a.isOwner && conversa.assigned_to && conversa.assigned_to !== a.adminId) {
      return res.status(403).json({ error: "Este atendimento é de outro colega." });
    }
    if (!conversa.assigned_to) await chat.assumir(db, conversa.id, a.adminId);

    // Gravar mensagem com referência ao anexo
    const { rows } = await db.query(
      `INSERT INTO chat_messages
         (conversation_id, sender_type, sender_id, sender_name, body, attachment_path, attachment_name)
       VALUES ($1, 'admin', $2, $3, $4, $5, $6)
       RETURNING id, sender_type, sender_name, body, attachment_path, attachment_name, created_at`,
      [conversa.id, a.adminId, req.admin.nome || "Escritório", body, req.file.filename, req.file.originalname]
    );

    await db.query(
      `UPDATE conversations SET last_message_at = now(), status = CASE WHEN status = 'aberto' THEN 'em_atendimento' ELSE status END WHERE id = $1`,
      [conversa.id]
    );

    chatEmail.avisarClienteNovaResposta(db, conversa.id).catch(() => {});
    res.status(201).json({ message: rows[0] });
  } catch (err) {
    console.error("[adminChat] upload:", err.message);
    res.status(500).json({ error: "Não foi possível enviar o documento" });
  }
});

/** Ações de fluxo: assumir | transferir | resolver | reabrir. */
router.patch("/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });
  const a = ator(req);
  const acao = (req.body?.action || "").toString();

  try {
    const conversa = await chat.carregarConversa(db, req.params.id, a);
    if (!conversa) return res.status(404).json({ error: "Atendimento não encontrado" });

    if (acao === "assumir") {
      const ok = await chat.assumir(db, conversa.id, a.adminId);
      // Já ter dono não é erro do sistema, é corrida perdida — e o atendente precisa
      // saber disso ANTES de escrever uma resposta que seria a segunda do cliente.
      if (!ok) {
        return res.status(409).json({
          error: "Outro atendente assumiu este atendimento primeiro.",
        });
      }
      await chat.mensagemDeSistema(
        db, conversa.id, `${req.admin.nome || "Escritório"} assumiu o atendimento.`
      );
      return res.json({ ok: true });
    }

    if (acao === "transferir") {
      const para = (req.body?.transferir_para || "").toString();
      if (!validateUUID(para)) return res.status(400).json({ error: "Escolha para quem transferir" });
      const { rows } = await db.query(
        `SELECT nome FROM platform_admins WHERE id = $1::uuid AND active IS TRUE`,
        [para]
      );
      if (!rows.length) return res.status(400).json({ error: "Colega não encontrado ou inativo" });

      const ok = await chat.transferir(db, conversa.id, {
        deAdminId: a.adminId, paraAdminId: para, isOwner: a.isOwner,
      });
      if (!ok) return res.status(409).json({ error: "Este atendimento não é seu." });
      await chat.mensagemDeSistema(
        db, conversa.id,
        `Atendimento transferido de ${req.admin.nome || "Escritório"} para ${rows[0].nome || "colega"}.`
      );
      return res.json({ ok: true });
    }

    if (acao === "resolver") {
      const ok = await chat.resolver(db, conversa.id, "admin");
      if (ok) {
        await chat.mensagemDeSistema(
          db, conversa.id, `Atendimento encerrado por ${req.admin.nome || "Escritório"}.`
        );
      }
      return res.json({ ok: true, ja_estava_resolvida: !ok });
    }

    if (acao === "reabrir") {
      const ok = await chat.reabrir(db, conversa.id);
      if (ok) await chat.mensagemDeSistema(db, conversa.id, "Atendimento reaberto.");
      return res.json({ ok: true, ja_estava_aberta: !ok });
    }

    return res.status(400).json({ error: "Ação desconhecida" });
  } catch (err) {
    console.error("[adminChat] patch:", err.message);
    res.status(500).json({ error: "Não foi possível concluir a ação" });
  }
});

/**
 * Marca o lado do escritório como lido — **só quando a conversa já tem dono, e o dono
 * é quem está lendo**.
 *
 * `read_by_admin_at` é uma marca por LADO, e o lado do escritório tem várias pessoas.
 * Se qualquer um pudesse carimbá-la, bastava um atendente espiar uma conversa da fila
 * para o "não lidas" sumir do painel de todos os outros — e a mensagem ficaria sem
 * resposta justamente por ter sido vista.
 *
 * Enquanto ninguém assume, a conversa CONTINUA marcada como não lida para todos. É o
 * comportamento certo: a fila só apaga quando alguém a toma para si.
 */
router.post("/:id/read", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });
  const a = ator(req);
  try {
    const conversa = await chat.carregarConversa(db, req.params.id, a);
    if (!conversa) return res.status(404).json({ error: "Atendimento não encontrado" });

    const { rowCount } = await db.query(
      `UPDATE conversations SET read_by_admin_at = now()
        WHERE id = $1::uuid AND assigned_to = $2::uuid`,
      [conversa.id, a.adminId]
    );
    // Não é erro: abrir uma conversa da fila (ou a de um colega, no caso do dono do
    // sistema) é leitura legítima — apenas não carimba o marcador de ninguém.
    res.json({ ok: true, marcada: rowCount === 1 });
  } catch (err) {
    console.error("[adminChat] read:", err.message);
    res.status(500).json({ error: "Falha ao marcar como lido" });
  }
});

module.exports = router;
