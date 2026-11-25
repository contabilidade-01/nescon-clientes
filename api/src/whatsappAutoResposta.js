/**
 * Resposta automática do WhatsApp para mensagens FORA do fluxo de advertência/suspensão.
 *
 * Regra do escritório (Jeandson, 2026-11-25): este número serve só para o envio de
 * documentos e alertas. Qualquer outra mensagem de cliente recebe um aviso curto pedindo
 * para falar com o escritório (recálculos e demais pedidos).
 *
 * Para não repetir o aviso a cada mensagem seguida do mesmo contato, ele sai no máximo
 * uma vez a cada AUTO_RESPOSTA_INTERVALO_H horas (padrão 12h) por telefone. O controle
 * fica no banco (`whatsapp_auto_resposta`), então sobrevive a deploy/restart.
 */
const { getPublicAppUrl } = require("./mailer");

const INTERVALO_PADRAO_H = 12;

function digits(v) {
  return String(v || "").replace(/\D/g, "");
}

function intervaloHoras() {
  const n = Number(process.env.AUTO_RESPOSTA_INTERVALO_H);
  return Number.isFinite(n) && n > 0 ? n : INTERVALO_PADRAO_H;
}

function telefoneVisivel(num) {
  return num.startsWith("55") && num.length >= 12
    ? `(${num.slice(2, 4)}) ${num.slice(4, num.length - 4)}-${num.slice(-4)}`
    : num;
}

/** Texto do aviso. */
function textoAutoResposta() {
  const num = digits(process.env.NESCON_CONTATO_WHATSAPP || process.env.ADMIN_WHATSAPP || "5511948626605");
  const portal = getPublicAppUrl() || "https://app.gestaoempresa.com";
  return (
    `🤖 *Mensagem automática da Nescon Contabilidade*\n\n` +
    `Este canal é usado *apenas para o envio de documentos e alertas* (guias, boletos e avisos de vencimento). ` +
    `Aqui também é possível pedir *advertência* ou *suspensão* de funcionário.\n\n` +
    `Para *recálculos* e *demais pedidos*, entre em contato com o escritório:\n` +
    `📱 WhatsApp: ${telefoneVisivel(num)}\n` +
    `💻 Portal: ${portal}\n\n` +
    `Obrigado!`
  );
}

/**
 * Devolve o texto do aviso se este telefone ainda não recebeu um dentro do intervalo,
 * ou null. Marca o envio no mesmo comando (atômico): duas mensagens chegando juntas
 * não geram dois avisos. Se o banco falhar, não responde (melhor calar do que repetir).
 */
async function autoRespostaPara(db, phone) {
  const tel = digits(phone);
  if (!tel) return null;
  try {
    const { rows } = await db.query(
      `INSERT INTO whatsapp_auto_resposta (phone, enviado_em)
       VALUES ($1, now())
       ON CONFLICT (phone) DO UPDATE SET enviado_em = now()
         WHERE whatsapp_auto_resposta.enviado_em < now() - make_interval(secs => $2)
       RETURNING phone`,
      [tel, Math.round(intervaloHoras() * 3600)]
    );
    return rows.length ? textoAutoResposta() : null;
  } catch (err) {
    console.error("[whatsapp] auto-resposta:", err.message);
    return null;
  }
}

module.exports = { autoRespostaPara, textoAutoResposta, intervaloHoras };
