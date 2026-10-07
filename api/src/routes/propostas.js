/**
 * Propostas comerciais (painel, área "empresas").
 *
 * Fluxo: o painel monta o PDF no navegador (mesmo motor de blocos dos contratos) e manda em
 * base64 com os dados do formulário → gravamos no volume de uploads. Se a proposta é de uma
 * empresa do portal e o escritório pediu, espelhamos em `deliverables`. "Enviar por e-mail"
 * manda o PDF anexo e marca a proposta como enviada; aceite/recusa são marcados à mão.
 *
 * O catálogo de serviços, os pacotes e os padrões ficam em app_settings
 * (`propostas_catalogo`); o assistente (propostaIa.js) só devolve patches sobre ele.
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
const { enviarEmailContrato } = require("../contratosMail");
const { getSetting, setSetting } = require("../appSettings");
const { isSmtpConfigured, getPublicAppUrl } = require("../mailer");
const { obterChaveApi } = require("../iaProvider");
const { conversarProposta } = require("../propostaIa");

const CHAVE_CATALOGO = "propostas_catalogo";
const STATUS = ["rascunho", "salva", "enviada", "aceita", "recusada"];
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_CATALOGO_BYTES = 300 * 1024;

function nomeSeguro(s) {
  return (
    String(s || "proposta")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "proposta"
  );
}

function gravarPdfBase64(base64, baseNome) {
  const limpo = String(base64 || "").replace(/^data:application\/pdf;base64,/, "");
  const buf = Buffer.from(limpo, "base64");
  if (!buf.length || buf.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF inválido");
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

function ehErroDePdf(err) {
  return err.message === "PDF inválido" || /10 MB/.test(err.message);
}

async function criarEntrega(client, { companyId, titulo, stored, fileName }) {
  const { rows } = await client.query(
    `INSERT INTO deliverables
       (company_id, category, doc_type, title, file_path, file_name, source, access_token, released_at)
     VALUES ($1, 'outro', 'proposta', $2, $3, $4, 'proposta', $5, now())
     RETURNING id`,
    [companyId, titulo.slice(0, 200), stored, fileName.slice(0, 200), crypto.randomBytes(24).toString("hex")]
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
    cliente_nome: row.cliente_nome,
    status: row.status,
    tem_pdf: Boolean(row.file_path),
    total_unico: Number(row.total_unico) || 0,
    total_mensal: Number(row.total_mensal) || 0,
    validade_ate: row.validade_ate ? new Date(row.validade_ate).toISOString().slice(0, 10) : null,
    enviada_em: row.enviada_em,
    decidida_em: row.decidida_em,
    created_at: row.created_at,
    updated_at: row.updated_at,
    dados: row.dados,
    deliverable_id: row.deliverable_id,
  };
}

async function buscar(id) {
  const { rows } = await db.query(
    `SELECT p.*, e.name AS company_name
       FROM propostas p LEFT JOIN companies e ON e.id = p.company_id
      WHERE p.id = $1`,
    [id]
  );
  return rows[0] || null;
}

function dinheiro(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : 0;
}

function dataIso(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function validarCorpo(body) {
  const titulo = String(body?.titulo || "").trim();
  if (!titulo) return { erro: "Informe o título da proposta" };
  if (!body?.dados || typeof body.dados !== "object" || Array.isArray(body.dados)) return { erro: "Dados da proposta inválidos" };
  const companyId = body.company_id ? String(body.company_id) : null;
  if (companyId && !validateUUID(companyId)) return { erro: "Empresa inválida" };
  return {
    titulo: titulo.slice(0, 200),
    clienteNome: String(body.dados?.cliente?.nome || "").trim().slice(0, 200),
    dados: body.dados,
    companyId,
    pdf: body.pdf_base64 || null,
    publicar: Boolean(body.publicar_portal),
    totalUnico: dinheiro(body.total_unico),
    totalMensal: dinheiro(body.total_mensal),
    validadeAte: dataIso(body.validade_ate),
  };
}

const adminRouter = express.Router();
adminRouter.use(authMiddleware);
adminRouter.use(requireArea("empresas"));
// O PDF vem em base64 no JSON — acima do limite global de 1 MB do index.js.
adminRouter.use(express.json({ limit: "15mb" }));

adminRouter.get("/config", async (_req, res) => {
  let ia = false;
  try {
    ia = Boolean(await obterChaveApi("claude", db));
  } catch {
    ia = false;
  }
  res.json({ ia, smtp: isSmtpConfigured() });
});

/** Tabela de honorários-padrão (Atualização de Honorários), só leitura — igual à dos contratos. */
adminRouter.get("/tabela", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT enquadramento, tipo_empresa, complexidade, valor_a_partir_centavos
         FROM honorario_padroes WHERE ativo IS TRUE`
    );
    res.json({ padroes: rows });
  } catch (err) {
    if (err.code !== "42P01") console.error("[propostas] tabela", err.message);
    res.json({ padroes: [] });
  }
});

// Catálogo: itens, pacotes e padrões. Vazio = o navegador usa o padrão embutido.
adminRouter.get("/catalogo", async (_req, res) => {
  try {
    const raw = await getSetting(db, CHAVE_CATALOGO);
    let catalogo = null;
    try {
      catalogo = raw ? JSON.parse(raw) : null;
    } catch {
      catalogo = null;
    }
    res.json({ catalogo });
  } catch (err) {
    console.error("[propostas] catalogo", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.put("/catalogo", async (req, res) => {
  try {
    const c = req.body?.catalogo;
    if (c === null) {
      await setSetting(db, CHAVE_CATALOGO, null);
      return res.json({ catalogo: null });
    }
    if (!c || typeof c !== "object" || Array.isArray(c)) return res.status(400).json({ error: "Catálogo inválido" });
    const limpo = {
      itens: Array.isArray(c.itens) ? c.itens.filter((i) => i && typeof i.codigo === "string" && i.codigo) : [],
      pacotes: Array.isArray(c.pacotes) ? c.pacotes.filter((p) => p && typeof p.id === "string" && p.id) : [],
      padroes: c.padroes && typeof c.padroes === "object" && !Array.isArray(c.padroes) ? c.padroes : {},
    };
    const json = JSON.stringify(limpo);
    if (Buffer.byteLength(json) > MAX_CATALOGO_BYTES) return res.status(413).json({ error: "Catálogo grande demais" });
    await setSetting(db, CHAVE_CATALOGO, json);
    res.json({ catalogo: limpo });
  } catch (err) {
    console.error("[propostas] salvar catalogo", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * POST /assistente
 * body: { mensagens: [{role, content}], catalogo, estado }
 * → { mensagem, patch, faltando, pronta }. Quem aplica o patch é o navegador.
 */
adminRouter.post("/assistente", async (req, res) => {
  try {
    const { mensagens, catalogo, estado } = req.body || {};
    if (!catalogo || typeof catalogo !== "object" || !estado || typeof estado !== "object") {
      return res.status(400).json({ error: "Catálogo e estado da proposta são obrigatórios" });
    }
    if (JSON.stringify(catalogo).length > 80_000 || JSON.stringify(estado).length > 60_000) {
      return res.status(413).json({ error: "Dados grandes demais para o assistente" });
    }
    const r = await conversarProposta(db, { mensagens, catalogo, estado });
    res.json(r);
  } catch (err) {
    if (!err.status) console.error("[propostas] assistente", err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Erro interno" });
  }
});

adminRouter.get("/", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.id, p.company_id, e.name AS company_name, p.titulo, p.cliente_nome, p.status,
              p.file_path, p.total_unico, p.total_mensal, p.validade_ate, p.enviada_em,
              p.decidida_em, p.created_at, p.updated_at
         FROM propostas p LEFT JOIN companies e ON e.id = p.company_id
        ORDER BY p.updated_at DESC`
    );
    res.json(rows.map((r) => {
      const { dados: _d, deliverable_id: _x, ...resto } = publico(r);
      return resto;
    }));
  } catch (err) {
    console.error("[propostas] listar", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const row = await buscar(req.params.id);
    if (!row) return res.status(404).json({ error: "Proposta não encontrada" });
    res.json(publico(row));
  } catch (err) {
    console.error("[propostas] detalhe", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/:id/pdf", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const row = await buscar(req.params.id);
    if (!row) return res.status(404).json({ error: "Proposta não encontrada" });
    const buf = lerPdf(row.file_path);
    if (!buf) return res.status(404).json({ error: "PDF não encontrado" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${nomeSeguro(row.file_name)}"`);
    res.send(buf);
  } catch (err) {
    console.error("[propostas] pdf", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

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
    const entregaId =
      stored && v.publicar && v.companyId ? await criarEntrega(client, { companyId: v.companyId, titulo: v.titulo, stored, fileName }) : null;
    const { rows } = await client.query(
      `INSERT INTO propostas
         (company_id, titulo, cliente_nome, dados, status, total_unico, total_mensal, validade_ate,
          file_path, file_name, deliverable_id, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        v.companyId,
        v.titulo,
        v.clienteNome,
        JSON.stringify(v.dados),
        stored ? "salva" : "rascunho",
        v.totalUnico,
        v.totalMensal,
        v.validadeAte,
        stored,
        fileName,
        entregaId,
        req.admin?.nome || req.admin?.cpf || null,
      ]
    );
    await client.query("COMMIT");
    res.status(201).json(publico(await buscar(rows[0].id)));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (stored) removeUploadFile(stored);
    console.error("[propostas] criar", err);
    res.status(ehErroDePdf(err) ? 400 : 500).json({ error: ehErroDePdf(err) ? err.message : "Erro interno" });
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
    if (!atual) return res.status(404).json({ error: "Proposta não encontrada" });
    if (atual.status === "aceita") {
      return res.status(409).json({ error: "Proposta aceita não pode ser alterada. Crie uma nova." });
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
        await client.query(`UPDATE deliverables SET title = $2, file_path = $3, file_name = $4 WHERE id = $1`, [
          entregaId,
          v.titulo.slice(0, 200),
          stored,
          fileName,
        ]);
      } else {
        if (entregaId) await client.query(`DELETE FROM deliverables WHERE id = $1`, [entregaId]);
        entregaId = v.publicar && v.companyId ? await criarEntrega(client, { companyId: v.companyId, titulo: v.titulo, stored, fileName }) : null;
      }
    } else if (entregaId && req.body?.publicar_portal === false) {
      // "Tirar do portal": remove só a entrega; o PDF continua na proposta.
      await client.query(`DELETE FROM deliverables WHERE id = $1`, [entregaId]);
      entregaId = null;
    }
    const novoStatus = atual.status === "recusada" || atual.status === "enviada" ? atual.status : stored || atual.file_path ? "salva" : "rascunho";
    await client.query(
      `UPDATE propostas
          SET company_id = $2, titulo = $3, cliente_nome = $4, dados = $5, status = $6,
              total_unico = $7, total_mensal = $8, validade_ate = $9,
              file_path = $10, file_name = $11, deliverable_id = $12, updated_at = now()
        WHERE id = $1`,
      [
        atual.id,
        v.companyId,
        v.titulo,
        v.clienteNome,
        JSON.stringify(v.dados),
        novoStatus,
        v.totalUnico,
        v.totalMensal,
        v.validadeAte,
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
    console.error("[propostas] atualizar", err);
    res.status(ehErroDePdf(err) ? 400 : 500).json({ error: ehErroDePdf(err) ? err.message : "Erro interno" });
  } finally {
    client.release();
  }
});

adminRouter.delete("/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  const client = await db.connect();
  try {
    const atual = await buscar(req.params.id);
    if (!atual) return res.status(404).json({ error: "Proposta não encontrada" });
    await client.query("BEGIN");
    if (atual.deliverable_id) await client.query(`DELETE FROM deliverables WHERE id = $1`, [atual.deliverable_id]);
    await client.query(`DELETE FROM propostas WHERE id = $1`, [atual.id]);
    await client.query("COMMIT");
    if (atual.file_path) removeUploadFile(atual.file_path);
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[propostas] excluir", err);
    res.status(500).json({ error: "Erro interno" });
  } finally {
    client.release();
  }
});

/** POST /:id/status — marca enviada (manual, ex.: mandou por WhatsApp), aceita ou recusada. */
adminRouter.post("/:id/status", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  const status = String(req.body?.status || "");
  if (!["enviada", "aceita", "recusada", "salva"].includes(status)) return res.status(400).json({ error: "Situação inválida" });
  try {
    const atual = await buscar(req.params.id);
    if (!atual) return res.status(404).json({ error: "Proposta não encontrada" });
    if (status === "enviada" && !atual.file_path) return res.status(409).json({ error: "Salve a proposta (gerar PDF) antes de marcar como enviada." });
    const decidida = status === "aceita" || status === "recusada";
    await db.query(
      `UPDATE propostas
          SET status = $2,
              enviada_em = CASE WHEN $2 = 'enviada' THEN COALESCE(enviada_em, now()) ELSE enviada_em END,
              decidida_em = CASE WHEN $3 THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [atual.id, status, decidida]
    );
    res.json(publico(await buscar(atual.id)));
  } catch (err) {
    console.error("[propostas] status", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * POST /:id/enviar-email
 * body: { para: string[], mensagem?: string }
 */
adminRouter.post("/:id/enviar-email", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
  if (!isSmtpConfigured()) return res.status(409).json({ error: "E-mail (SMTP) não configurado. Baixe o PDF e envie por outro meio." });
  try {
    const atual = await buscar(req.params.id);
    if (!atual) return res.status(404).json({ error: "Proposta não encontrada" });
    const buf = lerPdf(atual.file_path);
    if (!buf) return res.status(409).json({ error: "Salve a proposta (gerar PDF) antes de enviar." });
    const para = (Array.isArray(req.body?.para) ? req.body.para : [])
      .map((e) => String(e || "").trim().toLowerCase())
      .filter((e) => /\S+@\S+\.\S+/.test(e));
    if (!para.length) return res.status(400).json({ error: "Informe ao menos um e-mail válido." });
    const mensagem = String(req.body?.mensagem || "").trim().slice(0, 1500);
    const portal = getPublicAppUrl();
    const enviou = await enviarEmailContrato({
      para,
      assunto: `Proposta — ${atual.cliente_nome || atual.titulo}`,
      linhas: [
        "Olá,",
        mensagem || `Segue em anexo a proposta de serviços contábeis para ${atual.cliente_nome || "sua empresa"}.`,
        "Qualquer dúvida, é só responder este e-mail.",
        "Nescon Contabilidade",
      ],
      link: atual.deliverable_id && portal ? { texto: "Ver no Portal do Cliente", url: `${portal}/documentos` } : null,
      anexo: { nome: atual.file_name || "proposta.pdf", conteudo: buf },
    });
    if (!enviou) return res.status(502).json({ error: "Não foi possível enviar o e-mail." });
    await db.query(
      `UPDATE propostas SET status = CASE WHEN status IN ('aceita','recusada') THEN status ELSE 'enviada' END,
              enviada_em = now(), updated_at = now() WHERE id = $1`,
      [atual.id]
    );
    res.json(publico(await buscar(atual.id)));
  } catch (err) {
    console.error("[propostas] enviar-email", err);
    res.status(502).json({ error: err.message || "Falha ao enviar o e-mail" });
  }
});

module.exports = { adminRouter, STATUS };
