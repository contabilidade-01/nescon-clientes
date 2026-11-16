/**
 * Certificado digital das empresas: validade e aviso de vencimento.
 *
 * - adminRouter (/api/admin/certificados): painel, área "licencas" (mesmo setor Fiscal).
 * - portalRouter (/api/certificado-digital): o cliente vê o seu e informa a renovação.
 *
 * Regras do estado em certificadoDigital.js — o painel, o portal e o aviso usam a mesma.
 */
const express = require("express");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID, validateString, validateDate } = require("../middleware/validate");
const numeroWpp = require("../whatsappNumero");
const {
  CERT_STATUSES,
  certWarnDays,
  certStatusSql,
  montarAvisoCertificado,
  lerCamposCertificado,
} = require("../certificadoDigital");

const validadores = { validateDate, validateString };

/** Empresas ativas com o certificado vigente (o de maior validade) e o estado calculado. */
function baseQuery() {
  return `
    WITH base AS (
      SELECT c.id AS company_id, c.name, c.cnpj,
             ${numeroWpp.celularSql("c", "g")} AS whatsapp,
             k.id AS certificado_id, k.tipo, k.titular, k.emissor, k.emitido_em, k.vence_em,
             k.observacao, k.origem, k.avisado_em, k.updated_at
        FROM companies c
        LEFT JOIN gclick_clients g ON g.company_id = c.id
        LEFT JOIN LATERAL (
          SELECT x.* FROM company_certificados x
           WHERE x.company_id = c.id
           ORDER BY x.vence_em DESC
           LIMIT 1
        ) k ON TRUE
       WHERE c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
    )
    SELECT base.*, ${certStatusSql("vence_em")} AS status,
           (vence_em - CURRENT_DATE) AS dias_restantes
      FROM base
  `;
}

// ---------------------------------------------------------------- painel
const adminRouter = express.Router();
adminRouter.use(authMiddleware);
adminRouter.use(requireArea("licencas"));

adminRouter.get("/overview", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT status, COUNT(*)::int AS n FROM (${baseQuery()}) q GROUP BY status`
    );
    const por_status = Object.fromEntries(CERT_STATUSES.map((s) => [s, 0]));
    for (const r of rows) por_status[r.status] = r.n;
    res.json({ dias_aviso: certWarnDays(), por_status });
  } catch (err) {
    console.error("[certificados overview]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/itens", async (req, res) => {
  try {
    const where = [];
    const vals = [];
    const { status, q } = req.query;
    if (status) {
      if (!CERT_STATUSES.includes(status)) return res.status(400).json({ error: "Estado inválido" });
      vals.push(status);
      where.push(`status = $${vals.length}`);
    }
    if (q && String(q).trim()) {
      vals.push(`%${String(q).trim()}%`);
      where.push(`(name ILIKE $${vals.length} OR cnpj ILIKE $${vals.length})`);
    }
    const { rows } = await db.query(
      `SELECT * FROM (${baseQuery()}) q
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY CASE status WHEN 'vencido' THEN 0 WHEN 'a_vencer' THEN 1 WHEN 'ausente' THEN 2 ELSE 3 END,
                 vence_em ASC NULLS LAST, name ASC`,
      vals
    );
    res.json(rows);
  } catch (err) {
    console.error("[certificados itens]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.post("/", async (req, res) => {
  try {
    const companyId = req.body?.company_id;
    if (!validateUUID(companyId)) return res.status(400).json({ error: "Selecione a empresa" });
    const c = lerCamposCertificado(req.body, validadores);
    if (c.erro) return res.status(400).json({ error: c.erro });
    const { rowCount } = await db.query("SELECT 1 FROM companies WHERE id = $1", [companyId]);
    if (!rowCount) return res.status(404).json({ error: "Empresa não encontrada" });
    const { rows } = await db.query(
      `INSERT INTO company_certificados (company_id, tipo, titular, emissor, emitido_em, vence_em, observacao, origem)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'escritorio') RETURNING *`,
      [companyId, c.tipo, c.titular, c.emissor, c.emitido, c.vence, c.observacao]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[certificados criar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const c = lerCamposCertificado(req.body, validadores);
    if (c.erro) return res.status(400).json({ error: c.erro });
    const { rows, rowCount } = await db.query(
      `UPDATE company_certificados
          SET tipo = $1, titular = $2, emissor = $3, emitido_em = $4, vence_em = $5,
              observacao = $6, updated_at = now()
        WHERE id = $7 RETURNING *`,
      [c.tipo, c.titular, c.emissor, c.emitido, c.vence, c.observacao, id]
    );
    if (!rowCount) return res.status(404).json({ error: "Certificado não encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[certificados editar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const { rowCount } = await db.query("DELETE FROM company_certificados WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Certificado não encontrado" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[certificados apagar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * POST /avisar/:companyId — manda o aviso de vencimento pelo WhatsApp da empresa.
 * Só sai quando alguém do escritório clica: nada é enviado sozinho.
 */
adminRouter.post("/avisar/:companyId", requireArea("alertas"), async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!validateUUID(companyId)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query(`SELECT * FROM (${baseQuery()}) q WHERE company_id = $1`, [companyId]);
    const item = rows[0];
    if (!item) return res.status(404).json({ error: "Empresa não encontrada" });
    const v = numeroWpp.validar(String(item.whatsapp || ""));
    if (!v.ok) return res.status(400).json({ error: `Empresa sem WhatsApp válido: ${v.motivo}` });
    const texto = montarAvisoCertificado({ empresa: item.name, venceEm: item.vence_em });
    const { enviarTexto } = require("../uazapi");
    await enviarTexto({ numero: v.numero, texto, delayMs: 300 });
    if (item.certificado_id) {
      await db.query("UPDATE company_certificados SET avisado_em = now() WHERE id = $1", [item.certificado_id]);
    }
    res.json({ ok: true, numero: v.numero });
  } catch (err) {
    console.error("[certificados avisar]", err.message);
    res.status(502).json({ error: err.message || "Falha ao enviar o aviso" });
  }
});

// ---------------------------------------------------------------- portal
const portalRouter = express.Router();
portalRouter.use(authMiddleware);

function soEmpresa(req, res, next) {
  if (req.isAdmin || !req.company?.id) return res.status(403).json({ error: "Sessão de empresa inválida" });
  // Gerente (login por CPF) só emite advertência e suspensão.
  if (req.companyUser) return res.status(403).json({ error: "Acesso de gerente não inclui o certificado" });
  next();
}

portalRouter.get("/", soEmpresa, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT k.id, k.tipo, k.titular, k.emissor, k.emitido_em, k.vence_em, k.origem, k.updated_at,
              ${certStatusSql("k.vence_em")} AS status, (k.vence_em - CURRENT_DATE) AS dias_restantes
         FROM company_certificados k
        WHERE k.company_id = $1
        ORDER BY k.vence_em DESC
        LIMIT 1`,
      [req.company.id]
    );
    res.json({
      dias_aviso: certWarnDays(),
      certificado: rows[0] || null,
      status: rows[0]?.status || "ausente",
    });
  } catch (err) {
    console.error("[certificado portal]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** O cliente informa o certificado novo depois de renovar. */
portalRouter.post("/", soEmpresa, async (req, res) => {
  try {
    const c = lerCamposCertificado(req.body, validadores);
    if (c.erro) return res.status(400).json({ error: c.erro });
    const { rows } = await db.query(
      `INSERT INTO company_certificados (company_id, tipo, titular, emissor, emitido_em, vence_em, observacao, origem)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'cliente') RETURNING *`,
      [req.company.id, c.tipo, c.titular, c.emissor, c.emitido, c.vence, c.observacao]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[certificado portal criar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = { adminRouter, portalRouter };
