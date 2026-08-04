const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID, validateString, validateDate } = require("../middleware/validate");
const {
  LICENSE_TYPES,
  LICENSE_STATUSES,
  warnDays,
  statusSql,
  isLicenseType,
  isLicenseStatus,
} = require("../licenseStatus");

function adminOnly(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: "Acesso restrito a administradores" });
  }
  next();
}

router.use(authMiddleware);
router.use(adminOnly);
router.use(requireArea("licencas"));

/**
 * Base do painel: para cada empresa ESTABELECIDA e cada um dos 3 tipos, a licença
 * vigente (a de maior vencimento) e o estado calculado. Empresa sem licença daquele
 * tipo aparece com estado 'ausente' — é justamente o que o escritório precisa ver.
 */
function baseQuery() {
  return `
    WITH tipos(tipo) AS (VALUES ${LICENSE_TYPES.map((t) => `('${t}')`).join(", ")}),
    alvo AS (
      SELECT id, name, cnpj FROM companies WHERE established IS TRUE
    ),
    base AS (
      SELECT a.id AS company_id, a.name, a.cnpj, t.tipo,
             l.id AS license_id, l.numero, l.orgao, l.emitida_em, l.vence_em, l.observacao
        FROM alvo a
        CROSS JOIN tipos t
        LEFT JOIN LATERAL (
          SELECT cl.* FROM company_licenses cl
           WHERE cl.company_id = a.id AND cl.tipo = t.tipo
           ORDER BY cl.vence_em DESC
           LIMIT 1
        ) l ON TRUE
    )
    SELECT base.*, ${statusSql("vence_em")} AS status,
           (vence_em - CURRENT_DATE) AS dias_restantes
      FROM base
  `;
}

/** Resumo do dashboard: totais por estado e o mesmo corte por tipo de licença. */
router.get("/overview", async (_req, res) => {
  try {
    const [geral, porTipo, empresas] = await Promise.all([
      db.query(`SELECT status, COUNT(*)::int AS n FROM (${baseQuery()}) q GROUP BY status`),
      db.query(
        `SELECT tipo, status, COUNT(*)::int AS n FROM (${baseQuery()}) q GROUP BY tipo, status`
      ),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE established IS TRUE)::int AS estabelecidas,
                COUNT(*) FILTER (WHERE established IS FALSE)::int AS nao_estabelecidas
           FROM companies`
      ),
    ]);

    const zero = () => Object.fromEntries(LICENSE_STATUSES.map((s) => [s, 0]));
    const por_status = zero();
    for (const r of geral.rows) por_status[r.status] = r.n;

    const por_tipo = LICENSE_TYPES.map((tipo) => ({ tipo, ...zero() }));
    for (const r of porTipo.rows) {
      const linha = por_tipo.find((x) => x.tipo === r.tipo);
      if (linha) linha[r.status] = r.n;
    }

    res.json({
      dias_aviso: warnDays(),
      estabelecidas: empresas.rows[0].estabelecidas,
      nao_estabelecidas: empresas.rows[0].nao_estabelecidas,
      por_status,
      por_tipo,
    });
  } catch (err) {
    console.error("[licencas overview]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Listagem que o clique do dashboard abre: filtra por estado, tipo, empresa ou busca. */
router.get("/itens", async (req, res) => {
  try {
    const where = [];
    const vals = [];
    let i = 1;

    const { status, tipo, company_id: companyId, q } = req.query;
    if (status) {
      if (!isLicenseStatus(status)) return res.status(400).json({ error: "Estado inválido" });
      where.push(`status = $${i++}`);
      vals.push(status);
    }
    if (tipo) {
      if (!isLicenseType(tipo)) return res.status(400).json({ error: "Tipo de licença inválido" });
      where.push(`tipo = $${i++}`);
      vals.push(tipo);
    }
    if (companyId) {
      if (!validateUUID(companyId)) return res.status(400).json({ error: "company_id inválido" });
      where.push(`company_id = $${i++}`);
      vals.push(companyId);
    }
    if (q && String(q).trim()) {
      where.push(`(name ILIKE $${i} OR cnpj ILIKE $${i})`);
      vals.push(`%${String(q).trim()}%`);
      i++;
    }

    const sql = `SELECT * FROM (${baseQuery()}) q
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY (vence_em IS NULL), vence_em ASC, name ASC`;
    const { rows } = await db.query(sql, vals);
    res.json(rows);
  } catch (err) {
    console.error("[licencas itens]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Uma linha por empresa (inclusive as não estabelecidas): serve à aba de marcação
 * estabelecida × não estabelecida e à visão "empresa a empresa".
 */
router.get("/empresas", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.cnpj, c.established,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', l.id, 'tipo', l.tipo, 'numero', l.numero, 'orgao', l.orgao,
                    'emitida_em', l.emitida_em, 'vence_em', l.vence_em,
                    'observacao', l.observacao,
                    'status', ${statusSql("l.vence_em")}
                  ) ORDER BY l.tipo, l.vence_em DESC
                ) FILTER (WHERE l.id IS NOT NULL),
                '[]'
              ) AS licencas
         FROM companies c
         LEFT JOIN company_licenses l ON l.company_id = c.id
        GROUP BY c.id, c.name, c.cnpj, c.established
        ORDER BY c.name`
    );
    res.json(rows);
  } catch (err) {
    console.error("[licencas empresas]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Marca a empresa como estabelecida (cobra licenças) ou não (fica fora do painel). */
router.patch("/empresas/:id/estabelecida", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    if (typeof req.body?.established !== "boolean") {
      return res.status(400).json({ error: "Envie established: true ou false" });
    }
    const { rows, rowCount } = await db.query(
      "UPDATE companies SET established = $1 WHERE id = $2 RETURNING id, name, cnpj, established",
      [req.body.established, id]
    );
    if (!rowCount) return res.status(404).json({ error: "Empresa não encontrada" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[licencas estabelecida]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Campos aceites no cadastro/edição de uma licença. */
function lerCampos(body) {
  const numero = body.numero === undefined || body.numero === null || body.numero === ""
    ? null
    : String(body.numero).trim();
  const orgao = body.orgao === undefined || body.orgao === null || body.orgao === ""
    ? null
    : String(body.orgao).trim();
  const observacao = body.observacao === undefined || body.observacao === null || body.observacao === ""
    ? null
    : String(body.observacao).trim();
  const emitida = body.emitida_em ? String(body.emitida_em).slice(0, 10) : null;
  const vence = body.vence_em ? String(body.vence_em).slice(0, 10) : null;

  if (numero !== null && !validateString(numero, 1, 60)) return { erro: "Número inválido" };
  if (orgao !== null && !validateString(orgao, 1, 120)) return { erro: "Órgão inválido" };
  if (observacao !== null && !validateString(observacao, 1, 500)) {
    return { erro: "Observação muito longa (máx. 500)" };
  }
  if (emitida && !validateDate(emitida)) return { erro: "Data de emissão inválida" };
  if (!vence || !validateDate(vence)) return { erro: "Data de vencimento é obrigatória (AAAA-MM-DD)" };
  if (emitida && emitida > vence) {
    return { erro: "A emissão não pode ser depois do vencimento" };
  }
  return { numero, orgao, observacao, emitida, vence };
}

router.post("/", async (req, res) => {
  try {
    const companyId = req.body?.company_id;
    if (!validateUUID(companyId)) return res.status(400).json({ error: "Selecione a empresa" });
    if (!isLicenseType(req.body?.tipo)) {
      return res.status(400).json({ error: "Tipo deve ser funcionamento, avcb_clcb ou sanitaria" });
    }
    const campos = lerCampos(req.body);
    if (campos.erro) return res.status(400).json({ error: campos.erro });

    const { rowCount } = await db.query("SELECT 1 FROM companies WHERE id = $1", [companyId]);
    if (!rowCount) return res.status(404).json({ error: "Empresa não encontrada" });

    const { rows } = await db.query(
      `INSERT INTO company_licenses (company_id, tipo, numero, orgao, emitida_em, vence_em, observacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [companyId, req.body.tipo, campos.numero, campos.orgao, campos.emitida, campos.vence, campos.observacao]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[licencas criar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const campos = lerCampos(req.body || {});
    if (campos.erro) return res.status(400).json({ error: campos.erro });

    const { rows, rowCount } = await db.query(
      `UPDATE company_licenses
          SET numero = $1, orgao = $2, emitida_em = $3, vence_em = $4, observacao = $5,
              updated_at = now()
        WHERE id = $6
        RETURNING *`,
      [campos.numero, campos.orgao, campos.emitida, campos.vence, campos.observacao, id]
    );
    if (!rowCount) return res.status(404).json({ error: "Licença não encontrada" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[licencas editar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const { rowCount } = await db.query("DELETE FROM company_licenses WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Licença não encontrada" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[licencas apagar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
