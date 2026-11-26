/**
 * Recálculo de impostos SEM LOGIN, com dois fatores (página /recalculo):
 *   1. o cliente digita o CNPJ da empresa;
 *   2. recebe um código de 6 dígitos no E-MAIL CADASTRADO da empresa, válido por 10 minutos.
 * Código certo → link curto (60 min) da tela de guias `/g/:token` com origem 'cobranca',
 * que mostra SÓ os débitos daquela empresa e gera a guia atualizada. Nada mais do portal.
 *
 * Proteções:
 *  - o e-mail nunca aparece inteiro na tela (emailMascara.js);
 *  - só o hash (com sal por código) é gravado; o código vale uma vez;
 *  - 5 erros no mesmo código → código cancelado (tem que pedir outro);
 *  - 1 código por minuto e no máximo 5 por hora por empresa; pedir outro cancela o anterior;
 *  - limite por IP nas rotas (routes/recalculo.js).
 */
const crypto = require("crypto");
const { mascararEmail } = require("./emailMascara");

const MINUTOS_CODIGO = 10;
const MINUTOS_ACESSO = 60;
const MAX_ERROS = 5;
const ESPERA_REENVIO_SEG = 60;
const MAX_CODIGOS_HORA = 5;

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function digitos(v) {
  return String(v ?? "").replace(/\D/g, "");
}

/** contact_email pode vir com mais de um endereço: usa o primeiro válido. */
function primeiroEmail(v) {
  for (const parte of String(v || "").split(/[\s,;]+/)) {
    const e = parte.trim().toLowerCase();
    if (EMAIL_RE.test(e)) return e;
  }
  return null;
}

function gerarCodigo() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashCodigo(codigo, sal = crypto.randomBytes(16).toString("hex")) {
  const h = crypto.createHash("sha256").update(`${sal}:${codigo}`).digest("hex");
  return `${sal}$${h}`;
}

function confere(codigo, guardado) {
  const [sal, h] = String(guardado || "").split("$");
  if (!sal || !h) return false;
  const calc = hashCodigo(String(codigo), sal).split("$")[1];
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(h, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function empresaPorCnpj(db, cnpj) {
  const { rows } = await db.query(
    `SELECT id, name, cnpj, contact_email FROM companies
      WHERE regexp_replace(COALESCE(cnpj, ''), '[^0-9]', '', 'g') = $1
        AND COALESCE(arquivada, false) = false
        AND COALESCE(excluida, false) = false
      LIMIT 1`,
    [cnpj]
  );
  return rows[0] || null;
}

function textoEmail({ empresa, codigo }) {
  const assunto = `Seu código de acesso: ${codigo}`;
  const texto = [
    `Olá, ${empresa.name}.`,
    "",
    `Seu código para ver os impostos em aberto e gerar a guia atualizada é: ${codigo}`,
    "",
    `Ele vale por ${MINUTOS_CODIGO} minutos e só pode ser usado uma vez.`,
    "Se não foi você quem pediu, ignore este e-mail. Ninguém entra sem este código.",
    "",
    "Nescon Contabilidade",
  ].join("\n");
  const html = `<p>Olá, ${escapar(empresa.name)}.</p>
    <p>Seu código para ver os impostos em aberto e gerar a guia atualizada é:</p>
    <p style="font-size:28px;font-weight:bold;letter-spacing:6px;font-family:monospace;margin:16px 0">${codigo}</p>
    <p>Ele vale por <b>${MINUTOS_CODIGO} minutos</b> e só pode ser usado uma vez.</p>
    <p style="color:#555;font-size:13px">Se não foi você quem pediu, ignore este e-mail. Ninguém entra sem este código.</p>
    <p>Nescon Contabilidade</p>`;
  return { assunto, texto, html };
}

function escapar(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * Pede um código. `enviar({ to, subject, text, html })` manda o e-mail.
 * Devolve { status, body } pronto para a rota.
 */
async function pedirCodigo(db, { cnpj, ip, enviar }) {
  const c = digitos(cnpj);
  if (c.length !== 14) return { status: 400, body: { error: "Digite o CNPJ completo (14 números)." } };
  const empresa = await empresaPorCnpj(db, c);
  const email = empresa ? primeiroEmail(empresa.contact_email) : null;
  if (!empresa || !email) {
    return {
      status: 404,
      body: { error: "Não encontramos um e-mail cadastrado para esse CNPJ. Fale com o escritório para atualizar o cadastro." },
    };
  }

  const { rows: recentes } = await db.query(
    `SELECT count(*)::int AS n,
            COALESCE(EXTRACT(EPOCH FROM (now() - max(criado_em))), 999999)::int AS seg
       FROM recalculo_codigos WHERE company_id = $1 AND criado_em > now() - interval '1 hour'`,
    [empresa.id]
  );
  const { n, seg } = recentes[0] || { n: 0, seg: 999999 };
  if (seg < ESPERA_REENVIO_SEG) {
    return { status: 429, body: { error: `Aguarde ${ESPERA_REENVIO_SEG - seg} segundos para pedir outro código.`, aguardar: ESPERA_REENVIO_SEG - seg } };
  }
  if (n >= MAX_CODIGOS_HORA) {
    return { status: 429, body: { error: "Muitos códigos pedidos para esta empresa. Tente de novo daqui a uma hora ou fale com o escritório." } };
  }

  const codigo = gerarCodigo();
  await db.query(
    `UPDATE recalculo_codigos SET cancelado_em = now()
      WHERE company_id = $1 AND usado_em IS NULL AND cancelado_em IS NULL AND expira_em > now()`,
    [empresa.id]
  );
  const { rows } = await db.query(
    `INSERT INTO recalculo_codigos (company_id, codigo_hash, email, expira_em, ip)
     VALUES ($1, $2, $3, now() + ($4::int * interval '1 minute'), $5)
     RETURNING id, expira_em`,
    [empresa.id, hashCodigo(codigo), email, MINUTOS_CODIGO, String(ip || "").slice(0, 60)]
  );
  const m = textoEmail({ empresa, codigo });
  try {
    await enviar({ to: email, subject: m.assunto, text: m.texto, html: m.html });
  } catch (err) {
    console.error("[recalculo] e-mail do código:", err.message);
    await db.query(`UPDATE recalculo_codigos SET cancelado_em = now() WHERE id = $1`, [rows[0].id]);
    return { status: 502, body: { error: "Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos ou fale com o escritório." } };
  }
  return {
    status: 200,
    body: { ok: true, email: mascararEmail(email), expira_em: rows[0].expira_em, minutos: MINUTOS_CODIGO, reenviar_em: ESPERA_REENVIO_SEG },
  };
}

/**
 * Confere o código. `criarAcesso(companyId)` → { id, token } do link curto da tela de guias.
 * Devolve { status, body }.
 */
async function verificarCodigo(db, { cnpj, codigo, criarAcesso }) {
  const c = digitos(cnpj);
  const cod = digitos(codigo);
  if (c.length !== 14 || cod.length !== 6) return { status: 400, body: { error: "Digite o CNPJ e o código de 6 números." } };
  const empresa = await empresaPorCnpj(db, c);
  if (!empresa) return { status: 400, body: { error: "Código inválido ou vencido. Peça um novo." } };

  const { rows } = await db.query(
    `SELECT id, codigo_hash, tentativas FROM recalculo_codigos
      WHERE company_id = $1 AND usado_em IS NULL AND cancelado_em IS NULL AND expira_em > now()
      ORDER BY criado_em DESC LIMIT 1`,
    [empresa.id]
  );
  const r = rows[0];
  if (!r) return { status: 400, body: { error: "Código inválido ou vencido. Peça um novo." } };

  if (!confere(cod, r.codigo_hash)) {
    const tentativas = r.tentativas + 1;
    const restam = MAX_ERROS - tentativas;
    await db.query(
      `UPDATE recalculo_codigos SET tentativas = $2, cancelado_em = CASE WHEN $2 >= $3 THEN now() ELSE NULL END WHERE id = $1`,
      [r.id, tentativas, MAX_ERROS]
    );
    if (restam <= 0) return { status: 400, body: { error: "Código errado muitas vezes. Peça um novo código.", restam: 0 } };
    return { status: 400, body: { error: `Código errado. Você ainda tem ${restam} tentativa${restam > 1 ? "s" : ""}.`, restam } };
  }

  // Marca como usado ANTES de abrir o acesso (duas abas com o mesmo código: só uma entra).
  const { rowCount } = await db.query(
    `UPDATE recalculo_codigos SET usado_em = now() WHERE id = $1 AND usado_em IS NULL AND cancelado_em IS NULL`,
    [r.id]
  );
  if (!rowCount) return { status: 400, body: { error: "Código já usado. Peça um novo." } };
  const acesso = await criarAcesso(empresa.id);
  await db.query(`UPDATE recalculo_codigos SET acesso_link_id = $2 WHERE id = $1`, [r.id, acesso.id]);
  return { status: 200, body: { ok: true, token: acesso.token, minutos: MINUTOS_ACESSO } };
}

module.exports = {
  MINUTOS_CODIGO,
  MINUTOS_ACESSO,
  MAX_ERROS,
  ESPERA_REENVIO_SEG,
  MAX_CODIGOS_HORA,
  digitos,
  primeiroEmail,
  gerarCodigo,
  hashCodigo,
  confere,
  textoEmail,
  pedirCodigo,
  verificarCodigo,
};
