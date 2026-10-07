/**
 * Onboarding: criação a partir do contrato assinado e recálculo do status.
 * A regra (qual modelo, que datas) fica em onboardingRegras.js; aqui só há banco e e-mail.
 */
const crypto = require("crypto");
const { escolherModelo, resolverItens, calcularStatus } = require("./onboardingRegras");
const { hojeSP } = require("./diasBancarios");
const { getPublicAppUrl } = require("./mailer");
const { enviarEmailContrato } = require("./contratosMail");

function linkDoOnboarding(token) {
  const base = getPublicAppUrl();
  return base ? `${String(base).replace(/\/+$/, "")}/onboarding/${token}` : null;
}

async function registrarEvento(db, onboardingId, tipo, detalhe = "") {
  await db.query(`INSERT INTO onboarding_eventos (onboarding_id, tipo, detalhe) VALUES ($1, $2, $3)`, [
    onboardingId,
    tipo,
    String(detalhe).slice(0, 500),
  ]);
}

/** E-mail de boas-vindas com o link. Devolve true se saiu (SMTP configurado e destino válido). */
async function enviarBoasVindas(db, onb) {
  const link = linkDoOnboarding(onb.token_publico);
  const abertos = (onb.itens || []).filter((i) => i.tipo === "documento" && i.obrigatorio).length;
  const enviado = await enviarEmailContrato({
    para: [onb.cliente_email],
    assunto: "Bem-vindo à Nescon — seus primeiros passos",
    linhas: [
      `Olá${onb.cliente_nome ? `, ${onb.cliente_nome}` : ""}!`,
      "Obrigado por escolher a Nescon Contabilidade. Preparamos um roteiro com o que enviar, até quando e por onde.",
      abertos ? `São ${abertos} documento(s) obrigatório(s), cada um com seu prazo.` : "",
      "Você acompanha tudo e envia os arquivos pelo link abaixo.",
      "Nescon Contabilidade",
    ].filter(Boolean),
    link: link ? { texto: "Abrir meus primeiros passos", url: link } : null,
  }).catch((err) => {
    console.error("[onboarding] e-mail de boas-vindas falhou:", err.message);
    return false;
  });
  if (enviado) {
    await db.query(`UPDATE onboardings SET enviado_em = now(), updated_at = now() WHERE id = $1`, [onb.id]);
    await registrarEvento(db, onb.id, "email_enviado", onb.cliente_email);
  }
  return enviado;
}

/**
 * Cria um onboarding. Três caminhos, o mesmo resultado:
 *   - contrato assinado (automático, pelo webhook) ou contrato escolhido à mão;
 *   - proposta (cliente que ainda não tem contrato);
 *   - empresa/manual (sem proposta nem contrato).
 * `dados` é sempre no formato de `contratos.dados` (parcial vale): é o cadastro único que
 * as regras leem. Com `contrato`, ele é a fonte; senão vem de `dados`.
 *
 * Idempotente por contrato (UNIQUE em contrato_id): o webhook do ZapSign e o botão
 * "Atualizar status" podem chamar de novo sem duplicar nem reenviar e-mail.
 * Devolve { onboarding, criado } ou null se nenhum modelo serve.
 */
async function criarOnboarding(db, { contrato = null, propostaId = null, companyId = null, dados = {}, modeloId = null, origem, enviar = true }) {
  if (contrato) {
    if (contrato.tipo === "aditivo") return null;
    const existente = await db.query(`SELECT * FROM onboardings WHERE contrato_id = $1`, [contrato.id]);
    if (existente.rows.length) return { onboarding: existente.rows[0], criado: false };
  }

  const fonte = contrato ? contrato.dados || {} : dados || {};
  const { rows: modelos } = await db.query(`SELECT * FROM onboarding_modelos WHERE ativo ORDER BY ordem, created_at`);
  const modelo = modeloId ? modelos.find((m) => m.id === modeloId) : escolherModelo(fonte, modelos);
  if (!modelo) {
    console.warn(`[onboarding] nenhum modelo serve (${origem})`);
    return null;
  }
  const assinatura = hojeSP();
  const itens = resolverItens(modelo, fonte, assinatura);
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(fonte.vigencia?.dataInicio || "") ? fonte.vigencia.dataInicio : null;
  const token = crypto.randomBytes(24).toString("hex");

  const { rows } = await db.query(
    `INSERT INTO onboardings
       (contrato_id, proposta_id, origem, company_id, modelo_id, cliente_nome, cliente_email, dados_contrato, itens, status, token_publico, assinado_em, inicio_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'aguardando', $10, $11, $12)
     ON CONFLICT (contrato_id) DO NOTHING
     RETURNING *`,
    [
      contrato ? contrato.id : null,
      propostaId || (contrato && contrato.proposta_id) || null,
      origem,
      (contrato ? contrato.company_id : companyId) || null,
      modelo.id,
      String(fonte.contratante?.razao || "").slice(0, 200),
      String(fonte.contratante?.email || "").slice(0, 200),
      JSON.stringify(fonte),
      JSON.stringify(itens),
      token,
      assinatura,
      inicio,
    ]
  );
  // Outra chamada ganhou a corrida: devolve o que ela criou, sem reenviar nada.
  if (!rows.length) {
    const de = await db.query(`SELECT * FROM onboardings WHERE contrato_id = $1`, [contrato.id]);
    return { onboarding: de.rows[0], criado: false };
  }
  const onb = rows[0];
  await registrarEvento(db, onb.id, "criado", `Origem: ${origem}. Modelo: ${modelo.nome}`);
  if (enviar) await enviarBoasVindas(db, onb);
  return { onboarding: onb, criado: true };
}

/** Atalho do webhook de assinatura. */
function criarOnboardingDoContrato(db, contrato) {
  return criarOnboarding(db, { contrato, origem: "contrato_auto" });
}

/** Último status de arquivo por item: { [itemId]: 'enviado'|'aprovado'|'reprovado' }. */
async function statusPorItem(db, onboardingId) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (item_id) item_id, status
       FROM onboarding_arquivos WHERE onboarding_id = $1
      ORDER BY item_id, created_at DESC`,
    [onboardingId]
  );
  return Object.fromEntries(rows.map((r) => [r.item_id, r.status]));
}

/** Recalcula e grava o status do onboarding a partir dos arquivos. */
async function recalcularStatus(db, onboardingId) {
  const { rows } = await db.query(`SELECT itens, status FROM onboardings WHERE id = $1`, [onboardingId]);
  if (!rows.length) return null;
  const novo = calcularStatus(rows[0].itens, await statusPorItem(db, onboardingId));
  if (novo !== rows[0].status) {
    await db.query(
      `UPDATE onboardings
          SET status = $2, concluido_em = CASE WHEN $2 = 'concluido' THEN now() ELSE NULL END, updated_at = now()
        WHERE id = $1`,
      [onboardingId, novo]
    );
    await registrarEvento(db, onboardingId, "status", novo);
  }
  return novo;
}

module.exports = {
  linkDoOnboarding,
  registrarEvento,
  enviarBoasVindas,
  criarOnboarding,
  criarOnboardingDoContrato,
  statusPorItem,
  recalcularStatus,
};
