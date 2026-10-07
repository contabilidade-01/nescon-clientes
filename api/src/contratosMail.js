/**
 * E-mails do módulo de contratos. Usa o mesmo transporte SMTP do resto do portal
 * (mailer.js). Sem SMTP configurado, as funções só avisam no log — a assinatura pela
 * ZapSign não depende deste e-mail, porque a própria ZapSign manda o link ao signatário.
 */
const { createTransport, isSmtpConfigured } = require("./mailer");

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/**
 * @param {{ para: string[]; assunto: string; linhas: string[]; link?: { texto: string; url: string } | null;
 *   anexo?: { nome: string; conteudo: Buffer } | null }} p
 * @returns {Promise<boolean>} true se enviou
 */
async function enviarEmailContrato(p) {
  const destinos = (p.para || []).map((e) => String(e || "").trim()).filter((e) => /\S+@\S+\.\S+/.test(e));
  if (!destinos.length) return false;
  if (!isSmtpConfigured()) {
    console.warn("[contratos] SMTP não configurado — e-mail não enviado para", destinos.join(", "));
    return false;
  }
  const transport = createTransport();
  const texto = [...p.linhas, "", p.link ? `${p.link.texto}: ${p.link.url}` : ""].join("\n").trim();
  const html = [
    ...p.linhas.map((l) => `<p>${escapeHtml(l)}</p>`),
    p.link ? `<p><a href="${escapeHtml(p.link.url)}">${escapeHtml(p.link.texto)}</a></p>` : "",
  ].join("");
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: destinos.join(", "),
    subject: p.assunto,
    text: texto,
    html,
    attachments: p.anexo ? [{ filename: p.anexo.nome, content: p.anexo.conteudo }] : [],
  });
  return true;
}

module.exports = { enviarEmailContrato };
