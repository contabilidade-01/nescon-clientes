const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const db = require("../db");
const { authMiddleware, requireCompanyUser } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const {
  validateCNPJ,
  validateUUID,
  validateEmailFormat,
  validateString,
} = require("../middleware/validate");
const { getPublicAppUrl } = require("../mailer");
const { configurado: whatsappConfigurado, enviarTexto } = require("../uazapi");
const { uploadAny, resolveUploadPath, removeUploadFile, UPLOAD_DIR } = require("../uploads");
const { sanitizeDados, funcionarioNome } = require("../admissionSanitize");

const ADMIN_WHATSAPP = (process.env.ADMIN_WHATSAPP || "5511948626605").replace(/\D/g, "");

const router = express.Router();
const adminRouter = express.Router();

const rateHits = new Map();
function rateLimitPublic(req, res, next) {
  const ip = (req.ip || req.headers["x-forwarded-for"] || "unknown").toString().split(",")[0].trim();
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 20;
  const rec = rateHits.get(ip);
  if (!rec || now - rec.start > windowMs) {
    rateHits.set(ip, { start: now, n: 1 });
    return next();
  }
  rec.n += 1;
  if (rec.n > max) {
    return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
  }
  next();
}

function digits(val) {
  return String(val || "").replace(/\D/g, "");
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function tokenOk(stored, given) {
  const a = Buffer.from(String(stored || ""));
  const b = Buffer.from(String(given || ""));
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

async function findCompanyByCnpj(cnpjDigits) {
  const { rows } = await db.query(
    `SELECT id, name, cnpj FROM companies
     WHERE regexp_replace(cnpj, '[^0-9]', '', 'g') = $1
       AND COALESCE(arquivada, false) = false
       AND COALESCE(excluida, false) = false
     LIMIT 1`,
    [cnpjDigits]
  );
  return rows[0] || null;
}

function origemLabel(origem) {
  if (origem === "portal") return "Portal (logado)";
  if (origem === "publico_cliente") return "Público (cliente)";
  return "Público (fora da carteira)";
}

function avisarAdmin({ origem, empresaNome, empresaCnpj, funcionario, formId }) {
  if (!whatsappConfigurado() || !ADMIN_WHATSAPP) return;
  const texto =
    `Ficha de admissão nova\n` +
    `Origem: ${origemLabel(origem)}\n` +
    `Empresa: ${empresaNome}\n` +
    `CNPJ: ${empresaCnpj}\n` +
    `Funcionário: ${funcionario}\n\n` +
    `Abrir: ${getPublicAppUrl()}/admin/admissoes`;
  enviarTexto({ numero: ADMIN_WHATSAPP, texto, delayMs: 1000 }).catch(() => {});
  void formId;
}

function listRow(r) {
  const dados = r.dados && typeof r.dados === "object" ? r.dados : {};
  return {
    id: r.id,
    company_id: r.company_id,
    origem: r.origem,
    status: r.status,
    empresa_cnpj: r.empresa_cnpj,
    empresa_nome: r.empresa_nome,
    contato_email: r.contato_email,
    contato_telefone: r.contato_telefone,
    funcionario_nome: funcionarioNome(dados),
    created_at: r.created_at,
    updated_at: r.updated_at,
    anexos_count: Number(r.anexos_count || 0),
  };
}

function detailPayload(row, anexos, { includeToken = false } = {}) {
  return {
    id: row.id,
    company_id: row.company_id,
    origem: row.origem,
    status: row.status,
    empresa_cnpj: row.empresa_cnpj,
    empresa_nome: row.empresa_nome,
    contato_email: row.contato_email,
    contato_telefone: row.contato_telefone,
    dados: row.dados,
    created_at: row.created_at,
    updated_at: row.updated_at,
    anexos: (anexos || []).map((a) => ({
      id: a.id,
      file_name: a.file_name,
      created_at: a.created_at,
      kind: a.kind || null,
    })),
    ...(includeToken ? { edit_token: row.edit_token } : {}),
  };
}

async function anexosOf(formId) {
  const { rows } = await db.query(
    "SELECT id, file_name, kind, created_at FROM admission_anexos WHERE form_id = $1 ORDER BY created_at",
    [formId]
  );
  return rows;
}

const KINDS_OK = new Set([
  "docCtps",
  "docAso",
  "docCpf",
  "docRg",
  "docComprovante",
  "docPis",
  "docFoto",
  "docCopias",
  "docReservistaCopia",
  "docCertidaoCivil",
  "filhoCertidao",
  "filhoVacina",
  "filhoEscolaridade",
]);

function anexoMimeOk(file) {
  const mt = (file.mimetype || "").toLowerCase();
  const name = file.originalname || "";
  if (mt === "application/pdf" || /\.pdf$/i.test(name)) return true;
  if (mt.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(name)) return true;
  return false;
}

function pastaRelativa(form) {
  const emp = form.company_id
    ? `empresas/${form.company_id}`
    : `externo/${digits(form.empresa_cnpj) || "sem-cnpj"}`;
  return `admissao/${emp}/${form.id}`;
}

async function gravarAnexos(form, files) {
  const saved = [];
  const dirRel = pastaRelativa(form);
  const dirAbs = path.join(UPLOAD_DIR, dirRel);
  fs.mkdirSync(dirAbs, { recursive: true });

  for (const file of files || []) {
    const kind = String(file.fieldname || "").trim();
    if (!KINDS_OK.has(kind) || !anexoMimeOk(file)) {
      removeUploadFile(file.filename);
      const err = new Error("Anexo inválido. Envie PDF ou imagem no item correspondente.");
      err.status = 400;
      throw err;
    }
    const destName = `${kind}-${path.basename(file.filename)}`;
    const rel = `${dirRel}/${destName}`.replace(/\\/g, "/");
    const destAbs = path.join(UPLOAD_DIR, rel);
    try {
      fs.renameSync(path.join(UPLOAD_DIR, file.filename), destAbs);
    } catch {
      removeUploadFile(file.filename);
      const err = new Error("Não foi possível gravar o arquivo na pasta da empresa.");
      err.status = 400;
      throw err;
    }

    const antigos = await db.query(
      "SELECT id, file_path FROM admission_anexos WHERE form_id = $1 AND kind = $2",
      [form.id, kind]
    );
    for (const a of antigos.rows) {
      removeUploadFile(a.file_path);
      await db.query("DELETE FROM admission_anexos WHERE id = $1", [a.id]);
    }

    const { rows } = await db.query(
      `INSERT INTO admission_anexos (form_id, file_path, file_name, kind)
       VALUES ($1, $2, $3, $4) RETURNING id, file_name, kind, created_at`,
      [form.id, rel, file.originalname || destName, kind]
    );
    saved.push(rows[0]);
  }
  return saved;
}

async function sendAnexoFile(res, formId, anexoId) {
  const { rows } = await db.query(
    "SELECT file_path, file_name FROM admission_anexos WHERE id = $1 AND form_id = $2",
    [anexoId, formId]
  );
  if (!rows.length) return res.status(404).json({ error: "Anexo não encontrado" });
  const full = resolveUploadPath(rows[0].file_path);
  if (!full || !fs.existsSync(full)) return res.status(404).json({ error: "Arquivo ausente" });
  res.setHeader("Content-Disposition", `attachment; filename="${path.basename(rows[0].file_name || "anexo")}"`);
  return res.sendFile(full);
}

async function parseBodyEmpresa(body, { requireContactIfExternal }) {
  const cnpj = digits(body.empresa_cnpj);
  if (!validateCNPJ(cnpj)) {
    return { error: "CNPJ da empresa inválido" };
  }
  const company = await findCompanyByCnpj(cnpj);
  let empresaNome = validateString(body.empresa_nome, 2, 200)
    ? body.empresa_nome.trim()
    : company
      ? company.name
      : "";
  if (!empresaNome) return { error: "Informe a razão social da empresa" };

  const email = (body.contato_email || "").trim();
  const telefone = clipPhone(body.contato_telefone);

  if (!company && requireContactIfExternal) {
    if (!validateEmailFormat(email)) {
      return { error: "E-mail da empresa é obrigatório para quem ainda não é cliente" };
    }
    if (telefone.replace(/\D/g, "").length < 10) {
      return { error: "Telefone da empresa é obrigatório para quem ainda não é cliente" };
    }
  }

  return {
    cnpj,
    empresaNome,
    company,
    email: email || null,
    telefone: telefone || null,
  };
}

function clipPhone(val) {
  return String(val || "").trim().slice(0, 30);
}

function requireCampos(dados) {
  if (!validateString(dados.nome, 2, 200)) {
    return "Nome do funcionário é obrigatório";
  }
  if (!validateString(dados.localNascimento, 2, 200)) {
    return "Local de nascimento é obrigatório";
  }
  if (!validateString(dados.pai, 2, 200) || !validateString(dados.mae, 2, 200)) {
    return "Filiação (pai e mãe) é obrigatória";
  }
  return null;
}

// ---------- público ----------

router.get("/lookup", rateLimitPublic, async (req, res) => {
  try {
    const cnpj = digits(req.query.cnpj);
    if (!validateCNPJ(cnpj)) {
      return res.status(400).json({ error: "CNPJ inválido" });
    }
    const company = await findCompanyByCnpj(cnpj);
    if (!company) return res.json({ encontrada: false });
    return res.json({ encontrada: true, nome: company.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/public", rateLimitPublic, async (req, res) => {
  try {
    const parsed = await parseBodyEmpresa(req.body, { requireContactIfExternal: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const dados = sanitizeDados(req.body.dados);
    const nomeErr = requireCampos(dados);
    if (nomeErr) return res.status(400).json({ error: nomeErr });

    const origem = parsed.company ? "publico_cliente" : "publico_externo";
    const token = newToken();
    const { rows } = await db.query(
      `INSERT INTO admission_forms
        (company_id, origem, edit_token, status, empresa_cnpj, empresa_nome, contato_email, contato_telefone, dados)
       VALUES ($1,$2,$3,'novo',$4,$5,$6,$7,$8::jsonb)
       RETURNING *`,
      [
        parsed.company ? parsed.company.id : null,
        origem,
        token,
        parsed.cnpj,
        parsed.empresaNome,
        parsed.email,
        parsed.telefone,
        JSON.stringify(dados),
      ]
    );
    const row = rows[0];
    avisarAdmin({
      origem,
      empresaNome: parsed.empresaNome,
      empresaCnpj: parsed.cnpj,
      funcionario: funcionarioNome(dados),
      formId: row.id,
    });
    res.status(201).json(detailPayload(row, [], { includeToken: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/public/:id", rateLimitPublic, async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query("SELECT * FROM admission_forms WHERE id = $1", [req.params.id]);
    if (!rows.length || !tokenOk(rows[0].edit_token, req.query.token)) {
      return res.status(404).json({ error: "Ficha não encontrada" });
    }
    const anexos = await anexosOf(rows[0].id);
    res.json(detailPayload(rows[0], anexos, { includeToken: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/public/:id", rateLimitPublic, async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query("SELECT * FROM admission_forms WHERE id = $1", [req.params.id]);
    if (!rows.length || !tokenOk(rows[0].edit_token, req.body.edit_token)) {
      return res.status(404).json({ error: "Ficha não encontrada" });
    }
    const parsed = await parseBodyEmpresa(req.body, { requireContactIfExternal: !rows[0].company_id });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const dados = sanitizeDados(req.body.dados);
    const nomeErr = requireCampos(dados);
    if (nomeErr) return res.status(400).json({ error: nomeErr });

    const companyId = parsed.company ? parsed.company.id : rows[0].company_id;
    const origem = companyId
      ? rows[0].origem === "portal"
        ? "portal"
        : "publico_cliente"
      : "publico_externo";

    const upd = await db.query(
      `UPDATE admission_forms SET
         company_id = $1, origem = $2, empresa_cnpj = $3, empresa_nome = $4,
         contato_email = $5, contato_telefone = $6, dados = $7::jsonb, updated_at = now()
       WHERE id = $8 RETURNING *`,
      [
        companyId,
        origem,
        parsed.cnpj,
        parsed.empresaNome,
        parsed.email || rows[0].contato_email,
        parsed.telefone || rows[0].contato_telefone,
        JSON.stringify(dados),
        rows[0].id,
      ]
    );
    const anexos = await anexosOf(upd.rows[0].id);
    res.json(detailPayload(upd.rows[0], anexos, { includeToken: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/public/:id/anexos", rateLimitPublic, uploadAny.any(), async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const token = req.body.edit_token || req.query.token;
    const { rows } = await db.query("SELECT * FROM admission_forms WHERE id = $1", [req.params.id]);
    if (!rows.length || !tokenOk(rows[0].edit_token, token)) {
      (req.files || []).forEach((f) => removeUploadFile(f.filename));
      return res.status(404).json({ error: "Ficha não encontrada" });
    }
    const saved = await gravarAnexos(rows[0], req.files);
    res.status(201).json({ anexos: saved });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/public/:id/anexos/:anexoId/file", rateLimitPublic, async (req, res) => {
  try {
    if (!validateUUID(req.params.id) || !validateUUID(req.params.anexoId)) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const { rows } = await db.query("SELECT * FROM admission_forms WHERE id = $1", [req.params.id]);
    if (!rows.length || !tokenOk(rows[0].edit_token, req.query.token)) {
      return res.status(404).json({ error: "Ficha não encontrada" });
    }
    await sendAnexoFile(res, req.params.id, req.params.anexoId);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ---------- empresa logada ----------

router.get("/", authMiddleware, requireCompanyUser, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT f.*, (SELECT COUNT(*) FROM admission_anexos a WHERE a.form_id = f.id) AS anexos_count
       FROM admission_forms f
       WHERE f.company_id = $1
       ORDER BY f.updated_at DESC`,
      [req.company.id]
    );
    res.json(rows.map(listRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/", authMiddleware, requireCompanyUser, async (req, res) => {
  try {
    const dados = sanitizeDados(req.body.dados);
    const nomeErr = requireCampos(dados);
    if (nomeErr) return res.status(400).json({ error: nomeErr });
    const cnpj = digits(req.body.empresa_cnpj) || digits(req.company.cnpj);
    const nome = validateString(req.body.empresa_nome, 2, 200)
      ? req.body.empresa_nome.trim()
      : req.company.name;
    const token = newToken();
    const { rows } = await db.query(
      `INSERT INTO admission_forms
        (company_id, origem, edit_token, status, empresa_cnpj, empresa_nome, contato_email, contato_telefone, dados)
       VALUES ($1,'portal',$2,'novo',$3,$4,$5,$6,$7::jsonb)
       RETURNING *`,
      [
        req.company.id,
        token,
        cnpj,
        nome,
        (req.body.contato_email || "").trim() || null,
        clipPhone(req.body.contato_telefone) || null,
        JSON.stringify(dados),
      ]
    );
    avisarAdmin({
      origem: "portal",
      empresaNome: nome,
      empresaCnpj: cnpj,
      funcionario: funcionarioNome(dados),
      formId: rows[0].id,
    });
    res.status(201).json(detailPayload(rows[0], [], { includeToken: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/:id", authMiddleware, requireCompanyUser, async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query(
      "SELECT * FROM admission_forms WHERE id = $1 AND company_id = $2",
      [req.params.id, req.company.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Ficha não encontrada" });
    const anexos = await anexosOf(rows[0].id);
    res.json(detailPayload(rows[0], anexos, { includeToken: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/:id", authMiddleware, requireCompanyUser, async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query(
      "SELECT * FROM admission_forms WHERE id = $1 AND company_id = $2",
      [req.params.id, req.company.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Ficha não encontrada" });
    const dados = sanitizeDados(req.body.dados);
    const nomeErr = requireCampos(dados);
    if (nomeErr) return res.status(400).json({ error: nomeErr });
    const cnpj = digits(req.body.empresa_cnpj) || digits(req.company.cnpj);
    const nome = validateString(req.body.empresa_nome, 2, 200)
      ? req.body.empresa_nome.trim()
      : req.company.name;
    const upd = await db.query(
      `UPDATE admission_forms SET
         empresa_cnpj = $1, empresa_nome = $2, contato_email = $3, contato_telefone = $4,
         dados = $5::jsonb, updated_at = now()
       WHERE id = $6 RETURNING *`,
      [
        cnpj,
        nome,
        (req.body.contato_email || "").trim() || rows[0].contato_email,
        clipPhone(req.body.contato_telefone) || rows[0].contato_telefone,
        JSON.stringify(dados),
        rows[0].id,
      ]
    );
    const anexos = await anexosOf(upd.rows[0].id);
    res.json(detailPayload(upd.rows[0], anexos, { includeToken: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/:id/anexos", authMiddleware, requireCompanyUser, uploadAny.any(), async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query(
      "SELECT * FROM admission_forms WHERE id = $1 AND company_id = $2",
      [req.params.id, req.company.id]
    );
    if (!rows.length) {
      (req.files || []).forEach((f) => removeUploadFile(f.filename));
      return res.status(404).json({ error: "Ficha não encontrada" });
    }
    const saved = await gravarAnexos(rows[0], req.files);
    res.status(201).json({ anexos: saved });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/:id/anexos/:anexoId/file", authMiddleware, requireCompanyUser, async (req, res) => {
  try {
    if (!validateUUID(req.params.id) || !validateUUID(req.params.anexoId)) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const { rows } = await db.query(
      "SELECT id FROM admission_forms WHERE id = $1 AND company_id = $2",
      [req.params.id, req.company.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Ficha não encontrada" });
    await sendAnexoFile(res, req.params.id, req.params.anexoId);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ---------- admin ----------

adminRouter.use(authMiddleware);
adminRouter.use(requireArea("funcionarios"));

adminRouter.get("/", async (req, res) => {
  try {
    const origem = (req.query.origem || "").toString();
    const status = (req.query.status || "").toString();
    const q = (req.query.q || "").toString().trim();
    const params = [];
    let sql = `SELECT f.*, (SELECT COUNT(*) FROM admission_anexos a WHERE a.form_id = f.id) AS anexos_count
               FROM admission_forms f WHERE 1=1`;
    if (origem === "portal" || origem === "publico_cliente" || origem === "publico_externo") {
      params.push(origem);
      sql += ` AND f.origem = $${params.length}`;
    }
    if (status === "novo" || status === "em_andamento" || status === "concluido") {
      params.push(status);
      sql += ` AND f.status = $${params.length}`;
    }
    if (q) {
      params.push(`%${q.replace(/%/g, "")}%`);
      sql += ` AND (f.empresa_nome ILIKE $${params.length} OR f.empresa_cnpj ILIKE $${params.length} OR f.dados->>'nome' ILIKE $${params.length})`;
    }
    sql += " ORDER BY f.created_at DESC LIMIT 300";
    const { rows } = await db.query(sql, params);
    res.json(rows.map(listRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query("SELECT * FROM admission_forms WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Ficha não encontrada" });
    const anexos = await anexosOf(rows[0].id);
    res.json(detailPayload(rows[0], anexos));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.patch("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const status = (req.body.status || "").toString();
    if (!["novo", "em_andamento", "concluido"].includes(status)) {
      return res.status(400).json({ error: "Status inválido" });
    }
    const { rows } = await db.query(
      `UPDATE admission_forms SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Ficha não encontrada" });
    const anexos = await anexosOf(rows[0].id);
    res.json(detailPayload(rows[0], anexos));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/:id/anexos/:anexoId/file", async (req, res) => {
  try {
    if (!validateUUID(req.params.id) || !validateUUID(req.params.anexoId)) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const { rows } = await db.query("SELECT id FROM admission_forms WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Ficha não encontrada" });
    await sendAnexoFile(res, req.params.id, req.params.anexoId);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = { router, adminRouter };
