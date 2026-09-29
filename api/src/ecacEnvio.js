/**
 * Envio das mensagens da cobrança do e-CAC — e-mail e WhatsApp — pelo PRÓPRIO PORTAL.
 *
 * WhatsApp sai pela mesma composição de `docNotify.js`: número por `whatsappSql`
 * (whatsapp manual → telefone do cadastro → espelho G-Click), lista de permitidos dentro
 * do `uazapi.enviarTexto`, teto por hora, "não mandar para o próprio número", retry e
 * JANELA DIURNA. Nada é enviado de fora do portal (ver o aviso em routes/fiscalIngest.js).
 *
 * E-mail sai pelo `mailer.createTransport` (nodemailer), com o mesmo respeito à janela:
 * e-mail de madrugada também parece robô.
 *
 * Cada mensagem vira UMA linha em `ecac_notificacoes` ANTES de sair (idempotente por
 * cobrança × etapa × canal). Falhou? Fica `pendente` com backoff e `drenarPendentes`
 * tenta de novo no próximo ciclo, até 5 vezes; depois vira `falhou` e o escritório vê.
 *
 * MODO TESTE (padrão): tudo vai para o e-mail/WhatsApp do escritório com o nome da
 * empresa no assunto. É assim que se confere o texto antes de liberar para cliente.
 */
const crypto = require("node:crypto");
const uazapi = require("./uazapi");
const numeroWpp = require("./whatsappNumero");
const { whatsappSql, JOIN_ESPELHO } = require("./alertas");
const { enviarComRetry, sobOTeto, marcarEnviado, calcularBackoff } = require("./alertasEnvio");
const { isSmtpConfigured, createTransport, getPublicAppUrl } = require("./mailer");
const { dentroDaJanela, ehDiaUtil } = require("./janelaEnvio");
const { minutosSP } = require("./diasBancarios");
const { montarMensagem, debitosCobraveis } = require("./ecacRegras");

const MAX_TENTATIVAS = 5;

function token() {
  return crypto.randomBytes(16).toString("hex");
}

function linkRastreado(tok) {
  const base = getPublicAppUrl();
  return base ? `${base}/api/ecac/r/${tok}` : null;
}

function pixelUrl(tok) {
  const base = getPublicAppUrl();
  return base ? `${base}/api/ecac/abriu/${tok}.gif` : null;
}

function podeEnviarAgora() {
  return dentroDaJanela(minutosSP()) && ehDiaUtil();
}

/** Empresa + número de WhatsApp + e-mail, com os flags que barram envio. */
async function carregarEmpresa(db, companyId) {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.cnpj, c.contact_email, c.alertas_ativos, c.avisos_gerais_ativos,
            c.ecac_cobranca_ativa, c.arquivada, c.excluida, ${whatsappSql("c")} AS whatsapp
       FROM companies c ${JOIN_ESPELHO}
      WHERE c.id = $1`,
    [companyId]
  );
  return rows[0] || null;
}

/** Por que esta empresa NÃO pode receber cobrança agora (null = pode). */
function motivoBloqueio(empresa) {
  if (!empresa) return "empresa não encontrada";
  if (empresa.arquivada || empresa.excluida) return "empresa arquivada/excluída";
  if (empresa.alertas_ativos === false) return "alertas desligados para a empresa (chave geral)";
  if (empresa.avisos_gerais_ativos === false) return "avisos gerais desligados para a empresa";
  if (empresa.ecac_cobranca_ativa === false) return "cobrança do e-CAC pausada para a empresa";
  return null;
}

function idDaResposta(r) {
  if (!r || typeof r !== "object") return null;
  return (
    r.id || r.messageid || r.messageId || r.key?.id || r.message?.id || r.data?.id || null
  );
}

async function enviarEmail({ to, subject, text, html }) {
  if (!isSmtpConfigured()) throw new Error("SMTP não configurado");
  const transport = createTransport();
  return transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text, html });
}

async function enviarWhatsapp({ numero, texto }) {
  if (!uazapi.configurado()) throw new Error("uazapi não configurada");
  const v = numeroWpp.validar(numero);
  if (!v.ok) throw new Error(v.motivo);
  const meu = await uazapi.owner().catch(() => null);
  if (meu && v.numero === meu) throw new Error("é o próprio número da instância");
  if (!sobOTeto()) throw new Error("teto de envios por hora atingido");
  const r = await enviarComRetry({ numero: v.numero, texto });
  marcarEnviado();
  return { numero: v.numero, mensagemId: idDaResposta(r) };
}

/**
 * Monta e registra as mensagens de uma etapa; tenta enviar na hora se a janela permite.
 * `ctx`: { db, cobranca, empresa, pendencia, etapa, canais, cfg }
 * Devolve [{ canal, status, motivo }].
 */
async function registrarEEnviar({ db, cobranca, empresa, pendencia, etapa, canais, cfg }) {
  const resultados = [];
  const bloqueio = motivoBloqueio(empresa);
  const debitos = debitosCobraveis(pendencia?.debitos || []);

  for (const canal of canais) {
    const tok = token();
    const modoTeste = Boolean(cfg.modo_teste);
    const mensagem = montarMensagem({
      etapa,
      empresa,
      debitos,
      relatorio_data: pendencia?.relatorio_data,
      parcelamento: pendencia?.parcelamento,
      pgfn: pendencia?.pgfn,
      link: linkRastreado(tok),
      pixel: canal === "email" ? pixelUrl(tok) : null,
      escritorio: { nome: cfg.escritorio_nome, whatsapp: cfg.escritorio_whatsapp, email: cfg.escritorio_email },
    });

    const corpo = canal === "email" ? mensagem.texto : mensagem.whatsapp;
    if (!corpo) {
      resultados.push({ canal, status: "ignorado", motivo: "etapa sem texto para este canal" });
      continue;
    }

    let destino = canal === "email" ? (empresa.contact_email || "").trim() : empresa.whatsapp;
    if (modoTeste) destino = canal === "email" ? cfg.escritorio_email : cfg.escritorio_whatsapp;
    const assunto = mensagem.assunto ? (modoTeste ? `[TESTE ${empresa.name}] ${mensagem.assunto}` : mensagem.assunto) : null;
    const texto = modoTeste && canal === "whatsapp" ? `[TESTE — iria para ${empresa.name}]\n${corpo}` : corpo;

    const { rows } = await db.query(
      `INSERT INTO ecac_notificacoes
         (cobranca_id, company_id, etapa, canal, destino, token, status, erro, assunto, texto, modo_teste)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendente', NULL, $7, $8, $9)
       ON CONFLICT (cobranca_id, etapa, canal) DO NOTHING
       RETURNING id`,
      [cobranca.id, empresa.id, etapa, canal, destino || null, tok, assunto, texto, modoTeste]
    );
    if (!rows.length) {
      resultados.push({ canal, status: "duplicado", motivo: "já registrada para esta etapa" });
      continue;
    }
    const notificacaoId = rows[0].id;

    if (bloqueio && !modoTeste) {
      await fechar(db, notificacaoId, "ignorado", bloqueio);
      resultados.push({ canal, status: "ignorado", motivo: bloqueio });
      continue;
    }
    if (!destino) {
      const motivo = modoTeste
        ? `modo teste sem ${canal === "email" ? "e-mail" : "WhatsApp"} do escritório configurado`
        : canal === "email" ? "empresa sem e-mail de contato" : "empresa sem WhatsApp válido";
      await fechar(db, notificacaoId, "falhou", motivo);
      resultados.push({ canal, status: "falhou", motivo });
      continue;
    }
    if (!podeEnviarAgora()) {
      await db.query(
        `UPDATE ecac_notificacoes SET proxima_tentativa_em = now(), erro = 'fora da janela — aguardando' WHERE id = $1`,
        [notificacaoId]
      );
      resultados.push({ canal, status: "pendente", motivo: "fora da janela diurna/dia útil" });
      continue;
    }

    const r = await tentar(db, { id: notificacaoId, canal, destino, assunto, texto, html: canal === "email" ? mensagem.html : null, tentativas: 0 });
    resultados.push({ canal, ...r });
  }
  return resultados;
}

async function fechar(db, id, status, erro) {
  await db.query(
    `UPDATE ecac_notificacoes SET status = $2, erro = $3, enviado_em = CASE WHEN $2 = 'enviado' THEN now() ELSE enviado_em END WHERE id = $1`,
    [id, status, erro ?? null]
  );
}

/** Uma tentativa de entrega; atualiza a linha. Devolve { status, motivo }. */
async function tentar(db, n) {
  try {
    if (n.canal === "email") {
      const html = n.html || (await htmlDaNotificacao(db, n.id));
      await enviarEmail({ to: n.destino, subject: n.assunto || "Aviso da contabilidade", text: n.texto, html });
      await db.query(
        `UPDATE ecac_notificacoes SET status = 'enviado', enviado_em = now(), erro = NULL, tentativas = tentativas + 1 WHERE id = $1`,
        [n.id]
      );
      return { status: "enviado" };
    }
    const r = await enviarWhatsapp({ numero: n.destino, texto: n.texto });
    await db.query(
      `UPDATE ecac_notificacoes
          SET status = 'enviado', enviado_em = now(), erro = NULL, tentativas = tentativas + 1,
              destino = $2, mensagem_id = $3, status_entrega = 'enviado', status_entrega_em = now()
        WHERE id = $1`,
      [n.id, r.numero, r.mensagemId ? String(r.mensagemId).slice(0, 120) : null]
    );
    return { status: "enviado" };
  } catch (err) {
    const tentativas = Number(n.tentativas || 0) + 1;
    const definitivo =
      err instanceof uazapi.UazapiDestinoNaoPermitido ||
      /sem e-mail|WhatsApp em branco|Formato inválido|telefone fixo|próprio número/i.test(err.message);
    const { esgotou, proximaMin } = calcularBackoff(tentativas, MAX_TENTATIVAS);
    if (definitivo || esgotou) {
      await db.query(
        `UPDATE ecac_notificacoes SET status = 'falhou', erro = $2, tentativas = $3 WHERE id = $1`,
        [n.id, String(err.message).slice(0, 500), tentativas]
      );
      return { status: "falhou", motivo: err.message };
    }
    await db.query(
      `UPDATE ecac_notificacoes
          SET status = 'pendente', erro = $2, tentativas = $3,
              proxima_tentativa_em = now() + ($4 || ' minutes')::interval
        WHERE id = $1`,
      [n.id, String(err.message).slice(0, 500), tentativas, String(proximaMin)]
    );
    return { status: "pendente", motivo: err.message };
  }
}

/**
 * O HTML não fica no banco (é grande e derivável): é remontado a partir da cobrança.
 * Quando não dá (empresa sumiu), o e-mail sai só em texto.
 */
async function htmlDaNotificacao(db, notificacaoId) {
  const { rows } = await db.query(
    `SELECT n.etapa, n.token, n.modo_teste, c.id AS company_id, c.name,
            p.debitos, p.relatorio_data, p.parcelamento, p.pgfn
       FROM ecac_notificacoes n
       JOIN ecac_cobrancas cb ON cb.id = n.cobranca_id
       JOIN ecac_pendencias p ON p.id = cb.pendencia_id
       JOIN companies c ON c.id = n.company_id
      WHERE n.id = $1`,
    [notificacaoId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const { lerConfig } = require("./ecacConfig");
  const cfg = await lerConfig(db);
  const m = montarMensagem({
    etapa: r.etapa,
    empresa: { name: r.name },
    debitos: debitosCobraveis(r.debitos || []),
    relatorio_data: r.relatorio_data,
    parcelamento: r.parcelamento,
    pgfn: r.pgfn,
    link: linkRastreado(r.token),
    pixel: pixelUrl(r.token),
    escritorio: { nome: cfg.escritorio_nome, whatsapp: cfg.escritorio_whatsapp, email: cfg.escritorio_email },
  });
  return m.html;
}

/** Reprocessa as pendentes cuja hora chegou. Só dentro da janela. */
async function drenarPendentes(db) {
  if (!podeEnviarAgora()) return { tentadas: 0, enviadas: 0 };
  const { rows } = await db.query(
    `SELECT id, canal, destino, assunto, texto, tentativas
       FROM ecac_notificacoes
      WHERE status = 'pendente' AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em <= now())
      ORDER BY criado_em
      LIMIT 100`
  );
  let enviadas = 0;
  for (const n of rows) {
    if (n.canal === "whatsapp" && !sobOTeto()) break;
    const r = await tentar(db, n);
    if (r.status === "enviado") enviadas += 1;
    if (n.canal === "whatsapp" && /token|desconectada/i.test(r.motivo || "")) break;
  }
  return { tentadas: rows.length, enviadas };
}

/** Recado para o escritório (escalada, falha definitiva). Best-effort. */
async function avisarEscritorio(db, cfg, { assunto, texto }) {
  const saidas = [];
  if (cfg.escritorio_email && isSmtpConfigured()) {
    try {
      await enviarEmail({ to: cfg.escritorio_email, subject: assunto, text: texto, html: `<pre style="font-family:inherit;white-space:pre-wrap">${texto.replace(/</g, "&lt;")}</pre>` });
      saidas.push("email");
    } catch (err) {
      console.error("[ecac] aviso ao escritório (e-mail):", err.message);
    }
  }
  if (cfg.escritorio_whatsapp && uazapi.configurado() && podeEnviarAgora()) {
    try {
      await enviarWhatsapp({ numero: cfg.escritorio_whatsapp, texto: `${assunto}\n${texto}` });
      saidas.push("whatsapp");
    } catch (err) {
      console.error("[ecac] aviso ao escritório (WhatsApp):", err.message);
    }
  }
  return saidas;
}

module.exports = {
  carregarEmpresa,
  motivoBloqueio,
  registrarEEnviar,
  drenarPendentes,
  avisarEscritorio,
  linkRastreado,
  pixelUrl,
  podeEnviarAgora,
  enviarEmail,
  enviarWhatsapp,
};
