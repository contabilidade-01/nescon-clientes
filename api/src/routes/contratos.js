/**
 * Contratos de prestação de serviços (painel, área "empresas").
 *
 * Fluxo: o painel monta o PDF no navegador (jsPDF) e manda em base64 junto com os dados
 * do formulário → gravamos o arquivo no volume de uploads e espelhamos em `deliverables`
 * (o cliente vê em /documentos). "Enviar para assinatura" sobe o PDF na ZapSign, que
 * e-mails/WhatsApps o link a cada signatário. Quando todos assinam, o webhook (ou o
 * botão "Atualizar") baixa o PDF assinado, cria a entrega "Contrato assinado" e manda
 * cópia por e-mail às partes.
 *
 * Dois routers: `adminRouter` (autenticado) e `webhookRouter` (público, protegido por
 * segredo em ZAPSIGN_WEBHOOK_SECRET).
 */
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID } = require("../middleware/validate");
const { UPLOAD_DIR, resolveUploadPath, removeUploadFile } = require("../uploads");
const zapsign = require("../zapsign");
const { enviarEmailContrato } = require("../contratosMail");
const { getSetting, setSetting } = require("../appSettings");
const { obterChaveApi } = require("../iaProvider");
const { conversarContrato } = require("../contratoAssistente");

const CHAVE_PADROES = "contratos_padroes";
const SECOES = ["contratante", "contratada", "objeto", "prazos", "honorarios", "vigencia", "assinatura"];

/** Só seções conhecidas e só objetos: o JSON vem do navegador. */
function limparParcial(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const k of SECOES) {
    const v = raw[k];
    if (v && typeof v === "object" && !Array.isArray(v)) out[k] = v;
  }
  return out;
}
const { isSmtpConfigured, getPublicAppUrl } = require("../mailer");

const STATUS = ["rascunho", "salvo", "enviado", "assinado"];
const MAX_PDF_BYTES = 10 * 1024 * 1024; // limite da ZapSign também é 10 MB

function nomeSeguro(s) {
  return String(s || "contrato")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "contrato";
}

function gravarPdfBase64(base64, baseNome) {
  const limpo = String(base64 || "").replace(/^data:application\/pdf;base64,/, "");
  const buf = Buffer.from(limpo, "base64");
  if (!buf.length || buf.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("PDF inválido");
  }
  if (buf.length > MAX_PDF_BYTES) throw new Error("PDF acima de 10 MB");
  const stored = `${Date.now()}-${nomeSeguro(baseNome)}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
  return { stored, bytes: buf.length };
}

function lerPdf(filePath) {
  const full = filePath ? resolveUploadPath(filePath) : null;
  if (!full || !fs.existsSync(full)) return null;
  return fs.readFileSync(full);
}

async function criarEntrega(client, { companyId, titulo, stored, fileName, docType }) {
  if (!companyId) return null;
  const { rows } = await client.query(
    `INSERT INTO deliverables
       (company_id, category, doc_type, title, file_path, file_name, source, access_token, released_at)
     VALUES ($1, 'outro', $2, $3, $4, $5, 'contrato', $6, now())
     RETURNING id`,
    [companyId, docType, titulo.slice(0, 200), stored, fileName.slice(0, 200), crypto.randomBytes(24).toString("hex")]
  );
  return rows[0].id;
}

function publico(row) {
  if (!row) return null;
  return {
    id: row.id,
    company_id: row.company_id,
    company_name: row.company_name || null,
    titulo: row.titulo,
    tipo: row.tipo || "contrato",
    contrato_pai_id: row.contrato_pai_id || null,
    aditivo_numero: row.aditivo_numero ?? null,
    dados: row.dados,
    status: row.status,
    tem_pdf: Boolean(row.file_path),
    tem_pdf_assinado: Boolean(row.signed_file_path),
    deliverable_id: row.deliverable_id,
    signed_deliverable_id: row.signed_deliverable_id,
    zapsign_token: row.zapsign_token,
    zapsign_signers: row.zapsign_signers || null,
    zapsign_enviado_em: row.zapsign_enviado_em,
    assinado_em: row.assinado_em,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function buscar(id) {
  const { rows } = await db.query(
    `SELECT c.*, e.name AS company_name
       FROM contratos c LEFT JOIN companies e ON e.id = c.company_id
      WHERE c.id = $1`,
    [id]
  );
  return rows[0] || null;
}

function emailsDasPartes(dados) {
  const d = dados || {};
  return [d.contratante?.email, d.contratada?.email].filter(Boolean);
}

/**
 * Documento assinado na ZapSign → baixa o PDF final, grava, espelha no portal e avisa
 * por e-mail. Idempotente: se já está `assinado`, não repete.
 */
async function concluirAssinatura(contrato, detalhe) {
  if (contrato.status === "assinado") return contrato;
  const doc = detalhe || (await zapsign.detalharDocumento(contrato.zapsign_token));
  if (doc.status !== "signed" || !doc.signed_file) {
    return { ...contrato, zapsign_status: doc.status, zapsign_signers: doc.signers || contrato.zapsign_signers };
  }
  const buf = await zapsign.baixarArquivo(doc.signed_file);
  const stored = `${Date.now()}-${nomeSeguro(contrato.titulo)}-assinado.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
  const fileName = `${nomeSeguro(contrato.titulo)}-assinado.pdf`;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const entregaId = await criarEntrega(client, {
      companyId: contrato.company_id,
      titulo: `Contrato assinado — ${contrato.titulo}`,
      stored,
      fileName,
      docType: "contrato_assinado",
    });
    const { rows } = await client.query(
      `UPDATE contratos
          SET status = 'assinado', signed_file_path = $2, signed_file_name = $3,
              signed_deliverable_id = $4, zapsign_signers = $5, assinado_em = now(), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [contrato.id, stored, fileName, entregaId, JSON.stringify(doc.signers || [])]
    );
    await client.query("COMMIT");
    const atualizado = rows[0];

    const portal = getPublicAppUrl();
    enviarEmailContrato({
      para: emailsDasPartes(atualizado.dados),
      assunto: `Contrato assinado — ${atualizado.titulo}`,
      linhas: [
        "Olá,",
        `O contrato "${atualizado.titulo}" foi assinado por todas as partes. Segue em anexo a via assinada.`,
        portal ? "A via também fica disponível no Portal do Cliente, em Documentos." : "",
        "Nescon Contabilidade",
      ].filter(Boolean),
      link: portal ? { texto: "Abrir o Portal do Cliente", url: `${portal}/documentos` } : null,
      anexo: { nome: fileName, conteudo: buf },
    }).catch((err) => console.error("[contratos] e-mail de assinado falhou:", err.message));

    return atualizado;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    removeUploadFile(stored);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
const adminRouter = express.Router();
adminRouter.use(authMiddleware);
adminRouter.use(requireArea("empresas"));
// O PDF vem em base64 no JSON — acima do limite global de 1 MB do index.js.
adminRouter.use(express.json({ limit: "15mb" }));

adminRouter.get("/config", async (_req, res) => {
  const portal = getPublicAppUrl();
  const segredo = (process.env.ZAPSIGN_WEBHOOK_SECRET || "").trim();
  let ia = false;
  try {
    ia = Boolean(await obterChaveApi("claude", db));
  } catch {
    ia = false;
  }
  res.json({
    ia,
    zapsign: zapsign.configurado(),
    sandbox: zapsign.configurado() && zapsign.isSandbox(),
    smtp: isSmtpConfigured(),
    webhook_url: portal && segredo ? `${portal}/api/contratos/zapsign/webhook?token=${segredo}` : null,
    webhook_secret_definido: Boolean(segredo),
  });
});

/**
 * GET /tabela — honorários-padrão cadastrados em Atualização de Honorários, só leitura,
 * para a tela de contratos sugerir o valor. A tabela pode não existir numa instalação
 * que nunca abriu aquela tela: devolve lista vazia em vez de erro.
 */
adminRouter.get("/tabela", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT enquadramento, tipo_empresa, complexidade, valor_a_partir_centavos
         FROM honorario_padroes WHERE ativo IS TRUE`
    );
    res.json({ padroes: rows });
  } catch (err) {
    if (err.code !== "42P01") console.error("[contratos] tabela", err.message);
    res.json({ padroes: [] });
  }
});

/** Padrões do escritório (contratada, regras, faixas) aplicados a todo contrato novo. */
adminRouter.get("/padroes", async (_req, res) => {
  try {
    const raw = await getSetting(db, CHAVE_PADROES);
    let padroes = {};
    try {
      padroes = raw ? limparParcial(JSON.parse(raw)) : {};
    } catch {
      padroes = {};
    }
    res.json({ padroes });
  } catch (err) {
    console.error("[contratos] padroes", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.put("/padroes", async (req, res) => {
  try {
    const padroes = limparParcial(req.body?.padroes);
    await setSetting(db, CHAVE_PADROES, JSON.stringify(padroes));
    res.json({ padroes });
  } catch (err) {
    console.error("[contratos] salvar padroes", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Cadastro prévio por empresa: os dados do contrato (partes, valores, prazos) ficam
 * guardados e entram sozinhos quando a empresa é escolhida num contrato novo.
 */
adminRouter.get("/cadastros", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT e.id AS company_id, e.name AS company_name, e.cnpj, c.dados, c.updated_at
         FROM companies e
         LEFT JOIN contrato_cadastros c ON c.company_id = e.id
        WHERE COALESCE(e.excluida, false) = false AND e.arquivada_em IS NULL
        ORDER BY e.name`
    );
    res.json(
      rows.map((r) => {
        const ct = r.dados?.contratante || {};
        const completo = Boolean(ct.razao && ct.cnpj && ct.endereco && ct.repNome && ct.repCpf);
        return {
          company_id: r.company_id,
          company_name: r.company_name,
          cnpj: r.cnpj,
          tem_cadastro: Boolean(r.dados),
          completo,
          updated_at: r.updated_at,
        };
      })
    );
  } catch (err) {
    console.error("[contratos] cadastros", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/cadastros/:companyId", async (req, res) => {
  if (!validateUUID(req.params.companyId)) return res.status(400).json({ error: "ID inválido" });
  try {
    const { rows } = await db.query(`SELECT dados, updated_at FROM contrato_cadastros WHERE company_id = $1`, [req.params.companyId]);
    res.json({ company_id: req.params.companyId, dados: rows[0]?.dados || null, updated_at: rows[0]?.updated_at || null });
  } catch (err) {
    console.error("[contratos] cadastro", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.put("/cadastros/:companyId", async (req, res) => {
  if (!validateUUID(req.params.companyId)) return res.status(400).json({ error: "ID inválido" });
  try {
    const dados = limparParcial(req.body?.dados);
    const { rows } = await db.query(
      `INSERT INTO contrato_cadastros (company_id, dados) VALUES ($1, $2)
       ON CONFLICT (company_id) DO UPDATE SET dados = EXCLUDED.dados, updated_at = now()
       RETURNING dados, updated_at`,
      [req.params.companyId, JSON.stringify(dados)]
    );
    res.json({ company_id: req.params.companyId, dados: rows[0].dados, updated_at: rows[0].updated_at });
  } catch (err) {
    if (err.code === "23503") return res.status(404).json({ error: "Empresa não encontrada" });
    console.error("[contratos] salvar cadastro", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ---------------------------------------------------------------------------
// Perfis de honorário (predefinições por situação)
// ---------------------------------------------------------------------------
const SECOES_PRESET = ["objeto", "honorarios", "prazos", "vigencia"];
const CRITERIOS = {
  enquadramento: ["mei", "simples", "presumido", "real"],
  tipoEmpresa: ["servico", "comercio", "industria"],
  complexidade: ["baixa", "media", "alta"],
};
const PRESET_COLUNAS = "id, nome, descricao, criterios, dados, ordem, ativo";

function limparPreset(body) {
  const nome = String(body?.nome || "").trim().slice(0, 120);
  if (!nome) return { erro: "Informe o nome do perfil" };
  const criterios = {};
  for (const [k, validos] of Object.entries(CRITERIOS)) {
    const v = body?.criterios?.[k];
    if (typeof v === "string" && validos.includes(v)) criterios[k] = v;
  }
  const dados = {};
  const parcial = limparParcial(body?.dados);
  for (const k of SECOES_PRESET) if (parcial[k]) dados[k] = parcial[k];
  return {
    nome,
    descricao: String(body?.descricao || "").trim().slice(0, 300),
    criterios,
    dados,
    ordem: Number.isFinite(Number(body?.ordem)) ? Math.trunc(Number(body.ordem)) : 0,
    ativo: body?.ativo !== false,
  };
}

adminRouter.get("/presets", async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT ${PRESET_COLUNAS} FROM contrato_presets ORDER BY ordem, nome`);
    res.json(rows);
  } catch (err) {
    console.error("[contratos] presets", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.post("/presets", async (req, res) => {
  const p = limparPreset(req.body);
  if (p.erro) return res.status(400).json({ error: p.erro });
  try {
    const { rows } = await db.query(
      `INSERT INTO contrato_presets (nome, descricao, criterios, dados, ordem, ativo)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PRESET_COLUNAS}`,
      [p.nome, p.descricao, JSON.stringify(p.criterios), JSON.stringify(p.dados), p.ordem, p.ativo]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[contratos] criar preset", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.put("/presets/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  const p = limparPreset(req.body);
  if (p.erro) return res.status(400).json({ error: p.erro });
  try {
    const { rows } = await db.query(
      `UPDATE contrato_presets
          SET nome = $2, descricao = $3, criterios = $4, dados = $5, ordem = $6, ativo = $7, updated_at = now()
        WHERE id = $1 RETURNING ${PRESET_COLUNAS}`,
      [req.params.id, p.nome, p.descricao, JSON.stringify(p.criterios), JSON.stringify(p.dados), p.ordem, p.ativo]
    );
    if (!rows.length) return res.status(404).json({ error: "Perfil não encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[contratos] atualizar preset", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.delete("/presets/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  try {
    await db.query(`DELETE FROM contrato_presets WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("[contratos] excluir preset", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * POST /assistente — entrevista de IA.
 * body: { modo, mensagens, campos, estado, perfis?, contexto? }
 * → { mensagem, perfil_id, atualizacoes, faltando, pronto }. Quem valida e aplica é o navegador.
 */
adminRouter.post("/assistente", async (req, res) => {
  try {
    const { modo, mensagens, campos, estado, perfis, contexto } = req.body || {};
    if (!Array.isArray(campos) || !campos.length || !estado || typeof estado !== "object") {
      return res.status(400).json({ error: "Campos e estado do contrato são obrigatórios" });
    }
    if (JSON.stringify([campos, estado, perfis || [], contexto || {}]).length > 80_000) {
      return res.status(413).json({ error: "Dados grandes demais para o assistente" });
    }
    const r = await conversarContrato(db, {
      mensagens,
      modo: modo === "aditivo" ? "aditivo" : "contrato",
      campos,
      estado,
      perfis,
      contexto,
    });
    res.json(r);
  } catch (err) {
    if (!err.status) console.error("[contratos] assistente", err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Erro interno" });
  }
});

/**
 * GET /:id/condicoes — base para um aditivo: o contrato original (assinado) com os aditivos
 * já assinados aplicados em ordem, mais o número do próximo aditivo. `:id` pode ser o
 * original ou um aditivo (sobe para o original).
 */
adminRouter.get("/:id/condicoes", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  try {
    let pai = await buscar(req.params.id);
    if (!pai) return res.status(404).json({ error: "Contrato não encontrado" });
    if (pai.tipo === "aditivo" && pai.contrato_pai_id) pai = await buscar(pai.contrato_pai_id);
    if (!pai) return res.status(404).json({ error: "Contrato original não encontrado" });
    if (pai.status !== "assinado") {
      return res.status(409).json({ error: "Só contrato assinado recebe aditivo. Enquanto não assina, ajuste o próprio contrato." });
    }
    const { rows: adits } = await db.query(
      `SELECT status, aditivo_numero, dados FROM contratos WHERE contrato_pai_id = $1 AND tipo = 'aditivo' ORDER BY aditivo_numero`,
      [pai.id]
    );
    const base = JSON.parse(JSON.stringify(pai.dados || {}));
    for (const a of adits) {
      if (a.status !== "assinado") continue;
      const novo = a.dados?.novo || {};
      for (const sec of SECOES) {
        if (novo[sec] && typeof novo[sec] === "object") base[sec] = { ...(base[sec] || {}), ...novo[sec] };
      }
    }
    // Cidade, data e testemunhas pertencem a cada documento: o aditivo novo começa sem data.
    if (base.assinatura) base.assinatura = { ...base.assinatura, data: "" };
    const proximo = adits.reduce((m, a) => Math.max(m, a.aditivo_numero || 0), 0) + 1;
    res.json({
      pai: { id: pai.id, titulo: pai.titulo, company_id: pai.company_id, company_name: pai.company_name, assinado_em: pai.assinado_em },
      base,
      proximo_numero: proximo,
      aditivo_em_aberto: adits.some((a) => a.status !== "assinado"),
    });
  } catch (err) {
    console.error("[contratos] condicoes", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.company_id, e.name AS company_name, c.titulo, c.tipo, c.contrato_pai_id, c.aditivo_numero, c.status, c.file_path,
              c.signed_file_path, c.zapsign_token, c.zapsign_enviado_em, c.assinado_em,
              c.created_at, c.updated_at
         FROM contratos c LEFT JOIN companies e ON e.id = c.company_id
        ORDER BY c.updated_at DESC`
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        company_id: r.company_id,
        company_name: r.company_name,
        titulo: r.titulo,
        tipo: r.tipo || "contrato",
        contrato_pai_id: r.contrato_pai_id,
        aditivo_numero: r.aditivo_numero,
        status: r.status,
        tem_pdf: Boolean(r.file_path),
        tem_pdf_assinado: Boolean(r.signed_file_path),
        zapsign_token: r.zapsign_token,
        zapsign_enviado_em: r.zapsign_enviado_em,
        assinado_em: r.assinado_em,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }))
    );
  } catch (err) {
    console.error("[contratos] listar", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const row = await buscar(req.params.id);
    if (!row) return res.status(404).json({ error: "Contrato não encontrado" });
    res.json(publico(row));
  } catch (err) {
    console.error("[contratos] detalhe", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/:id/pdf", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const row = await buscar(req.params.id);
    if (!row) return res.status(404).json({ error: "Contrato não encontrado" });
    const assinado = req.query.assinado === "1";
    const filePath = assinado ? row.signed_file_path : row.file_path;
    const nome = assinado ? row.signed_file_name : row.file_name;
    const buf = lerPdf(filePath);
    if (!buf) return res.status(404).json({ error: "PDF não encontrado" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${nomeSeguro(nome)}"`);
    res.send(buf);
  } catch (err) {
    console.error("[contratos] pdf", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

function validarCorpo(body) {
  const titulo = String(body?.titulo || "").trim();
  if (!titulo) return { erro: "Informe o título do contrato" };
  if (!body?.dados || typeof body.dados !== "object" || Array.isArray(body.dados)) {
    return { erro: "Dados do contrato inválidos" };
  }
  const companyId = body.company_id ? String(body.company_id) : null;
  if (companyId && !validateUUID(companyId)) return { erro: "Empresa inválida" };
  const tipo = body.tipo === "aditivo" ? "aditivo" : "contrato";
  const paiId = tipo === "aditivo" && body.contrato_pai_id ? String(body.contrato_pai_id) : null;
  if (tipo === "aditivo" && (!paiId || !validateUUID(paiId))) return { erro: "Aditivo precisa do contrato original" };
  return { titulo: titulo.slice(0, 200), dados: body.dados, companyId, pdf: body.pdf_base64 || null, tipo, paiId };
}

adminRouter.post("/", async (req, res) => {
  const v = validarCorpo(req.body);
  if (v.erro) return res.status(400).json({ error: v.erro });
  let stored = null;
  const client = await db.connect();
  try {
    let fileName = null;
    if (v.pdf) {
      stored = gravarPdfBase64(v.pdf, v.titulo).stored;
      fileName = `${nomeSeguro(v.titulo)}.pdf`;
    }
    await client.query("BEGIN");
    let aditivoNumero = null;
    let dados = v.dados;
    if (v.tipo === "aditivo") {
      // O original precisa estar assinado; o número do aditivo é decidido aqui (não pelo navegador).
      const pai = await client.query(`SELECT status, tipo FROM contratos WHERE id = $1 FOR UPDATE`, [v.paiId]);
      if (!pai.rows.length || pai.rows[0].tipo !== "contrato") throw Object.assign(new Error("Contrato original não encontrado"), { http: 404 });
      if (pai.rows[0].status !== "assinado") throw Object.assign(new Error("Só contrato assinado recebe aditivo"), { http: 409 });
      const { rows: mx } = await client.query(`SELECT COALESCE(MAX(aditivo_numero), 0) AS n FROM contratos WHERE contrato_pai_id = $1`, [v.paiId]);
      aditivoNumero = Number(mx[0].n) + 1;
      dados = { ...v.dados, numero: aditivoNumero };
    }
    const entregaId = stored
      ? await criarEntrega(client, {
          companyId: v.companyId,
          titulo: `Contrato — ${v.titulo}`,
          stored,
          fileName,
          docType: v.tipo,
        })
      : null;
    const { rows } = await client.query(
      `INSERT INTO contratos (company_id, titulo, dados, status, file_path, file_name, deliverable_id, criado_por, tipo, contrato_pai_id, aditivo_numero)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        v.companyId,
        v.titulo,
        JSON.stringify(dados),
        stored ? "salvo" : "rascunho",
        stored,
        fileName,
        entregaId,
        req.admin?.nome || req.admin?.cpf || null,
        v.tipo,
        v.paiId,
        aditivoNumero,
      ]
    );
    await client.query("COMMIT");
    res.status(201).json(publico(await buscar(rows[0].id)));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (stored) removeUploadFile(stored);
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[contratos] criar", err);
    res.status(err.message === "PDF inválido" || /10 MB/.test(err.message) ? 400 : 500).json({
      error: err.message === "PDF inválido" || /10 MB/.test(err.message) ? err.message : "Erro interno",
    });
  } finally {
    client.release();
  }
});

adminRouter.put("/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  const v = validarCorpo(req.body);
  if (v.erro) return res.status(400).json({ error: v.erro });
  let stored = null;
  const client = await db.connect();
  try {
    const atual = await buscar(req.params.id);
    if (!atual) return res.status(404).json({ error: "Contrato não encontrado" });
    if (atual.status === "assinado") {
      return res.status(409).json({ error: "Contrato já assinado não pode ser alterado. Para mudar condições, crie um aditivo." });
    }
    if (atual.status === "enviado" && v.pdf) {
      return res.status(409).json({
        error: "Este contrato já foi enviado para assinatura. Para trocar o PDF, crie um novo contrato.",
      });
    }
    let fileName = atual.file_name;
    if (v.pdf) {
      stored = gravarPdfBase64(v.pdf, v.titulo).stored;
      fileName = `${nomeSeguro(v.titulo)}.pdf`;
    }
    await client.query("BEGIN");
    let entregaId = atual.deliverable_id;
    if (stored) {
      if (entregaId && atual.company_id === v.companyId) {
        await client.query(
          `UPDATE deliverables SET title = $2, file_path = $3, file_name = $4 WHERE id = $1`,
          [entregaId, `Contrato — ${v.titulo}`.slice(0, 200), stored, fileName]
        );
      } else {
        if (entregaId) await client.query(`DELETE FROM deliverables WHERE id = $1`, [entregaId]);
        entregaId = await criarEntrega(client, {
          companyId: v.companyId,
          titulo: `Contrato — ${v.titulo}`,
          stored,
          fileName,
          docType: atual.tipo || "contrato",
        });
      }
    }
    await client.query(
      `UPDATE contratos
          SET company_id = $2, titulo = $3, dados = $4, status = $5, file_path = $6, file_name = $7,
              deliverable_id = $8, updated_at = now()
        WHERE id = $1`,
      [
        atual.id,
        v.companyId,
        v.titulo,
        JSON.stringify(v.dados),
        atual.status === "enviado" ? "enviado" : stored || atual.file_path ? "salvo" : "rascunho",
        stored || atual.file_path,
        fileName,
        entregaId,
      ]
    );
    await client.query("COMMIT");
    if (stored && atual.file_path) removeUploadFile(atual.file_path);
    res.json(publico(await buscar(atual.id)));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (stored) removeUploadFile(stored);
    console.error("[contratos] atualizar", err);
    res.status(500).json({ error: err.message === "PDF inválido" ? err.message : "Erro interno" });
  } finally {
    client.release();
  }
});

adminRouter.delete("/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  const client = await db.connect();
  try {
    const atual = await buscar(req.params.id);
    if (!atual) return res.status(404).json({ error: "Contrato não encontrado" });
    await client.query("BEGIN");
    for (const id of [atual.deliverable_id, atual.signed_deliverable_id].filter(Boolean)) {
      await client.query(`DELETE FROM deliverables WHERE id = $1`, [id]);
    }
    await client.query(`DELETE FROM contratos WHERE id = $1`, [atual.id]);
    await client.query("COMMIT");
    for (const f of [atual.file_path, atual.signed_file_path].filter(Boolean)) removeUploadFile(f);
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[contratos] excluir", err);
    res.status(500).json({ error: "Erro interno" });
  } finally {
    client.release();
  }
});

/**
 * POST /:id/enviar-assinatura
 * body: { signatarios: [{ nome, email?, telefone?, qualificacao? }], whatsapp?: boolean, prazo_dias?: number }
 */
adminRouter.post("/:id/enviar-assinatura", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  if (!zapsign.configurado()) {
    return res.status(409).json({
      error: "ZapSign não configurada. Defina ZAPSIGN_API_TOKEN ou baixe o PDF e envie manualmente no site da ZapSign.",
    });
  }
  try {
    const atual = await buscar(req.params.id);
    if (!atual) return res.status(404).json({ error: "Contrato não encontrado" });
    if (atual.status === "assinado") return res.status(409).json({ error: "Contrato já assinado." });
    if (atual.zapsign_token) {
      return res.status(409).json({ error: "Este contrato já está na ZapSign. Use 'Atualizar status'." });
    }
    const buf = lerPdf(atual.file_path);
    if (!buf) return res.status(409).json({ error: "Salve o contrato (gerar PDF) antes de enviar para assinatura." });

    const signatarios = Array.isArray(req.body?.signatarios) ? req.body.signatarios : [];
    const limpos = signatarios
      .map((s) => ({
        nome: String(s?.nome || "").trim().slice(0, 120),
        email: String(s?.email || "").trim().toLowerCase(),
        telefone: String(s?.telefone || "").replace(/\D/g, ""),
        qualificacao: String(s?.qualificacao || "").trim().slice(0, 60),
      }))
      .filter((s) => s.nome);
    if (!limpos.length) return res.status(400).json({ error: "Informe ao menos um signatário com nome." });
    for (const s of limpos) {
      if (s.email && !/\S+@\S+\.\S+/.test(s.email)) return res.status(400).json({ error: `E-mail inválido: ${s.email}` });
      if (!s.email && s.telefone.length < 10) {
        return res.status(400).json({ error: `Signatário "${s.nome}" precisa de e-mail ou WhatsApp.` });
      }
    }
    const whatsapp = Boolean(req.body?.whatsapp);
    const prazoDias = Math.min(90, Math.max(1, Number(req.body?.prazo_dias) || 15));

    const doc = await zapsign.criarDocumento({
      nome: atual.titulo,
      pdfBase64: buf.toString("base64"),
      externalId: atual.id,
      signatarios: limpos,
      whatsapp,
      prazoDias,
    });

    const signers = (doc.signers || []).map((s, i) => ({
      token: s.token,
      nome: s.name,
      email: s.email || limpos[i]?.email || "",
      telefone: s.phone_number || limpos[i]?.telefone || "",
      qualificacao: limpos[i]?.qualificacao || "",
      status: s.status,
      sign_url: s.sign_url,
      signed_at: s.signed_at || null,
    }));
    const { rows } = await db.query(
      `UPDATE contratos
          SET status = 'enviado', zapsign_token = $2, zapsign_signers = $3, zapsign_enviado_em = now(), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [atual.id, doc.token, JSON.stringify(signers)]
    );

    // Cópia do contrato (ainda sem assinatura) por e-mail, com o link de cada signatário.
    // A ZapSign já manda o e-mail dela; este é o "recibo" do escritório com o PDF anexo.
    const avisos = [];
    for (const s of signers.filter((x) => x.email)) {
      avisos.push(
        enviarEmailContrato({
          para: [s.email],
          assunto: `Contrato para assinatura — ${atual.titulo}`,
          linhas: [
            `Olá, ${s.nome}.`,
            `Segue em anexo o contrato "${atual.titulo}" para sua conferência.`,
            "A assinatura eletrônica é feita pela ZapSign, no link abaixo (você também recebe o convite da própria ZapSign).",
            "Nescon Contabilidade",
          ],
          link: { texto: "Assinar o contrato", url: s.sign_url },
          anexo: { nome: atual.file_name || "contrato.pdf", conteudo: buf },
        }).catch((err) => console.error("[contratos] e-mail de envio falhou:", err.message))
      );
    }
    await Promise.all(avisos);

    res.json(publico({ ...rows[0], company_name: atual.company_name }));
  } catch (err) {
    console.error("[contratos] enviar-assinatura", err);
    res.status(502).json({ error: err.message || "Falha ao enviar para a ZapSign" });
  }
});

/** POST /:id/sincronizar — consulta a ZapSign; se assinado, conclui (igual ao webhook). */
adminRouter.post("/:id/sincronizar", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const atual = await buscar(req.params.id);
    if (!atual) return res.status(404).json({ error: "Contrato não encontrado" });
    if (!atual.zapsign_token) return res.status(409).json({ error: "Contrato ainda não foi enviado para assinatura." });
    if (atual.status === "assinado") return res.json({ ...publico(atual), zapsign_status: "signed" });

    const doc = await zapsign.detalharDocumento(atual.zapsign_token);
    const signers = (doc.signers || []).map((s) => {
      const antigo = (atual.zapsign_signers || []).find((a) => a.token === s.token) || {};
      return { ...antigo, token: s.token, nome: s.name, status: s.status, sign_url: s.sign_url || antigo.sign_url, signed_at: s.signed_at || null };
    });
    await db.query(`UPDATE contratos SET zapsign_signers = $2, updated_at = now() WHERE id = $1`, [
      atual.id,
      JSON.stringify(signers),
    ]);
    const depois = await concluirAssinatura({ ...atual, zapsign_signers: signers }, doc);
    res.json({ ...publico({ ...depois, company_name: atual.company_name }), zapsign_status: doc.status });
  } catch (err) {
    console.error("[contratos] sincronizar", err);
    res.status(502).json({ error: err.message || "Falha ao consultar a ZapSign" });
  }
});

// ---------------------------------------------------------------------------
// Webhook da ZapSign (público). Cadastrar em Configurações > Integrações > Webhooks:
//   {PUBLIC_APP_URL}/api/contratos/zapsign/webhook?token={ZAPSIGN_WEBHOOK_SECRET}
// (ou mandar o segredo no cabeçalho X-Webhook-Token). Só o evento doc_signed importa.
// ---------------------------------------------------------------------------
const webhookRouter = express.Router();
webhookRouter.use(express.json({ limit: "1mb" }));

webhookRouter.post("/", async (req, res) => {
  const segredo = (process.env.ZAPSIGN_WEBHOOK_SECRET || "").trim();
  const recebido = String(req.query.token || req.get("x-webhook-token") || "").trim();
  if (!segredo || recebido !== segredo) return res.status(401).json({ error: "não autorizado" });

  const evento = req.body || {};
  if (evento.event_type !== "doc_signed" || !evento.token) return res.json({ ok: true, ignorado: true });

  // Responde rápido e processa em seguida: a ZapSign reenvia se demorar.
  res.json({ ok: true });
  try {
    const { rows } = await db.query(
      `SELECT c.*, e.name AS company_name FROM contratos c LEFT JOIN companies e ON e.id = c.company_id
        WHERE c.zapsign_token = $1`,
      [String(evento.token)]
    );
    if (!rows.length) {
      console.warn("[contratos] webhook: documento desconhecido", evento.token);
      return;
    }
    // O payload traz o signed_file, mas o link vence em 60 min; consultar de novo é o
    // caminho mais seguro para reentregas atrasadas.
    await concluirAssinatura(rows[0]);
  } catch (err) {
    console.error("[contratos] webhook doc_signed", err);
  }
});

module.exports = { adminRouter, webhookRouter, concluirAssinatura };
