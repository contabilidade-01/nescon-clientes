/**
 * Tabelas do módulo de Atendimento (chat escritório ↔ cliente).
 *
 * Padrão idempotente do projeto (ver ensureCoraSchema.js): CREATE ... IF NOT EXISTS,
 * re-execução é no-op. Roda no boot, antes de montar as rotas.
 *
 * Três decisões deste schema merecem explicação, porque cada uma corrigiu um defeito
 * concreto do plano anterior (ver docs/PLANO-CHAT-ATENDIMENTO-V2.md §1):
 *
 * 1. **Leitura é por LADO, não por mensagem.** O desenho original tinha `read_at` em
 *    cada mensagem. Isso só funciona com um leitor de cada lado — e aqui há N atendentes
 *    contra 1 cliente: o primeiro atendente que abrisse a conversa zeraria o "não lidas"
 *    de todos os outros. Por isso a marca de leitura mora na CONVERSA, uma para cada
 *    lado (`read_by_client_at` / `read_by_admin_at`).
 *
 * 2. **`client_msg_id` + índice único parcial.** É a trava contra mensagem duplicada:
 *    duplo clique no botão enviar, ou o retry automático do navegador quando a rede
 *    oscila, chegariam como dois POSTs idênticos. Com a chave, o segundo cai no
 *    ON CONFLICT e devolve o que já existe, em vez de repetir o balão.
 *
 * 3. **`sender_id` aceita NULL.** Mensagem de sistema ("Atendimento transferido de X
 *    para Y") não tem autor. No desenho anterior a coluna era NOT NULL, e o INSERT da
 *    primeira transferência quebraria em produção.
 *
 * A tabela chama-se `chat_messages`, e não `messages`: este banco é de domínio fiscal e
 * um dia vai guardar mensagem de WhatsApp e de e-mail. `messages` sozinho não diria de
 * qual delas se trata.
 */

async function ensureChatSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        subject TEXT,
        status TEXT NOT NULL DEFAULT 'aberto'
               CHECK (status IN ('aberto','em_atendimento','resolvido')),
        -- SET NULL, não CASCADE: desligar um atendente não pode apagar o histórico de
        -- atendimento dele. A conversa volta para a fila sem dono.
        assigned_to UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT CHECK (resolved_by IN ('cliente','admin')),
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        read_by_client_at TIMESTAMPTZ,
        read_by_admin_at TIMESTAMPTZ,
        -- Anti-flood do e-mail: guarda o último aviso enviado para cada lado, para uma
        -- conversa animada não virar quarenta e-mails (ver chatEmail.js).
        email_avisado_admin_at TIMESTAMPTZ,
        email_avisado_client_at TIMESTAMPTZ
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_type TEXT NOT NULL CHECK (sender_type IN ('client','admin','system')),
        sender_id UUID,
        sender_name TEXT,
        body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
        client_msg_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Timeline da conversa. O `id` no fim não é enfeite: dois balões gravados no mesmo
    // milissegundo empatam em created_at, e sem desempate a paginação por cursor pode
    // pular ou repetir mensagem na virada de página.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_msgs_conv
        ON chat_messages(conversation_id, created_at, id)
    `);

    // Idempotência (ver nota 2 no topo). Parcial: mensagens do admin e de sistema não
    // mandam chave e não devem colidir entre si por NULL.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_msgs_idem
        ON chat_messages(conversation_id, client_msg_id)
        WHERE client_msg_id IS NOT NULL
    `);

    // Fila do atendente e listas por empresa.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_conv_fila
        ON conversations(status, last_message_at DESC)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_conv_assigned
        ON conversations(assigned_to) WHERE assigned_to IS NOT NULL
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_conv_company
        ON conversations(company_id, last_message_at DESC)
    `);

    // Mensagens podem ter anexo (PDF, imagem, etc.)
    await db.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_path TEXT`);
    await db.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT`);

    console.log("[DB] chat: tabelas e índices verificados/criados.");
  } catch (err) {
    console.error("[DB] ensureChatSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureChatSchema };
