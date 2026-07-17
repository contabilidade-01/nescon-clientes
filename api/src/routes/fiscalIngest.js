/**
 * Ingestão de entregas vindas do sistema de envio de guias (GCLICK).
 *
 * Autenticação de serviço (X-Ingest-Key), não JWT: quem chama é outro servidor, não um browser.
 * Idempotente por (company_id, external_ref) — reenvio ou retificação da mesma atividade
 * atualiza a linha existente e PRESERVA o access_token, para que links de WhatsApp já
 * entregues ao cliente continuem a funcionar.
 */
const router = require("express").Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const db = require("../db");
const { PORTAL_ONLY_TOOL_ACCESS } = require("../companyTools");
const { validateDate, validateString, validateUUID } = require("../middleware/validate");
const { uploadPdf, removeUploadFile } = require("../uploads");
const { accessSummary } = require("../deliverableAccess");
const { CATEGORIES, isCategory } = require("../deliverableTypes");

const FIELDS = `id, company_id, category, doc_type, title, competencia,
                to_char(due_date, 'YYYY-MM-DD') AS due_date,
                file_name, status, source, access_token, created_at`;

function isCompetencia(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Comparação em tempo constante — evita descobrir a chave por tempo de resposta. */
function keyMatches(provided, expected) {
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireIngestKey(req, res, next) {
  const expected = process.env.INGEST_API_KEY;
  // Sem chave configurada a rota fica desligada, em vez de aberta.
  if (!expected) {
    return res.status(503).json({ error: "Ingestão desativada: INGEST_API_KEY não configurada." });
  }
  if (!keyMatches(req.headers["x-ingest-key"], expected)) {
    return res.status(401).json({ error: "Chave de ingestão inválida" });
  }
  next();
}

function portalUrlFor(token) {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}/entrega/${token}` : null;
}

router.post("/ingest", requireIngestKey, uploadPdf.single("file"), async (req, res) => {
  const file = req.file;
  let client;
  try {
    const { category, doc_type, title, competencia, due_date, external_ref } = req.body;
    const cnpj = String(req.body.cnpj || "").replace(/\D/g, "");

    if (!file) return res.status(400).json({ error: "Arquivo obrigatório" });
    if (cnpj.length !== 14) return res.status(400).json({ error: "CNPJ inválido" });
    if (!isCategory(category)) {
      return res.status(400).json({ error: `category deve ser: ${CATEGORIES.join(", ")}` });
    }
    if (!validateString(title || "", 1, 200)) return res.status(400).json({ error: "Título inválido" });
    if (competencia && !isCompetencia(competencia)) {
      return res.status(400).json({ error: "competencia deve estar no formato AAAA-MM" });
    }
    if (due_date && !validateDate(due_date)) return res.status(400).json({ error: "due_date inválida" });
    if (doc_type && !validateString(doc_type, 1, 40)) return res.status(400).json({ error: "doc_type inválido" });
    if (external_ref && !validateString(external_ref, 1, 120)) {
      return res.status(400).json({ error: "external_ref inválido" });
    }

    const company = await db.query("SELECT id FROM companies WHERE cnpj = $1", [cnpj]);
    if (!company.rows.length) {
      removeUploadFile(file.filename);
      return res.status(404).json({
        error: `Nenhuma empresa cadastrada no portal com o CNPJ ${cnpj}. Cadastre-a no painel admin antes de publicar entregas.`,
      });
    }
    const companyId = company.rows[0].id;
    const ref = external_ref || null;

    client = await db.connect();
    await client.query("BEGIN");

    let existing = { rows: [] };
    if (ref) {
      existing = await client.query(
        "SELECT id, file_path FROM deliverables WHERE company_id = $1 AND external_ref = $2 FOR UPDATE",
        [companyId, ref]
      );
    }

    let row;
    let previousFile = null;

    if (existing.rows.length) {
      previousFile = existing.rows[0].file_path;
      // `status` e `access_token` ficam de fora do UPDATE de propósito: não desmarcamos um
      // pagamento já registado pelo cliente nem invalidamos o link que ele já recebeu.
      const upd = await client.query(
        `UPDATE deliverables
         SET category=$1, doc_type=$2, title=$3, competencia=$4, due_date=$5,
             file_path=$6, file_name=$7, source='gclick'
         WHERE id=$8
         RETURNING ${FIELDS}`,
        [
          category,
          doc_type || null,
          title.trim(),
          competencia || null,
          due_date || null,
          file.filename,
          file.originalname,
          existing.rows[0].id,
        ]
      );
      row = upd.rows[0];
    } else {
      const ins = await client.query(
        `INSERT INTO deliverables
           (company_id, category, doc_type, title, competencia, due_date,
            file_path, file_name, source, external_ref, access_token)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'gclick',$9,$10)
         RETURNING ${FIELDS}`,
        [
          companyId,
          category,
          doc_type || null,
          title.trim(),
          competencia || null,
          due_date || null,
          file.filename,
          file.originalname,
          ref,
          crypto.randomBytes(24).toString("hex"),
        ]
      );
      row = ins.rows[0];
    }

    await client.query("COMMIT");

    // Só depois do commit: se a transação falhasse, o arquivo antigo ainda seria o válido.
    if (previousFile && previousFile !== file.filename) removeUploadFile(previousFile);

    res.status(existing.rows.length ? 200 : 201).json({
      id: row.id,
      access_token: row.access_token,
      portal_url: portalUrlFor(row.access_token),
      updated: existing.rows.length > 0,
    });
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch { /* conexão já perdida */ }
    }
    if (file) removeUploadFile(file.filename);
    console.error("[ingest]", err);
    res.status(500).json({ error: "Erro interno" });
  } finally {
    if (client) client.release();
  }
});

/**
 * Cria no portal as empresas que ainda não existem, a partir da lista de clientes do
 * sistema de guias. Casamento por CNPJ.
 *
 * NUNCA sobrescreve empresa existente: razão social, e-mail e permissões ajustados à mão
 * no painel admin são a fonte da verdade e não podem ser atropelados por um re-sync
 * (mesma política do sync do G-Click → clientes).
 *
 * Empresa nova nasce com senha = CNPJ (convenção do sistema) e só com as seções de
 * entregas ligadas — o Departamento Pessoal o admin liga a quem usa.
 */
router.post("/sync-companies", requireIngestKey, async (req, res) => {
  try {
    const lista = req.body?.companies;
    if (!Array.isArray(lista)) {
      return res.status(400).json({ error: "companies deve ser uma lista" });
    }
    if (lista.length > 1000) {
      return res.status(400).json({ error: "máximo de 1000 empresas por chamada" });
    }

    const criadas = [];
    const existentes = [];
    const erros = [];

    for (const item of lista) {
      const cnpj = String(item?.cnpj || "").replace(/\D/g, "");
      const nome = String(item?.name || "").trim();
      try {
        if (cnpj.length !== 14) {
          erros.push({ cnpj: item?.cnpj ?? null, motivo: "CNPJ inválido" });
          continue;
        }
        if (!validateString(nome, 1, 200)) {
          erros.push({ cnpj, motivo: "Razão social vazia" });
          continue;
        }

        const achou = await db.query("SELECT id, name FROM companies WHERE cnpj = $1", [cnpj]);
        if (achou.rows.length) {
          existentes.push({ cnpj, name: achou.rows[0].name });
          continue;
        }

        const email = item?.email ? String(item.email).trim().toLowerCase() : null;
        const phone = item?.phone ? String(item.phone).replace(/\D/g, "") : null;
        // Senha inicial = CNPJ (informação pública), por isso nasce marcada: o portal
        // obriga a trocar no primeiro acesso antes de deixar navegar.
        const { rows } = await db.query(
          `INSERT INTO companies
             (name, cnpj, password_hash, contact_email, phone, tool_access, must_change_password)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,true)
           ON CONFLICT (cnpj) DO NOTHING
           RETURNING id, name, cnpj`,
          [nome, cnpj, await bcrypt.hash(cnpj, 10), email, phone || null,
           JSON.stringify(PORTAL_ONLY_TOOL_ACCESS)]
        );
        // ON CONFLICT sem retorno = criada por outra chamada em paralelo.
        if (rows.length) criadas.push(rows[0]);
        else existentes.push({ cnpj, name: nome });
      } catch (e) {
        console.error("[sync-companies]", cnpj, e.message);
        erros.push({ cnpj, motivo: "Falha ao criar" });
      }
    }

    res.json({
      criadas: criadas.length,
      existentes: existentes.length,
      erros: erros.length,
      detalhe: { criadas, existentes, erros },
    });
  } catch (err) {
    console.error("[sync-companies]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Aberturas/downloads de várias entregas numa chamada — o sistema de guias usa isto
 * para manter a tela de auditoria dele como painel único, sem duplicar o rastreio.
 */
router.post("/access-stats", requireIngestKey, async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids deve ser uma lista" });
    if (ids.length > 500) return res.status(400).json({ error: "máximo de 500 ids por chamada" });
    const valid = ids.filter((id) => validateUUID(id));
    res.json(await accessSummary(valid));
  } catch (err) {
    console.error("[access-stats]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.use((err, req, res, next) => {
  if (!err) return next();
  if (req.file) removeUploadFile(req.file.filename);
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "Arquivo muito grande (máx 10MB)" : err.message;
    return res.status(400).json({ error: msg });
  }
  console.error("[ingest]", err);
  return res.status(400).json({ error: err.message || "Falha no envio do arquivo" });
});

module.exports = router;
