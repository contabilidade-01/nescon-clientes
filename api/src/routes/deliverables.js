/**
 * Entregas da contabilidade ao cliente (guias fiscais, folha e documentos avulsos).
 * Alimenta as telas do Portal: listagens, calendário de vencimentos e próximos pagamentos.
 *
 * Isolamento: toda leitura/escrita de empresa carrega `company_id` vindo do JWT. O download
 * é por `id` (não por nome de arquivo) para que o dono seja verificado na própria query.
 */
const router = require("express").Router();
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { adminHasArea } = require("../middleware/adminArea");
const { companyHasTool } = require("../middleware/companyToolAccess");
const { validateUUID, validateDate, validateString } = require("../middleware/validate");
const { uploadPdf, resolveUploadPath, removeUploadFile } = require("../uploads");
const { recordAccess } = require("../deliverableAccess");
const { extrairVencimento } = require("../pdfDueDate");
const {
  CATEGORIES,
  TOOL_BY_CATEGORY,
  STATUSES,
  isCategory,
  toolForCategory,
} = require("../deliverableTypes");

// due_date sai como texto: o driver converteria DATE para Date e o JSON em UTC poderia
// deslocar o dia. Ordenar pelo texto 'YYYY-MM-DD' é equivalente a ordenar cronologicamente.
const FIELDS = `id, company_id, category, doc_type, title, competencia,
                to_char(due_date, 'YYYY-MM-DD') AS due_date,
                file_name, status, paid_at, source, historico, created_at`;

function isCompetencia(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Categorias que o utilizador pode ver (admin vê todas). */
function allowedCategories(req) {
  if (req.isAdmin) return [...CATEGORIES];
  return CATEGORIES.filter((c) => companyHasTool(req, TOOL_BY_CATEGORY[c]));
}

/**
 * Documento puxado do G-Click fica retido até o escritório liberar. O cliente só
 * enxerga o que já foi liberado; o admin vê tudo (para conferir antes de liberar).
 */
function onlyReleased(req) {
  return req.isAdmin ? "" : " AND released_at IS NOT NULL";
}

// Upload manual do escritório: exige a área de entregas, não só "ser admin".
function adminOnly(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: "Recurso exclusivo do administrador" });
  if (!adminHasArea(req, "entregas")) {
    return res.status(403).json({ error: "Você não tem acesso a esta área do painel" });
  }
  next();
}

/** Content-Disposition seguro: sem aspas/quebras que permitam injeção de cabeçalho. */
function sendStoredFile(res, row, disposition) {
  const full = resolveUploadPath(row.file_path);
  if (!full || !fs.existsSync(full)) {
    return res.status(404).json({ error: "Arquivo não encontrado" });
  }
  const safe = String(row.file_name || "documento.pdf").replace(/[^\w.\- ]/g, "_");
  res.setHeader("Content-Disposition", `${disposition}; filename="${safe}"`);
  // Sem `nosniff`, um arquivo com conteúdo HTML servido como PDF pode ser interpretado
  // como página — e executaria script no domínio do portal, com a sessão do cliente.
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.sendFile(full);
}

// ---------------------------------------------------------------------------
// Rotas públicas (link do WhatsApp). Definidas ANTES do authMiddleware.
// Token opaco, sem id sequencial — mesmo modelo do link rastreado do sistema de guias.
// ---------------------------------------------------------------------------

router.get("/public/:token", async (req, res) => {
  try {
    const token = String(req.params.token || "");
    if (!validateString(token, 16, 128)) return res.status(404).json({ error: "Documento não encontrado" });
    const { rows } = await db.query(
      `SELECT d.id, d.category, d.doc_type, d.title, d.competencia,
              to_char(d.due_date, 'YYYY-MM-DD') AS due_date, d.status,
              d.file_name, c.name AS company_name
       FROM deliverables d
       JOIN companies c ON c.id = d.company_id
       WHERE d.access_token = $1 AND d.released_at IS NOT NULL`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: "Documento não encontrado" });
    const { id, ...publico } = rows[0];
    recordAccess(req, id, "pagina");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.json(publico);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/public/:token/file", async (req, res) => {
  try {
    const token = String(req.params.token || "");
    if (!validateString(token, 16, 128)) return res.status(404).json({ error: "Documento não encontrado" });
    const { rows } = await db.query(
      `SELECT id, file_path, file_name FROM deliverables
       WHERE access_token = $1 AND released_at IS NOT NULL`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: "Documento não encontrado" });
    recordAccess(req, rows[0].id, "download");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return sendStoredFile(res, rows[0], "inline");
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ---------------------------------------------------------------------------
// A partir daqui, tudo exige sessão.
// ---------------------------------------------------------------------------

router.use(authMiddleware);

/** Upload manual do escritório (contratos, relatórios, folha fora do fluxo automático). */
router.post("/", adminOnly, uploadPdf.single("file"), async (req, res) => {
  try {
    const { company_id, category, doc_type, title, competencia, due_date } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "Arquivo obrigatório" });
    if (!validateUUID(company_id || "")) return res.status(400).json({ error: "company_id inválido" });
    if (!isCategory(category)) {
      return res.status(400).json({ error: `category deve ser: ${CATEGORIES.join(", ")}` });
    }
    if (!validateString(title || "", 1, 200)) return res.status(400).json({ error: "Título inválido" });
    if (competencia && !isCompetencia(competencia)) {
      return res.status(400).json({ error: "competencia deve estar no formato AAAA-MM" });
    }
    if (due_date && !validateDate(due_date)) return res.status(400).json({ error: "due_date inválida" });
    if (doc_type && !validateString(doc_type, 1, 40)) return res.status(400).json({ error: "doc_type inválido" });

    const company = await db.query("SELECT id FROM companies WHERE id = $1", [company_id]);
    if (!company.rows.length) {
      removeUploadFile(file.filename);
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Guia/boleto sem data informada: tenta ler do próprio PDF. Se não achar com
    // confiança, fica sem vencimento (não entra no calendário) e o admin corrige.
    let dueDate = due_date || null;
    let dueDateFromPdf = false;
    if (!dueDate && (category === "guia" || category === "boleto")) {
      const fullPath = resolveUploadPath(file.filename);
      if (fullPath) {
        const lido = await extrairVencimento(fs.readFileSync(fullPath));
        if (lido) {
          dueDate = lido;
          dueDateFromPdf = true;
        }
      }
    }

    // Envio manual do escritório já nasce liberado: o admin subiu de propósito,
    // não precisa de um segundo passo de liberação.
    const { rows } = await db.query(
      `INSERT INTO deliverables
         (company_id, category, doc_type, title, competencia, due_date,
          file_path, file_name, source, access_token, released_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9, now())
       RETURNING ${FIELDS}`,
      [
        company_id,
        category,
        doc_type || null,
        title.trim(),
        competencia || null,
        dueDate,
        file.filename,
        file.originalname,
        crypto.randomBytes(24).toString("hex"),
      ]
    );
    res.status(201).json({ ...rows[0], due_date_from_pdf: dueDateFromPdf });
  } catch (err) {
    console.error(err);
    if (req.file) removeUploadFile(req.file.filename);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/calendar", async (req, res) => {
  try {
    if (!req.isAdmin && !companyHasTool(req, "calendar")) {
      return res.status(403).json({ error: "Calendário não está ativo para a sua empresa." });
    }
    const { from, to } = req.query;
    if (from && !validateDate(from)) return res.status(400).json({ error: "from inválido" });
    if (to && !validateDate(to)) return res.status(400).json({ error: "to inválido" });

    const cats = allowedCategories(req);
    if (!cats.length) return res.json([]);

    const params = [cats];
    let sql = `SELECT ${FIELDS} FROM deliverables
               WHERE due_date IS NOT NULL AND category = ANY($1)${onlyReleased(req)}`;

    if (req.isAdmin) {
      const cid = (req.query.company_id || "").toString();
      if (cid) {
        if (!validateUUID(cid)) return res.status(400).json({ error: "company_id inválido" });
        params.push(cid);
        sql += ` AND company_id = $${params.length}`;
      }
    } else {
      params.push(req.company.id);
      sql += ` AND company_id = $${params.length}`;
    }
    if (from) {
      params.push(from);
      sql += ` AND due_date >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      sql += ` AND due_date <= $${params.length}`;
    }
    sql += " ORDER BY due_date ASC";

    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/upcoming", async (req, res) => {
  try {
    if (!req.isAdmin && !companyHasTool(req, "calendar")) {
      return res.status(403).json({ error: "Calendário não está ativo para a sua empresa." });
    }
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const cats = allowedCategories(req);
    if (!cats.length) return res.json([]);

    // Inclui as vencidas de propósito: "o que pagar a seguir" começa pelo que já está
    // atrasado. Mas EXCLUI a carga histórica: documento trazido para o cliente ter o
    // arquivo não é dívida. Sem este filtro, puxar de janeiro encheria a tela de
    // "atrasados" que ninguém deve pagar — e o cliente não teria como distinguir.
    const params = [cats];
    let sql = `SELECT ${FIELDS} FROM deliverables
               WHERE due_date IS NOT NULL AND status = 'pending'
                 AND historico IS NOT TRUE
                 AND category = ANY($1)${onlyReleased(req)}`;

    if (req.isAdmin) {
      const cid = (req.query.company_id || "").toString();
      if (cid) {
        if (!validateUUID(cid)) return res.status(400).json({ error: "company_id inválido" });
        params.push(cid);
        sql += ` AND company_id = $${params.length}`;
      }
    } else {
      params.push(req.company.id);
      sql += ` AND company_id = $${params.length}`;
    }
    params.push(limit);
    sql += ` ORDER BY due_date ASC LIMIT $${params.length}`;

    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { category, competencia, status, from, to } = req.query;
    const cats = allowedCategories(req);
    if (!cats.length) {
      return res.status(403).json({ error: "Nenhuma seção de entregas está ativa para a sua empresa." });
    }
    if (category) {
      if (!isCategory(category)) return res.status(400).json({ error: "category inválida" });
      if (!cats.includes(category)) {
        return res.status(403).json({ error: "Esta seção não está ativa para a sua empresa." });
      }
    }
    if (competencia && !isCompetencia(competencia)) {
      return res.status(400).json({ error: "competencia deve estar no formato AAAA-MM" });
    }
    if (status && !STATUSES.includes(status)) return res.status(400).json({ error: "status inválido" });
    if (from && !validateDate(from)) return res.status(400).json({ error: "from inválido" });
    if (to && !validateDate(to)) return res.status(400).json({ error: "to inválido" });

    const params = [category ? [category] : cats];
    let sql = `SELECT ${FIELDS} FROM deliverables WHERE category = ANY($1)${onlyReleased(req)}`;

    if (req.isAdmin) {
      const cid = (req.query.company_id || "").toString();
      if (cid) {
        if (!validateUUID(cid)) return res.status(400).json({ error: "company_id inválido" });
        params.push(cid);
        sql += ` AND company_id = $${params.length}`;
      }
    } else {
      params.push(req.company.id);
      sql += ` AND company_id = $${params.length}`;
    }
    if (competencia) {
      params.push(competencia);
      sql += ` AND competencia = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    if (from) {
      params.push(from);
      sql += ` AND due_date >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      sql += ` AND due_date <= $${params.length}`;
    }
    sql += " ORDER BY due_date DESC NULLS LAST, created_at DESC";

    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/:id/file", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });

    const params = [req.params.id];
    let sql = "SELECT id, category, file_path, file_name, pdf_url FROM deliverables WHERE id = $1";
    if (!req.isAdmin) {
      params.push(req.company.id);
      sql += ` AND company_id = $${params.length}${onlyReleased(req)}`;
    }
    const { rows } = await db.query(sql, params);
    // 404 (e não 403) quando é de outra empresa: não revela que o id existe.
    if (!rows.length) return res.status(404).json({ error: "Documento não encontrado" });
    if (!req.isAdmin && !companyHasTool(req, toolForCategory(rows[0].category))) {
      return res.status(403).json({ error: "Esta seção não está ativa para a sua empresa." });
    }
    // Download do próprio cliente também conta como abertura; o do admin não polui os números.
    if (!req.isAdmin) recordAccess(req, rows[0].id, "download");

    // Boletos Cora: sem arquivo local, redirecionar para a URL pública do PDF
    if (rows[0].pdf_url && (!rows[0].file_path || !resolveUploadPath(rows[0].file_path) || !fs.existsSync(resolveUploadPath(rows[0].file_path) || ""))) {
      return res.redirect(302, rows[0].pdf_url);
    }

    return sendStoredFile(res, rows[0], "inline");
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Marcar pago / voltar a pendente. */
router.patch("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `status deve ser: ${STATUSES.join(" ou ")}` });
    }

    // Boletos Cora: status é controlado exclusivamente pela sync — cliente não marca.
    if (!req.isAdmin) {
      const { rows: check } = await db.query(
        "SELECT source FROM deliverables WHERE id = $1",
        [req.params.id]
      );
      if (check.length && check[0].source === "cora") {
        return res.status(403).json({ error: "O status deste boleto é atualizado automaticamente pela Cora." });
      }
    }

    const paidAt = status === "paid" ? "now()" : "NULL";

    const params = [status, req.params.id];
    let sql = `UPDATE deliverables SET status = $1, paid_at = ${paidAt} WHERE id = $2`;
    if (!req.isAdmin) {
      params.push(req.company.id);
      sql += ` AND company_id = $${params.length}${onlyReleased(req)}`;
    }
    sql += ` RETURNING ${FIELDS}`;

    const { rows } = await db.query(sql, params);
    if (!rows.length) return res.status(404).json({ error: "Documento não encontrado" });
    if (!req.isAdmin && !companyHasTool(req, toolForCategory(rows[0].category))) {
      return res.status(403).json({ error: "Esta seção não está ativa para a sua empresa." });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });

    const params = [req.params.id];
    let sql = "DELETE FROM deliverables WHERE id = $1";
    if (!req.isAdmin) {
      params.push(req.company.id);
      sql += ` AND company_id = $${params.length}`;
    }
    sql += " RETURNING file_path";

    const { rows } = await db.query(sql, params);
    if (!rows.length) return res.status(404).json({ error: "Documento não encontrado" });
    removeUploadFile(rows[0].file_path);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Erros do multer (tamanho, tipo) viram 400 legível em vez de 500. */
router.use((err, req, res, next) => {
  if (!err) return next();
  if (req.file) removeUploadFile(req.file.filename);
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "Arquivo muito grande (máx 10MB)" : err.message;
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  return res.status(400).json({ error: err.message || "Falha no envio do arquivo" });
});

module.exports = router;
