const nodemailer = require("nodemailer");

function isSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM
  );
}

function getPublicAppUrl() {
  const base = (process.env.PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  return base;
}

function createTransport() {
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure =
    process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1" || port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * @param {{ to: string; resetUrl: string }} opts
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  if (!isSmtpConfigured()) {
    throw new Error("SMTP não configurado");
  }
  const from = process.env.SMTP_FROM;
  const transport = createTransport();
  const subject = "Redefinição de senha — Gestão de Documentos";
  const text = [
    "Recebemos um pedido para redefinir a senha desta conta.",
    "",
    `Abra o link (válido por tempo limitado):`,
    resetUrl,
    "",
    "Se não foi você, ignore este e-mail.",
  ].join("\n");

  const html = `
    <p>Recebemos um pedido para redefinir a senha desta conta.</p>
    <p><a href="${resetUrl.replace(/"/g, "&quot;")}">Redefinir senha</a></p>
    <p>Se não foi você, ignore este e-mail.</p>
  `;

  await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });
}

/**
 * Envia o backup cifrado como anexo.
 *
 * O corpo NÃO leva conteúdo do banco — só os números de conferência. O dado pessoal
 * está todo dentro do anexo, e o anexo só abre com a senha do backup.
 */
async function sendBackupEmail({ to, nome, arquivo, resumo }) {
  if (!isSmtpConfigured()) throw new Error("SMTP não configurado");
  const transport = createTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: `Backup do Portal — ${nome}`,
    text: [
      resumo,
      "",
      "O anexo está criptografado (AES-256-GCM).",
      "Para restaurar: node scripts/restaurar-backup.cjs <arquivo> (pede a senha).",
    ].join("\n"),
    attachments: [{ filename: nome, content: arquivo }],
  });
}

module.exports = {
  isSmtpConfigured,
  getPublicAppUrl,
  sendBackupEmail,
  sendPasswordResetEmail,
};
