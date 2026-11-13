/**
 * Link avulso de advertência e suspensão (sem login) — `/api/dp-avulso`.
 * Regras e modelo de proteção em ../dpAvulso.js.
 *
 *   GET  /empresa?cnpj=  → { encontrada, nome, escala_12x36, advertencia, suspensao }
 *   POST /emitir         → multipart: `dados` (JSON) + `file` (DOCX gerado na tela)
 */
const router = require("express").Router();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { UPLOAD_DIR } = require("../uploads");
const { isSmtpConfigured, createTransport, getPublicAppUrl } = require("../mailer");
const { configurado: whatsappConfigurado, enviarTexto } = require("../uazapi");
const { validarEmissao, ferramentasDaEmpresa, digitos } = require("../dpAvulso");

const ADMIN_EMAIL = process.env.DP_EMAIL || "dp@nesconcontabilidade.com.br";
const ADMIN_WHATSAPP = (process.env.ADMIN_WHATSAPP || "5511948626605").replace(/\D/g, "");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

const limiteConsulta = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas consultas. Aguarde alguns minutos." },
});

const limiteEmissao = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitos documentos em pouco tempo. Aguarde alguns minutos." },
});

router.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store, private");
  next();
});

async function empresaPorCnpj(cnpj) {
  const { rows } = await db.query(
    `SELECT id, name, cnpj, escala_12x36, tool_access FROM companies
      WHERE regexp_replace(cnpj, '[^0-9]', '', 'g') = $1
        AND COALESCE(arquivada, false) = false
        AND COALESCE(excluida, false) = false
      LIMIT 1`,
    [cnpj]
  );
  return rows[0] || null;
}

router.get("/empresa", limiteConsulta, async (req, res) => {
  try {
    const cnpj = digitos(req.query.cnpj);
    if (cnpj.length !== 14) return res.status(400).json({ error: "CNPJ inválido." });
    const empresa = await empresaPorCnpj(cnpj);
    if (!empresa) return res.json({ encontrada: false });
    const f = ferramentasDaEmpresa(empresa.tool_access);
    return res.json({
      encontrada: true,
      nome: empresa.name,
      escala_12x36: Boolean(empresa.escala_12x36),
      advertencia: f.advertencia,
      suspensao: f.suspensao,
    });
  } catch (err) {
    console.error("[dp-avulso] empresa:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

function gravarDocx(buffer, nome) {
  const seguro = String(nome).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const arquivo = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${seguro}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, arquivo), buffer);
  return arquivo;
}

function ehDocx(file) {
  // DOCX é um ZIP: começa com "PK\x03\x04". Barra qualquer outro arquivo no upload público.
  return Boolean(file && file.buffer && file.buffer.length > 4 && file.buffer.readUInt32LE(0) === 0x04034b50);
}

router.post("/emitir", limiteEmissao, uploadMem.single("file"), async (req, res) => {
  try {
    let corpo = {};
    try {
      corpo = JSON.parse(String(req.body?.dados || "{}"));
    } catch {
      return res.status(400).json({ error: "Dados inválidos." });
    }
    const d = validarEmissao(corpo);
    if (d.erro) return res.status(400).json({ error: d.erro });
    if (!ehDocx(req.file)) return res.status(400).json({ error: "Documento não recebido. Tente gerar de novo." });

    const empresa = await empresaPorCnpj(d.cnpj);
    if (!empresa) return res.status(404).json({ error: "Empresa não encontrada no cadastro da Nescon." });
    const f = ferramentasDaEmpresa(empresa.tool_access);
    const ehSuspensao = d.tipo === "suspension";
    if (ehSuspensao ? !f.suspensao : !f.advertencia) {
      return res.status(403).json({
        error: `${ehSuspensao ? "Suspensão" : "Advertência"} não está liberada para esta empresa. Fale com a Nescon.`,
      });
    }

    const nomeArquivo = req.file.originalname || `${ehSuspensao ? "suspensao" : "advertencia"}.docx`;
    const arquivo = gravarDocx(req.file.buffer, nomeArquivo);
    const token = crypto.randomBytes(24).toString("hex");
    const ip = String(req.ip || "").slice(0, 60);
    const descricao = ehSuspensao
      ? `Suspensão de ${d.dias} dia(s): ${d.motivo}`.slice(0, 2000)
      : d.motivo;

    const { rows } = await db.query(
      `INSERT INTO issued_documents
         (document_type, employee_name, employee_cpf, company_name, company_cnpj, company_id,
          start_date, suspension_days, return_date, description, file_docx, access_token, origem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'link_avulso')
       RETURNING id`,
      [d.tipo, d.funcionario, d.cpf, empresa.name, empresa.cnpj, empresa.id,
       d.data, d.dias, d.retorno, descricao, arquivo, token]
    );
    console.log(`[dp-avulso] ${d.tipo} emitida para ${empresa.cnpj} (ip ${ip}) id ${rows[0].id}`);

    const tipo = ehSuspensao ? "Suspensão" : "Advertência";
    const base = getPublicAppUrl() || "";
    const linkDocx = base ? `${base}/api/dp-docs/${token}/docx` : "";

    if (whatsappConfigurado() && ADMIN_WHATSAPP) {
      const texto =
        `📋 ${tipo} gerada pelo link avulso\nEmpresa: ${empresa.name}\nFuncionário: ${d.funcionario}` +
        (ehSuspensao ? `\nPeríodo: ${d.dias} dia(s), retorno ${d.retorno.split("-").reverse().join("/")}` : "") +
        (linkDocx ? `\n\nDocumento: ${linkDocx}` : "");
      enviarTexto({ numero: ADMIN_WHATSAPP, texto, delayMs: 1000 }).catch(() => {});
    }

    // Só o escritório recebe por e-mail: o link é público, então não dispara e-mail para
    // o cadastro da empresa (evita que alguém use a tela para mandar mensagens a ela).
    if (isSmtpConfigured()) {
      createTransport()
        .sendMail({
          from: process.env.SMTP_FROM,
          to: ADMIN_EMAIL,
          subject: `${tipo} (link avulso) — ${d.funcionario} (${empresa.name})`,
          html: `
            <p><strong>${tipo}</strong> gerada pelo link avulso (sem login).</p>
            <p>Empresa: ${escapeHtml(empresa.name)}<br>
            Funcionário: ${escapeHtml(d.funcionario)}${d.cpf ? ` (CPF: ${d.cpf})` : ""}</p>
            <p>Data: ${d.data}${ehSuspensao ? ` · ${d.dias} dia(s) · retorno ${d.retorno}` : ""}</p>
            <p>IP de origem: ${escapeHtml(ip)}</p>
            <p>O documento segue em anexo.</p>`,
          attachments: [{ filename: nomeArquivo.replace(/[^\w.\- ]/g, "_"), content: req.file.buffer, contentType: DOCX_MIME }],
        })
        .catch((err) => console.error("[dp-avulso] e-mail:", err.message));
    }

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[dp-avulso] emitir:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = router;
