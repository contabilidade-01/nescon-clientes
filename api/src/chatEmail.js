/**
 * Aviso por e-mail de mensagem nova no atendimento.
 *
 * Três regras que definem este módulo:
 *
 * 1. **Nunca atrasa nem derruba o chat.** É chamado sem `await` pelas rotas e engole os
 *    próprios erros. Servidor de e-mail fora do ar não pode impedir alguém de mandar
 *    mensagem — a mensagem já está gravada quando isto roda.
 *
 * 2. **Um aviso por conversa a cada 15 minutos.** Sem essa trava, uma conversa animada
 *    ("oi" / "tudo bem?" / "então") vira dez e-mails em dois minutos, e a caixa de
 *    entrada de quem atende deixa de ser útil — que é o mesmo que não avisar.
 *
 * 3. **O corpo do cliente é escapado.** O React escapa sozinho; o e-mail, não. Sem isto,
 *    um texto com `<` viraria HTML no cliente de e-mail.
 */
const { isSmtpConfigured, getPublicAppUrl, createTransport } = require("./mailer");

const JANELA_ANTIFLOOD_MIN = 15;

function escaparHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function trecho(texto, max = 300) {
  const t = String(texto || "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

async function enviar({ to, subject, html }) {
  if (!to || !isSmtpConfigured()) return false;
  const transport = createTransport();
  if (!transport) return false;
  await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
  return true;
}

/**
 * Cliente mandou mensagem → avisa quem atende.
 *
 * Destinatário: o dono da conversa, se já houver. Sem dono, todo mundo da área
 * `atendimento` — é a fila comum, e ninguém em particular é responsável ainda.
 */
async function avisarAdminsNovaMensagem(db, conversationId) {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.subject, c.assigned_to, c.email_avisado_admin_at,
              e.name AS empresa,
              (SELECT m.body FROM chat_messages m
                WHERE m.conversation_id = c.id AND m.sender_type = 'client'
                ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS ultima
         FROM conversations c
         JOIN companies e ON e.id = c.company_id
        WHERE c.id = $1::uuid`,
      [conversationId]
    );
    const conversa = rows[0];
    if (!conversa) return;

    // Trava anti-flood: silêncio se já avisamos há pouco.
    if (conversa.email_avisado_admin_at) {
      const min = (Date.now() - new Date(conversa.email_avisado_admin_at).getTime()) / 60000;
      if (min < JANELA_ANTIFLOOD_MIN) return;
    }

    // Quem recebe:
    //
    //  - conversa COM dono → só o dono. É dele o atendimento;
    //  - conversa SEM dono → a fila. Aqui vale a preferência do escritório:
    //      · `CHAT_EMAIL_EQUIPE` definido → um único endereço (ex.: atendimento@…).
    //        É o caminho recomendado: a caixa da equipe recebe um aviso e quem estiver
    //        livre pega, em vez de dez pessoas recebendo dez cópias do mesmo assunto
    //        e todas supondo que outra vai responder;
    //      · sem a variável → cai no comportamento antigo, um e-mail endereçado a
    //        todos os atendentes (uma mensagem só, com vários destinatários — nunca
    //        uma mensagem por pessoa).
    let para = [];
    if (conversa.assigned_to) {
      const { rows: dono } = await db.query(
        `SELECT contact_email AS email FROM platform_admins
          WHERE id = $1::uuid AND active IS TRUE AND contact_email IS NOT NULL`,
        [conversa.assigned_to]
      );
      para = dono.map((d) => d.email).filter(Boolean);
    } else if (process.env.CHAT_EMAIL_EQUIPE) {
      para = [process.env.CHAT_EMAIL_EQUIPE.trim()];
    } else {
      const { rows: equipe } = await db.query(
        `SELECT contact_email AS email FROM platform_admins
          WHERE active IS TRUE AND contact_email IS NOT NULL
            AND (is_owner IS TRUE OR areas IS NULL
                 OR (areas->>'atendimento')::boolean IS TRUE)`
      );
      para = equipe.map((d) => d.email).filter(Boolean);
    }
    if (!para.length) return;

    const url = `${getPublicAppUrl()}/admin/atendimentos`;
    const ok = await enviar({
      to: para.join(", "),
      subject: `Nova mensagem no atendimento — ${conversa.empresa}`,
      html: `
        <p><strong>${escaparHtml(conversa.empresa)}</strong> enviou uma mensagem no portal.</p>
        ${conversa.subject ? `<p>Assunto: ${escaparHtml(conversa.subject)}</p>` : ""}
        <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#444">
          ${escaparHtml(trecho(conversa.ultima))}
        </blockquote>
        <p><a href="${url}">Abrir o atendimento</a></p>`,
    });
    if (ok) {
      await db.query(
        `UPDATE conversations SET email_avisado_admin_at = now() WHERE id = $1::uuid`,
        [conversationId]
      );
    }
  } catch (err) {
    // Best-effort de propósito: o aviso é conforto, a mensagem já está salva.
    console.warn("[chatEmail] aviso ao escritório falhou:", err.message);
  }
}

/**
 * Escritório respondeu → avisa a empresa.
 *
 * Respeita `alertas_ativos`: é a mesma marcação que o escritório usa para os alertas de
 * vencimento. Empresa com o canal desligado não recebe e-mail — a resposta continua lá,
 * no portal, quando ela entrar.
 */
async function avisarClienteNovaResposta(db, conversationId) {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.subject, c.email_avisado_client_at,
              e.name AS empresa, e.contact_email AS email, e.alertas_ativos,
              (SELECT m.body FROM chat_messages m
                WHERE m.conversation_id = c.id AND m.sender_type = 'admin'
                ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS ultima
         FROM conversations c
         JOIN companies e ON e.id = c.company_id
        WHERE c.id = $1::uuid`,
      [conversationId]
    );
    const conversa = rows[0];
    if (!conversa || !conversa.email) return;
    if (conversa.alertas_ativos === false) return;

    if (conversa.email_avisado_client_at) {
      const min = (Date.now() - new Date(conversa.email_avisado_client_at).getTime()) / 60000;
      if (min < JANELA_ANTIFLOOD_MIN) return;
    }

    const url = `${getPublicAppUrl()}/mensagens`;
    const ok = await enviar({
      to: conversa.email,
      subject: "Você recebeu uma resposta no portal",
      html: `
        <p>Olá, ${escaparHtml(conversa.empresa)}!</p>
        <p>O escritório respondeu a sua mensagem no portal.</p>
        <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#444">
          ${escaparHtml(trecho(conversa.ultima))}
        </blockquote>
        <p><a href="${url}">Abrir no portal</a></p>`,
    });
    if (ok) {
      await db.query(
        `UPDATE conversations SET email_avisado_client_at = now() WHERE id = $1::uuid`,
        [conversationId]
      );
    }
  } catch (err) {
    console.warn("[chatEmail] aviso ao cliente falhou:", err.message);
  }
}

module.exports = { avisarAdminsNovaMensagem, avisarClienteNovaResposta };
