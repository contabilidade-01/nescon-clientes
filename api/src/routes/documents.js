const router = require("express").Router();
const db = require("../db");
const { authMiddleware, requireCompanyUser } = require("../middleware/auth");
const { adminHasArea } = require("../middleware/adminArea");
const { companyHasTool } = require("../middleware/companyToolAccess");
const { validateString, validateUUID, validateDate } = require("../middleware/validate");
const { isSmtpConfigured, createTransport, getPublicAppUrl } = require("../mailer");
const { configurado: whatsappConfigurado, enviarTexto } = require("../uazapi");
const multer = require("multer");

const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const ADMIN_EMAIL = process.env.DP_EMAIL || "dp@nesconcontabilidade.com.br";
const ADMIN_WHATSAPP = (process.env.ADMIN_WHATSAPP || "5511948626605").replace(/\D/g, "");

router.use(authMiddleware);

/** Front envia warning/suspension; API aceita também advertencia/suspensao (legado). */
const DOC_TYPE_ALIASES = {
  warning: "warning",
  suspension: "suspension",
  advertencia: "warning",
  suspensao: "suspension",
};

router.get("/", async (req, res) => {
  try {
    if (req.isAdmin) {
      if (!adminHasArea(req, "entregas")) {
        return res.status(403).json({ error: "Você não tem acesso a esta área do painel" });
      }
      const filterId = (req.query.company_id || "").toString();
      if (filterId) {
        if (!validateUUID(filterId)) {
          return res.status(400).json({ error: "company_id inválido" });
        }
        const { rows } = await db.query(
          "SELECT * FROM issued_documents WHERE company_id = $1 ORDER BY created_at DESC",
          [filterId]
        );
        return res.json(rows);
      }
      const { rows } = await db.query(
        "SELECT * FROM issued_documents ORDER BY created_at DESC"
      );
      return res.json(rows);
    }
    if (!req.company?.id) {
      return res.status(403).json({ error: "Sessão de empresa inválida" });
    }
    if (!companyHasTool(req, "history")) {
      return res.status(403).json({ error: "Histórico de documentos não está ativo para a sua empresa." });
    }
    const companyId = req.company.id;
    const { rows } = await db.query(
      "SELECT * FROM issued_documents WHERE company_id = $1 ORDER BY created_at DESC",
      [companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/", requireCompanyUser, async (req, res) => {
  try {
    const companyId = req.company.id;
    const d = req.body;

    const normalizedType = DOC_TYPE_ALIASES[d.document_type];
    if (!normalizedType) {
      return res.status(400).json({ error: "Tipo de documento inválido" });
    }
    if (normalizedType === "suspension" && !companyHasTool(req, "suspension")) {
      return res.status(403).json({ error: "Suspensão não está ativa para a sua empresa." });
    }
    if (normalizedType === "warning" && !companyHasTool(req, "warning")) {
      return res.status(403).json({ error: "Advertência não está ativa para a sua empresa." });
    }
    if (!validateString(d.employee_name, 2, 200)) {
      return res.status(400).json({ error: "Nome do funcionário inválido" });
    }
    if (!validateString(d.employee_cpf, 11, 14)) {
      return res.status(400).json({ error: "CPF do funcionário inválido" });
    }
    if (d.start_date && !validateDate(d.start_date)) {
      return res.status(400).json({ error: "Data de início inválida" });
    }
    if (d.description && !validateString(d.description, 1, 2000)) {
      return res.status(400).json({ error: "Descrição muito longa (máx 2000 caracteres)" });
    }

    const { rows } = await db.query(
      `INSERT INTO issued_documents
        (document_type, employee_name, employee_cpf, employee_pis, company_name, company_cnpj, company_id, start_date, suspension_days, return_date, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [normalizedType, d.employee_name.trim(), d.employee_cpf.replace(/\D/g, ""),
       d.employee_pis || null, req.company.name, req.company.cnpj, companyId,
       d.start_date || null, d.suspension_days || null, d.return_date || null, d.description || null]
    );

    // Alerta WhatsApp ao admin
    if (whatsappConfigurado() && ADMIN_WHATSAPP) {
      const tipo = normalizedType === "suspension" ? "Suspensão" : "Advertência";
      const texto = `📋 ${tipo} gerada\nEmpresa: ${req.company.name}\nFuncionário: ${d.employee_name}\n\nAbrir: ${getPublicAppUrl()}/admin`;
      enviarTexto({ numero: ADMIN_WHATSAPP, texto, delayMs: 1000 }).catch(() => {});
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) {
      return res.status(400).json({ error: "ID inválido" });
    }
    if (req.isAdmin) {
      if (!adminHasArea(req, "entregas")) {
        return res.status(403).json({ error: "Você não tem acesso a esta área do painel" });
      }
      const { rowCount } = await db.query("DELETE FROM issued_documents WHERE id=$1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Documento não encontrado" });
      return res.json({ ok: true });
    }
    if (!companyHasTool(req, "history")) {
      return res.status(403).json({ error: "Histórico de documentos não está ativo para a sua empresa." });
    }
    const companyId = req.company.id;
    const { rowCount } = await db.query(
      "DELETE FROM issued_documents WHERE id=$1 AND company_id=$2",
      [req.params.id, companyId]
    );
    if (!rowCount) return res.status(404).json({ error: "Documento não encontrado" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * POST /documents/:id/enviar-email — recebe o DOCX gerado pelo frontend e envia
 * por e-mail para o admin (dp@) e para o e-mail da empresa (se houver).
 */
router.post("/:id/enviar-email", requireCompanyUser, uploadMem.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Envie o arquivo DOCX" });
  if (!isSmtpConfigured()) return res.status(503).json({ error: "E-mail não configurado no servidor" });

  try {
    const { rows } = await db.query(
      "SELECT * FROM issued_documents WHERE id = $1 AND company_id = $2",
      [req.params.id, req.company.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Documento não encontrado" });
    const doc = rows[0];

    const tipo = doc.document_type === "suspension" ? "Suspensão" : "Advertência";
    const subject = `${tipo} — ${doc.employee_name} (${req.company.name})`;

    const destinatarios = [ADMIN_EMAIL];
    // E-mail da empresa (se cadastrado)
    const { rows: emp } = await db.query(
      "SELECT contact_email FROM companies WHERE id = $1",
      [req.company.id]
    );
    if (emp[0]?.contact_email) destinatarios.push(emp[0].contact_email);

    const transport = createTransport();
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: destinatarios.join(", "),
      subject,
      html: `
        <p><strong>${tipo}</strong> gerada pelo portal.</p>
        <p>Empresa: ${req.company.name}<br>
        Funcionário: ${doc.employee_name} (CPF: ${doc.employee_cpf})</p>
        <p>Data: ${doc.start_date || "—"}${doc.suspension_days ? ` · ${doc.suspension_days} dia(s)` : ""}</p>
        <p>O documento segue em anexo.</p>
      `,
      attachments: [{
        filename: req.file.originalname || `${tipo.toLowerCase()}.docx`,
        content: req.file.buffer,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }],
    });

    res.json({ ok: true, enviado_para: destinatarios });
  } catch (err) {
    console.error("[documents] enviar-email:", err.message);
    res.status(500).json({ error: "Erro ao enviar e-mail" });
  }
});

module.exports = router;
