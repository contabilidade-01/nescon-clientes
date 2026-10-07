const fs = require("fs");
const path = require("path");
const express = require("express");
const db = require("../db");
const { authMiddleware, requireCompanyUser } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID } = require("../middleware/validate");
const { uploadAny, resolveUploadPath, removeUploadFile } = require("../uploads");
const { itensAtrasados, sanitizarBlocos, sanitizarRegras } = require("../onboardingRegras");
const { getBoolSetting, setSetting } = require("../appSettings");
const { conversarModelo, lerConhecimento, CONHECIMENTO_PADRAO, CHAVE_CONHECIMENTO, LIMITE_CONHECIMENTO } = require("../onboardingIa");
const { enviarLembretes, CHAVE_LEMBRETES } = require("../onboardingLembretes");
const { obterChaveApi } = require("../iaProvider");
const { hojeSP } = require("../diasBancarios");
const {
  linkDoOnboarding,
  registrarEvento,
  enviarBoasVindas,
  statusPorItem,
  recalcularStatus,
  criarOnboarding,
} = require("../onboardingServico");
const { propostaParaDadosContrato, mesclarParcial } = require("../propostaParaDados");

/** Extensões aceitas no envio do cliente. Lista fechada: nada executável ou de script. */
const EXTENSOES = new Set(["pdf", "jpg", "jpeg", "png", "xml", "ofx", "xlsx", "xls", "csv", "doc", "docx", "zip", "pfx", "p12", "txt"]);

const TOKEN_RE = /^[a-f0-9]{48}$/;

const rateHits = new Map();
function rateLimitPublic(req, res, next) {
  const ip = (req.ip || req.headers["x-forwarded-for"] || "unknown").toString().split(",")[0].trim();
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const rec = rateHits.get(ip);
  if (!rec || now - rec.start > windowMs) {
    rateHits.set(ip, { start: now, n: 1 });
    return next();
  }
  rec.n += 1;
  if (rec.n > 60) return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
  next();
}

function extensaoOk(nome) {
  const m = /\.([a-z0-9]+)$/i.exec(String(nome || ""));
  return Boolean(m && EXTENSOES.has(m[1].toLowerCase()));
}

/** O que o cliente vê de um onboarding: itens + situação do envio de cada um. Sem dados internos. */
async function visaoDoCliente(onb) {
  const { rows: arqs } = await db.query(
    `SELECT DISTINCT ON (item_id) item_id, status, observacao, file_name, created_at
       FROM onboarding_arquivos WHERE onboarding_id = $1
      ORDER BY item_id, created_at DESC`,
    [onb.id]
  );
  const porItem = Object.fromEntries(arqs.map((a) => [a.item_id, a]));
  const itens = (onb.itens || []).map((i) => {
    const a = porItem[i.id];
    return a ? { ...i, envio: { status: a.status, observacao: a.observacao, arquivo: a.file_name, em: a.created_at } } : i;
  });
  const docs = itens.filter((i) => i.tipo === "documento" && i.obrigatorio);
  const prontos = docs.filter((i) => i.envio && (i.envio.status === "enviado" || i.envio.status === "aprovado")).length;
  return {
    cliente_nome: onb.cliente_nome,
    status: onb.status,
    itens,
    progresso: { enviados: prontos, total: docs.length },
  };
}

// ---------------------------------------------------------------------------
// Público — link com token (sem login), como a ficha de admissão
// ---------------------------------------------------------------------------
const publicRouter = express.Router();

async function porToken(req, res) {
  const token = String(req.params.token || "");
  if (!TOKEN_RE.test(token)) {
    res.status(404).json({ error: "Link inválido" });
    return null;
  }
  const { rows } = await db.query(`SELECT * FROM onboardings WHERE token_publico = $1`, [token]);
  if (!rows.length) {
    res.status(404).json({ error: "Link inválido" });
    return null;
  }
  return rows[0];
}

publicRouter.get("/:token", rateLimitPublic, async (req, res) => {
  try {
    const onb = await porToken(req, res);
    if (!onb) return;
    res.json(await visaoDoCliente(onb));
  } catch (err) {
    console.error("[onboarding] público", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Grava os arquivos enviados para um item e devolve a visão atualizada do cliente. Usado pelo
 * link público e pelo portal logado: as duas portas fazem exatamente a mesma coisa.
 */
async function receberEnvio(req, res, onb) {
  const arquivos = req.files || [];
  const descartar = () => arquivos.forEach((f) => removeUploadFile(f.filename));
  try {
    const item = (onb.itens || []).find((i) => i.id === req.params.itemId);
    if (!item || item.tipo !== "documento") {
      descartar();
      return res.status(404).json({ error: "Item não encontrado" });
    }
    if (!arquivos.length) return res.status(400).json({ error: "Nenhum arquivo enviado" });
    const ruim = arquivos.find((f) => !extensaoOk(f.originalname));
    if (ruim) {
      descartar();
      return res.status(400).json({ error: `Tipo de arquivo não aceito: ${ruim.originalname}` });
    }
    // Item já aprovado não recebe mais envio: o escritório já conferiu.
    const atual = (await statusPorItem(db, onb.id))[item.id];
    if (atual === "aprovado") {
      descartar();
      return res.status(409).json({ error: "Este documento já foi aprovado." });
    }
    for (const f of arquivos) {
      await db.query(
        `INSERT INTO onboarding_arquivos (onboarding_id, item_id, file_path, file_name) VALUES ($1, $2, $3, $4)`,
        [onb.id, item.id, f.filename, f.originalname]
      );
      await registrarEvento(db, onb.id, "arquivo_enviado", `${item.titulo}: ${f.originalname}`);
    }
    await recalcularStatus(db, onb.id);
    const atualizado = (await db.query(`SELECT * FROM onboardings WHERE id = $1`, [onb.id])).rows[0];
    res.status(201).json(await visaoDoCliente(atualizado));
  } catch (err) {
    descartar();
    console.error("[onboarding] upload", err);
    res.status(500).json({ error: "Erro interno" });
  }
}

publicRouter.post("/:token/itens/:itemId/arquivos", rateLimitPublic, uploadAny.any(), async (req, res) => {
  try {
    const onb = await porToken(req, res);
    if (!onb) return (req.files || []).forEach((f) => removeUploadFile(f.filename));
    await receberEnvio(req, res, onb);
  } catch (err) {
    (req.files || []).forEach((f) => removeUploadFile(f.filename));
    console.error("[onboarding] upload", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ---------------------------------------------------------------------------
// Portal logado — o cliente que já entrou vê os mesmos passos, sem precisar do link do e-mail
// ---------------------------------------------------------------------------
const portalRouter = express.Router();
portalRouter.use(authMiddleware);
portalRouter.use(requireCompanyUser);

/** O onboarding da empresa logada: o que ainda está em andamento primeiro, senão o mais recente. */
async function onboardingDaEmpresa(companyId) {
  const { rows } = await db.query(
    `SELECT * FROM onboardings WHERE company_id = $1
      ORDER BY (status <> 'concluido') DESC, created_at DESC LIMIT 1`,
    [companyId]
  );
  return rows[0] || null;
}

portalRouter.get("/", async (req, res) => {
  try {
    const onb = await onboardingDaEmpresa(req.company.id);
    res.json({ onboarding: onb ? await visaoDoCliente(onb) : null });
  } catch (err) {
    console.error("[onboarding] portal", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

portalRouter.post("/itens/:itemId/arquivos", uploadAny.any(), async (req, res) => {
  try {
    const onb = await onboardingDaEmpresa(req.company.id);
    if (!onb) {
      (req.files || []).forEach((f) => removeUploadFile(f.filename));
      return res.status(404).json({ error: "Nenhum onboarding para a sua empresa" });
    }
    await receberEnvio(req, res, onb);
  } catch (err) {
    (req.files || []).forEach((f) => removeUploadFile(f.filename));
    console.error("[onboarding] portal upload", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
const adminRouter = express.Router();
adminRouter.use(authMiddleware);
adminRouter.use(requireArea("empresas"));
adminRouter.use(express.json({ limit: "2mb" }));

function resumo(r, extra = {}) {
  const docs = (r.itens || []).filter((i) => i.tipo === "documento" && i.obrigatorio);
  return {
    id: r.id,
    contrato_id: r.contrato_id,
    proposta_id: r.proposta_id,
    origem: r.origem,
    company_id: r.company_id,
    company_name: r.company_name || null,
    cliente_nome: r.cliente_nome,
    cliente_email: r.cliente_email,
    status: r.status,
    assinado_em: r.assinado_em,
    inicio_em: r.inicio_em,
    enviado_em: r.enviado_em,
    concluido_em: r.concluido_em,
    link: linkDoOnboarding(r.token_publico),
    docs_total: docs.length,
    ...extra,
  };
}

adminRouter.get("/", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT o.*, e.name AS company_name
         FROM onboardings o LEFT JOIN companies e ON e.id = o.company_id
        ORDER BY o.updated_at DESC`
    );
    const hoje = hojeSP();
    const out = [];
    for (const r of rows) {
      const st = await statusPorItem(db, r.id);
      const docs = (r.itens || []).filter((i) => i.tipo === "documento" && i.obrigatorio);
      out.push(
        resumo(r, {
          docs_enviados: docs.filter((i) => st[i.id] === "enviado" || st[i.id] === "aprovado").length,
          docs_aprovados: docs.filter((i) => st[i.id] === "aprovado").length,
          atrasados: itensAtrasados(r.itens, st, hoje).length,
        })
      );
    }
    res.json(out);
  } catch (err) {
    console.error("[onboarding] lista", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * POST / — cria um onboarding à mão, sem esperar o fluxo. A origem decide de onde vem o
 * cadastro (o mesmo `contratos.dados` que as regras leem):
 *   contrato_id  → contrato escolhido, assinado ou não (o automático continua no webhook)
 *   proposta_id  → cliente da proposta que ainda não virou contrato
 *   company_id   → empresa já no portal (usa o cadastro prévio dos contratos, se houver)
 *   (nada)       → só `dados` informados na tela
 * `dados` sempre pode sobrescrever campos, exceto quando a fonte é um contrato.
 * `modelo_id` força um modelo; sem ele, o de regras mais específicas vence.
 */
adminRouter.post("/", async (req, res) => {
  try {
    const b = req.body || {};
    for (const campo of ["contrato_id", "proposta_id", "company_id", "modelo_id"]) {
      if (b[campo] && !validateUUID(String(b[campo]))) return res.status(400).json({ error: `${campo} inválido` });
    }
    const extra = b.dados && typeof b.dados === "object" && !Array.isArray(b.dados) ? b.dados : {};
    const opcoes = { modeloId: b.modelo_id || null, enviar: b.enviar !== false };
    let resultado;

    if (b.contrato_id) {
      const { rows } = await db.query(`SELECT * FROM contratos WHERE id = $1`, [b.contrato_id]);
      if (!rows.length) return res.status(404).json({ error: "Contrato não encontrado" });
      if (rows[0].tipo === "aditivo") return res.status(400).json({ error: "Aditivo não gera onboarding" });
      resultado = await criarOnboarding(db, { ...opcoes, contrato: rows[0], origem: "contrato_manual" });
    } else if (b.proposta_id) {
      const { rows } = await db.query(`SELECT id, company_id, dados, total_mensal FROM propostas WHERE id = $1`, [b.proposta_id]);
      if (!rows.length) return res.status(404).json({ error: "Proposta não encontrada" });
      const dados = mesclarParcial(propostaParaDadosContrato(rows[0].dados, rows[0].total_mensal), extra);
      resultado = await criarOnboarding(db, {
        ...opcoes,
        dados,
        propostaId: rows[0].id,
        companyId: b.company_id || rows[0].company_id,
        origem: "proposta",
      });
    } else if (b.company_id) {
      const emp = await db.query(`SELECT name, contact_email, cnpj FROM companies WHERE id = $1`, [b.company_id]);
      if (!emp.rows.length) return res.status(404).json({ error: "Empresa não encontrada" });
      const cad = await db.query(`SELECT dados FROM contrato_cadastros WHERE company_id = $1`, [b.company_id]);
      const base = mesclarParcial(
        { contratante: { razao: emp.rows[0].name, email: emp.rows[0].contact_email || "", cnpj: emp.rows[0].cnpj || "" } },
        cad.rows[0]?.dados || {}
      );
      resultado = await criarOnboarding(db, { ...opcoes, dados: mesclarParcial(base, extra), companyId: b.company_id, origem: "empresa" });
    } else {
      if (!String(extra.contratante?.razao || "").trim()) return res.status(400).json({ error: "Informe o nome do cliente" });
      resultado = await criarOnboarding(db, { ...opcoes, dados: extra, origem: "manual" });
    }

    if (!resultado) return res.status(409).json({ error: "Nenhum modelo de onboarding se aplica. Crie ou ative um modelo." });
    res.status(resultado.criado ? 201 : 200).json({ id: resultado.onboarding.id, criado: resultado.criado });
  } catch (err) {
    console.error("[onboarding] criar", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/modelos", async (_req, res) => {
  const { rows } = await db.query(`SELECT * FROM onboarding_modelos ORDER BY ordem, created_at`);
  res.json(rows);
});

function validarModelo(b) {
  const nome = String(b?.nome || "").trim();
  if (!nome) return { erro: "Informe o nome do modelo" };
  if (!Array.isArray(b.blocos) || b.blocos.length > 80) return { erro: "Blocos inválidos" };
  const { blocos, descartados } = sanitizarBlocos(b.blocos);
  if (descartados) return { erro: "Há bloco de tipo desconhecido" };
  return {
    nome: nome.slice(0, 120),
    descricao: String(b.descricao || "").slice(0, 500),
    regras: sanitizarRegras(b.regras),
    blocos,
    ativo: b.ativo !== false,
  };
}

adminRouter.post("/modelos", async (req, res) => {
  const v = validarModelo(req.body);
  if (v.erro) return res.status(400).json({ error: v.erro });
  const { rows } = await db.query(
    `INSERT INTO onboarding_modelos (nome, descricao, regras, blocos, ativo, ordem)
     VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(ordem), 0) + 1 FROM onboarding_modelos)) RETURNING *`,
    [v.nome, v.descricao, JSON.stringify(v.regras), JSON.stringify(v.blocos), v.ativo]
  );
  res.status(201).json(rows[0]);
});

adminRouter.put("/modelos/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  const v = validarModelo(req.body);
  if (v.erro) return res.status(400).json({ error: v.erro });
  const { rows } = await db.query(
    `UPDATE onboarding_modelos SET nome = $2, descricao = $3, regras = $4, blocos = $5, ativo = $6, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [req.params.id, v.nome, v.descricao, JSON.stringify(v.regras), JSON.stringify(v.blocos), v.ativo]
  );
  if (!rows.length) return res.status(404).json({ error: "Modelo não encontrado" });
  res.json(rows[0]);
});

adminRouter.delete("/modelos/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  await db.query(`DELETE FROM onboarding_modelos WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// --- Agente de IA: entrevista e monta o modelo -----------------------------------------
adminRouter.get("/ia/config", async (_req, res) => {
  try {
    res.json({
      ia: Boolean(await obterChaveApi("claude", db)),
      conhecimento: await lerConhecimento(db),
      conhecimento_padrao: CONHECIMENTO_PADRAO,
      limite: LIMITE_CONHECIMENTO,
    });
  } catch (err) {
    console.error("[onboarding] ia config", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.put("/ia/conhecimento", async (req, res) => {
  try {
    const texto = req.body?.conhecimento;
    if (typeof texto !== "string") return res.status(400).json({ error: "Informe o texto da base de conhecimento" });
    if (texto.length > LIMITE_CONHECIMENTO) {
      return res.status(413).json({ error: `Base grande demais (máximo ${LIMITE_CONHECIMENTO} caracteres)` });
    }
    await setSetting(db, CHAVE_CONHECIMENTO, texto);
    res.json({ conhecimento: texto });
  } catch (err) {
    console.error("[onboarding] ia conhecimento", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.post("/ia/assistente", async (req, res) => {
  try {
    const { mensagens, modelo } = req.body || {};
    if (JSON.stringify(modelo || {}).length > 60_000) return res.status(413).json({ error: "Modelo grande demais para o agente" });
    res.json(await conversarModelo(db, { mensagens, modelo }));
  } catch (err) {
    if (!err.status) console.error("[onboarding] ia assistente", err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Erro interno" });
  }
});

// --- Lembretes automáticos de prazo -------------------------------------------------------
adminRouter.get("/lembretes", async (_req, res) => {
  try {
    res.json({ ativo: await getBoolSetting(db, CHAVE_LEMBRETES, false) });
  } catch (err) {
    console.error("[onboarding] lembretes", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.put("/lembretes", async (req, res) => {
  try {
    await setSetting(db, CHAVE_LEMBRETES, req.body?.ativo ? "true" : "false");
    res.json({ ativo: Boolean(req.body?.ativo) });
  } catch (err) {
    console.error("[onboarding] lembretes", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Roda agora. `simular: true` só lista o que sairia, sem mandar nem marcar como enviado. */
adminRouter.post("/lembretes/executar", async (req, res) => {
  try {
    res.json(await enviarLembretes(db, { simular: Boolean(req.body?.simular) }));
  } catch (err) {
    console.error("[onboarding] lembretes executar", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query(
      `SELECT o.*, e.name AS company_name FROM onboardings o LEFT JOIN companies e ON e.id = o.company_id WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Onboarding não encontrado" });
    const [arqs, evs] = await Promise.all([
      db.query(
        `SELECT id, item_id, file_name, status, observacao, created_at
           FROM onboarding_arquivos WHERE onboarding_id = $1 ORDER BY created_at DESC`,
        [req.params.id]
      ),
      db.query(`SELECT tipo, detalhe, created_at FROM onboarding_eventos WHERE onboarding_id = $1 ORDER BY created_at DESC LIMIT 50`, [
        req.params.id,
      ]),
    ]);
    res.json({ ...resumo(rows[0]), itens: rows[0].itens, arquivos: arqs.rows, eventos: evs.rows });
  } catch (err) {
    console.error("[onboarding] detalhe", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.post("/:id/reenviar", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query(`SELECT * FROM onboardings WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Onboarding não encontrado" });
    const enviado = await enviarBoasVindas(db, rows[0]);
    res.json({ enviado, link: linkDoOnboarding(rows[0].token_publico) });
  } catch (err) {
    console.error("[onboarding] reenviar", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Aprovar ou reprovar um envio do cliente. Reprovar exige motivo: o cliente lê isso. */
adminRouter.patch("/arquivos/:arquivoId", async (req, res) => {
  try {
    if (!validateUUID(req.params.arquivoId)) return res.status(400).json({ error: "ID inválido" });
    const status = req.body?.status;
    const observacao = String(req.body?.observacao || "").trim().slice(0, 500);
    if (!["aprovado", "reprovado"].includes(status)) return res.status(400).json({ error: "Status inválido" });
    if (status === "reprovado" && !observacao) return res.status(400).json({ error: "Explique ao cliente o que precisa corrigir" });
    const { rows } = await db.query(
      `UPDATE onboarding_arquivos SET status = $2, observacao = $3, updated_at = now() WHERE id = $1 RETURNING onboarding_id, item_id, file_name`,
      [req.params.arquivoId, status, observacao]
    );
    if (!rows.length) return res.status(404).json({ error: "Arquivo não encontrado" });
    await registrarEvento(db, rows[0].onboarding_id, `arquivo_${status}`, `${rows[0].file_name}${observacao ? ` — ${observacao}` : ""}`);
    res.json({ status: await recalcularStatus(db, rows[0].onboarding_id) });
  } catch (err) {
    console.error("[onboarding] revisar", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/arquivos/:arquivoId/file", async (req, res) => {
  try {
    if (!validateUUID(req.params.arquivoId)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query(`SELECT file_path, file_name FROM onboarding_arquivos WHERE id = $1`, [req.params.arquivoId]);
    if (!rows.length) return res.status(404).json({ error: "Arquivo não encontrado" });
    const full = resolveUploadPath(rows[0].file_path);
    if (!full || !fs.existsSync(full)) return res.status(404).json({ error: "Arquivo ausente" });
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(rows[0].file_name || "arquivo").replace(/"/g, "")}"`);
    res.sendFile(full);
  } catch (err) {
    console.error("[onboarding] download", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = { adminRouter, publicRouter, portalRouter };
