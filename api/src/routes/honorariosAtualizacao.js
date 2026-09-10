/**
 * Rotas do painel Atualização de Honorários (área funcionarios).
 */
const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID } = require("../middleware/validate");
const {
  ENQUADRAMENTOS,
  TIPOS,
  COMPLEXIDADES,
  lerTolerancias,
  salvarTolerancias,
  classificar,
  okEfetivo,
  enumOuNull,
  centavosOuNull,
} = require("../honorariosAtualizacao");

router.use(authMiddleware);
router.use(requireArea("funcionarios"));

async function buscarPadrao(dbConn, { padrao_id, enquadramento, tipo_empresa, complexidade }) {
  if (padrao_id) {
    const { rows } = await dbConn.query(
      `SELECT id, label, enquadramento, tipo_empresa, complexidade, valor_a_partir_centavos, ativo
         FROM honorario_padroes WHERE id = $1`,
      [padrao_id]
    );
    return rows[0] || null;
  }
  if (enquadramento && tipo_empresa && complexidade) {
    const { rows } = await dbConn.query(
      `SELECT id, label, enquadramento, tipo_empresa, complexidade, valor_a_partir_centavos, ativo
         FROM honorario_padroes
        WHERE enquadramento = $1 AND tipo_empresa = $2 AND complexidade = $3 AND ativo IS TRUE
        LIMIT 1`,
      [enquadramento, tipo_empresa, complexidade]
    );
    return rows[0] || null;
  }
  return null;
}

function enriquecerLinha(row, tol) {
  const ideal = row.ideal_centavos;
  const cls = classificar(row.atual_centavos, ideal, tol.tol_abaixo_pct, tol.tol_acima_pct);
  const ok_auto = cls.ok_auto;
  const ok = okEfetivo(row.ok_manual, ok_auto);
  const idealAjustado =
    row.ideal_centavos != null &&
    row.ideal_sugerido_centavos != null &&
    Number(row.ideal_centavos) !== Number(row.ideal_sugerido_centavos);
  return {
    company_id: row.company_id,
    name: row.name,
    cnpj: row.cnpj,
    enquadramento: row.enquadramento,
    tipo_empresa: row.tipo_empresa,
    complexidade: row.complexidade,
    padrao_id: row.padrao_id,
    padrao_label: row.padrao_label,
    atual_centavos: row.atual_centavos,
    atual_origem: row.atual_origem,
    ideal_sugerido_centavos: row.ideal_sugerido_centavos,
    ideal_centavos: row.ideal_centavos,
    ideal_ajustado: Boolean(idealAjustado),
    ok_manual: row.ok_manual,
    ok_auto,
    ok,
    ok_editado_manual: row.ok_manual === true || row.ok_manual === false,
    oculto: Boolean(row.oculto),
    situacao: cls.situacao,
    dentro: cls.dentro,
    piso_centavos: cls.piso,
    teto_centavos: cls.teto,
    atualizado_em: row.atualizado_em,
  };
}

/** GET / — lista empresas + balanço + tolerâncias + padrões. */
router.get("/", async (_req, res) => {
  try {
    const tol = await lerTolerancias(db);
    const { rows } = await db.query(
      `SELECT c.id AS company_id, c.name, c.cnpj,
              ha.enquadramento, ha.tipo_empresa, ha.complexidade, ha.padrao_id,
              p.label AS padrao_label,
              ha.atual_centavos, ha.atual_origem,
              ha.ideal_sugerido_centavos, ha.ideal_centavos,
              ha.ok_manual, COALESCE(ha.oculto, false) AS oculto,
              ha.atualizado_em
         FROM companies c
         LEFT JOIN honorario_atualizacao ha ON ha.company_id = c.id
         LEFT JOIN honorario_padroes p ON p.id = ha.padrao_id
        WHERE c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
        ORDER BY c.name`
    );
    const empresas = rows.map((r) => enriquecerLinha(r, tol));
    const visiveis = empresas.filter((e) => !e.oculto);
    const totais = {
      total: visiveis.length,
      pendentes: 0,
      prejuizo: 0,
      equilibrio: 0,
      lucro: 0,
      dentro: 0,
    };
    for (const e of visiveis) {
      if (e.situacao === "pendente") totais.pendentes += 1;
      else if (e.situacao === "prejuizo") totais.prejuizo += 1;
      else if (e.situacao === "equilibrio") totais.equilibrio += 1;
      else if (e.situacao === "lucro") totais.lucro += 1;
      if (e.dentro) totais.dentro += 1;
    }
    const classificados = totais.total - totais.pendentes;
    totais.pct_dentro =
      classificados > 0 ? Math.round((totais.dentro / classificados) * 1000) / 10 : null;

    const { rows: padroes } = await db.query(
      `SELECT id, label, enquadramento, tipo_empresa, complexidade,
              valor_a_partir_centavos, ativo
         FROM honorario_padroes
        ORDER BY enquadramento, tipo_empresa, complexidade`
    );

    res.json({
      config: tol,
      totais,
      empresas,
      padroes,
      enums: {
        enquadramentos: ENQUADRAMENTOS,
        tipos: TIPOS,
        complexidades: COMPLEXIDADES,
      },
    });
  } catch (err) {
    console.error("[honorarios-atualizacao] GET:", err.message);
    res.status(500).json({ error: "Erro ao carregar atualização de honorários" });
  }
});

/** PUT /config — tolerâncias globais. */
router.put("/config", async (req, res) => {
  try {
    const body = req.body || {};
    const config = await salvarTolerancias(db, {
      tol_abaixo_pct: body.tol_abaixo_pct,
      tol_acima_pct: body.tol_acima_pct,
    });
    res.json({ ok: true, config });
  } catch (err) {
    console.error("[honorarios-atualizacao] config:", err.message);
    res.status(500).json({ error: "Erro ao salvar tolerâncias" });
  }
});

/** GET /padroes */
router.get("/padroes", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, label, enquadramento, tipo_empresa, complexidade,
              valor_a_partir_centavos, ativo
         FROM honorario_padroes
        ORDER BY enquadramento, tipo_empresa, complexidade`
    );
    res.json({ padroes: rows });
  } catch (err) {
    console.error("[honorarios-atualizacao] padroes GET:", err.message);
    res.status(500).json({ error: "Erro ao listar padrões" });
  }
});

/** PUT /padroes/:id — edita valor/label/ativo de um padrão. */
router.put("/padroes/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id || "")) return res.status(400).json({ error: "id inválido" });
  const { label, valor_a_partir_centavos, ativo } = req.body || {};
  const valor = centavosOuNull(valor_a_partir_centavos);
  if (valor_a_partir_centavos !== undefined && valor === undefined) {
    return res.status(400).json({ error: "valor_a_partir_centavos inválido" });
  }
  try {
    const { rows } = await db.query(
      `UPDATE honorario_padroes
          SET label = COALESCE($2, label),
              valor_a_partir_centavos = COALESCE($3, valor_a_partir_centavos),
              ativo = COALESCE($4, ativo),
              atualizado_em = now()
        WHERE id = $1
        RETURNING id, label, enquadramento, tipo_empresa, complexidade,
                  valor_a_partir_centavos, ativo`,
      [
        id,
        label !== undefined ? String(label).trim() || null : null,
        valor,
        ativo === undefined ? null : Boolean(ativo),
      ]
    );
    if (!rows.length) return res.status(404).json({ error: "Padrão não encontrado" });
    res.json({ ok: true, padrao: rows[0] });
  } catch (err) {
    console.error("[honorarios-atualizacao] padroes PUT:", err.message);
    res.status(500).json({ error: "Erro ao salvar padrão" });
  }
});

/**
 * PUT /:companyId — salva perfil + valores.
 * Body: enquadramento, tipo_empresa, complexidade, padrao_id,
 *       atual_centavos, ideal_centavos, ok_manual (null limpa override),
 *       limpar_ok_manual: true
 */
router.put("/:companyId", async (req, res) => {
  const { companyId } = req.params;
  if (!validateUUID(companyId || "")) return res.status(400).json({ error: "company_id inválido" });
  const body = req.body || {};

  const enq = enumOuNull(body.enquadramento, ENQUADRAMENTOS);
  if (body.enquadramento !== undefined && enq === undefined) {
    return res.status(400).json({ error: "enquadramento inválido" });
  }
  const tipo = enumOuNull(body.tipo_empresa, TIPOS);
  if (body.tipo_empresa !== undefined && tipo === undefined) {
    return res.status(400).json({ error: "tipo_empresa inválido" });
  }
  const comp = enumOuNull(body.complexidade, COMPLEXIDADES);
  if (body.complexidade !== undefined && comp === undefined) {
    return res.status(400).json({ error: "complexidade inválida" });
  }

  let padraoId = body.padrao_id === undefined ? undefined : body.padrao_id;
  if (padraoId === "" || padraoId === null) padraoId = null;
  if (padraoId !== undefined && padraoId !== null && !validateUUID(padraoId)) {
    return res.status(400).json({ error: "padrao_id inválido" });
  }

  const atual = body.atual_centavos === undefined ? undefined : centavosOuNull(body.atual_centavos);
  if (body.atual_centavos !== undefined && atual === undefined) {
    return res.status(400).json({ error: "atual_centavos inválido" });
  }
  const ideal = body.ideal_centavos === undefined ? undefined : centavosOuNull(body.ideal_centavos);
  if (body.ideal_centavos !== undefined && ideal === undefined) {
    return res.status(400).json({ error: "ideal_centavos inválido" });
  }

  try {
    const { rows: emp } = await db.query(
      `SELECT id FROM companies
        WHERE id = $1 AND arquivada IS NOT TRUE AND excluida IS NOT TRUE`,
      [companyId]
    );
    if (!emp.length) return res.status(404).json({ error: "Empresa não encontrada" });

    const { rows: atuais } = await db.query(
      `SELECT * FROM honorario_atualizacao WHERE company_id = $1`,
      [companyId]
    );
    const prev = atuais[0] || {};

    const enquadramento = enq !== undefined ? enq : prev.enquadramento ?? null;
    const tipo_empresa = tipo !== undefined ? tipo : prev.tipo_empresa ?? null;
    const complexidade = comp !== undefined ? comp : prev.complexidade ?? null;

    let nextPadraoId = padraoId !== undefined ? padraoId : prev.padrao_id ?? null;
    const perfilMudou =
      enq !== undefined || tipo !== undefined || comp !== undefined || padraoId !== undefined;

    let idealSugerido =
      prev.ideal_sugerido_centavos != null ? Number(prev.ideal_sugerido_centavos) : null;
    let nextIdeal = ideal !== undefined ? ideal : prev.ideal_centavos != null ? Number(prev.ideal_centavos) : null;

    if (perfilMudou) {
      const padrao = await buscarPadrao(db, {
        padrao_id: nextPadraoId,
        enquadramento,
        tipo_empresa,
        complexidade,
      });
      if (padrao) {
        nextPadraoId = padrao.id;
        idealSugerido = Number(padrao.valor_a_partir_centavos);
        const idealEraSugerido =
          prev.ideal_centavos == null ||
          prev.ideal_sugerido_centavos == null ||
          Number(prev.ideal_centavos) === Number(prev.ideal_sugerido_centavos);
        if (ideal !== undefined) {
          // Front manda o ideal do draft (já preenchido pela sugestão ou editado).
          nextIdeal = ideal != null ? ideal : idealSugerido;
        } else if (idealEraSugerido) {
          nextIdeal = idealSugerido;
        }
      } else if (padraoId === null || enq !== undefined || tipo !== undefined || comp !== undefined) {
        if (!enquadramento || !tipo_empresa || !complexidade) {
          nextPadraoId = null;
          idealSugerido = null;
        }
      }
    }

    let nextAtual = atual !== undefined ? atual : prev.atual_centavos != null ? Number(prev.atual_centavos) : null;
    let nextOrigem = prev.atual_origem ?? null;
    if (atual !== undefined) {
      nextOrigem = atual == null ? null : "manual";
    }

    let okManual = prev.ok_manual;
    if (body.limpar_ok_manual === true) okManual = null;
    else if (body.ok_manual === null) okManual = null;
    else if (body.ok_manual === true || body.ok_manual === false) okManual = body.ok_manual;

    const adminId = req.admin?.id || null;
    const ocultoPrev = prev.oculto === true;

    await db.query(
      `INSERT INTO honorario_atualizacao (
         company_id, enquadramento, tipo_empresa, complexidade, padrao_id,
         atual_centavos, atual_origem, ideal_sugerido_centavos, ideal_centavos,
         ok_manual, oculto, atualizado_em, atualizado_por
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12)
       ON CONFLICT (company_id) DO UPDATE SET
         enquadramento = EXCLUDED.enquadramento,
         tipo_empresa = EXCLUDED.tipo_empresa,
         complexidade = EXCLUDED.complexidade,
         padrao_id = EXCLUDED.padrao_id,
         atual_centavos = EXCLUDED.atual_centavos,
         atual_origem = EXCLUDED.atual_origem,
         ideal_sugerido_centavos = EXCLUDED.ideal_sugerido_centavos,
         ideal_centavos = EXCLUDED.ideal_centavos,
         ok_manual = EXCLUDED.ok_manual,
         atualizado_em = now(),
         atualizado_por = EXCLUDED.atualizado_por`,
      [
        companyId,
        enquadramento,
        tipo_empresa,
        complexidade,
        nextPadraoId,
        nextAtual,
        nextOrigem,
        idealSugerido,
        nextIdeal,
        okManual,
        ocultoPrev,
        adminId,
      ]
    );

    const tol = await lerTolerancias(db);
    const { rows: out } = await db.query(
      `SELECT c.id AS company_id, c.name, c.cnpj,
              ha.enquadramento, ha.tipo_empresa, ha.complexidade, ha.padrao_id,
              p.label AS padrao_label,
              ha.atual_centavos, ha.atual_origem,
              ha.ideal_sugerido_centavos, ha.ideal_centavos,
              ha.ok_manual, COALESCE(ha.oculto, false) AS oculto,
              ha.atualizado_em
         FROM companies c
         JOIN honorario_atualizacao ha ON ha.company_id = c.id
         LEFT JOIN honorario_padroes p ON p.id = ha.padrao_id
        WHERE c.id = $1`,
      [companyId]
    );
    res.json({ ok: true, empresa: enriquecerLinha(out[0], tol) });
  } catch (err) {
    console.error("[honorarios-atualizacao] PUT empresa:", err.message);
    res.status(500).json({ error: "Erro ao salvar empresa" });
  }
});

/** PUT /:companyId/oculto */
router.put("/:companyId/oculto", async (req, res) => {
  const { companyId } = req.params;
  if (!validateUUID(companyId || "")) return res.status(400).json({ error: "company_id inválido" });
  const oculto = Boolean(req.body?.oculto);
  try {
    const { rows: emp } = await db.query(
      `SELECT id FROM companies
        WHERE id = $1 AND arquivada IS NOT TRUE AND excluida IS NOT TRUE`,
      [companyId]
    );
    if (!emp.length) return res.status(404).json({ error: "Empresa não encontrada" });

    await db.query(
      `INSERT INTO honorario_atualizacao (company_id, oculto, atualizado_em)
       VALUES ($1, $2, now())
       ON CONFLICT (company_id) DO UPDATE SET oculto = EXCLUDED.oculto, atualizado_em = now()`,
      [companyId, oculto]
    );
    res.json({ ok: true, oculto });
  } catch (err) {
    console.error("[honorarios-atualizacao] oculto:", err.message);
    res.status(500).json({ error: "Erro ao atualizar oculto" });
  }
});

/**
 * POST /importar-cora — carga única: preenche atual_centavos só onde ainda é null,
 * com o valor do último boleto Cora marcado como honorário.
 */
router.post("/importar-cora", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `WITH ultimos AS (
         SELECT DISTINCT ON (d.company_id)
                d.company_id, d.valor_centavos
           FROM deliverables d
           JOIN companies c ON c.id = d.company_id
          WHERE d.source = 'cora'
            AND d.is_honorario = true
            AND d.cancelado IS NOT TRUE
            AND d.valor_centavos IS NOT NULL
            AND d.valor_centavos > 0
            AND c.arquivada IS NOT TRUE
            AND c.excluida IS NOT TRUE
          ORDER BY d.company_id, d.due_date DESC NULLS LAST, d.created_at DESC NULLS LAST
       )
       INSERT INTO honorario_atualizacao (company_id, atual_centavos, atual_origem, atualizado_em)
       SELECT u.company_id, u.valor_centavos, 'cora', now()
         FROM ultimos u
         LEFT JOIN honorario_atualizacao ha ON ha.company_id = u.company_id
        WHERE ha.company_id IS NULL OR ha.atual_centavos IS NULL
       ON CONFLICT (company_id) DO UPDATE
         SET atual_centavos = EXCLUDED.atual_centavos,
             atual_origem = 'cora',
             atualizado_em = now()
       WHERE honorario_atualizacao.atual_centavos IS NULL
       RETURNING company_id`
    );
    res.json({ ok: true, importados: rows.length });
  } catch (err) {
    console.error("[honorarios-atualizacao] importar-cora:", err.message);
    res.status(500).json({ error: "Erro ao importar do Cora" });
  }
});

module.exports = router;
