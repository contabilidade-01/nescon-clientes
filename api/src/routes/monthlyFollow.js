const express = require("express");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID, validateString } = require("../middleware/validate");
const { encryptSecret, decryptSecret } = require("../appSettings");
const {
  nEsimoDiaBancario,
  ultimoDiaBancarioDoMes,
  hojeSP,
} = require("../diasBancarios");

const router = express.Router();
router.use(authMiddleware);
router.use(requireArea("acompanhamentos"));

const PRAZOS_OK = new Set(["n_dia_bancario", "ultimo_dia_bancario"]);
const STATUS_OK = new Set(["pendente", "em_andamento", "concluido"]);

function competenciaOk(v) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ""));
}

function parseCompetencia(v) {
  const s = String(v || "");
  if (!competenciaOk(s)) return null;
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), raw: s };
}

function competenciaAtual() {
  return hojeSP().slice(0, 7);
}

function dueDateForKind(kind, y, m) {
  if (kind.prazo_tipo === "ultimo_dia_bancario") {
    return ultimoDiaBancarioDoMes(y, m);
  }
  const n = Math.max(1, Number(kind.prazo_n) || 1);
  return nEsimoDiaBancario(y, m, n);
}

function slugKind(titulo) {
  const s = String(titulo || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return s || `ramificacao_${Date.now()}`;
}

function asIsoDate(v) {
  if (!v) return "";
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

function statusEfetivo(row, hoje) {
  if (row.status === "concluido") return "concluido";
  const due = asIsoDate(row.due_date);
  if (due && due < hoje) return "atrasado";
  return row.status;
}

function formatTask(row, hoje) {
  return {
    id: row.id,
    kind_id: row.kind_id,
    titulo: row.titulo,
    descricao: row.descricao,
    competencia: row.competencia,
    due_date: asIsoDate(row.due_date),
    assigned_admin_id: row.assigned_admin_id,
    assigned_nome: row.assigned_nome || null,
    status: row.status,
    status_efetivo: statusEfetivo(row, hoje),
    notes: row.notes || "",
    completed_at: row.completed_at,
    updated_at: row.updated_at,
  };
}

async function gerarTarefas(competencia) {
  const parsed = parseCompetencia(competencia);
  if (!parsed) return;
  const { rows: kinds } = await db.query(
    "SELECT * FROM monthly_follow_kinds WHERE ativo IS TRUE ORDER BY ordem, titulo"
  );
  for (const kind of kinds) {
    const due = dueDateForKind(kind, parsed.y, parsed.m);
    if (!due) continue;
    await db.query(
      `INSERT INTO monthly_follow_tasks (kind_id, competencia, due_date, assigned_admin_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (kind_id, competencia) DO UPDATE SET
         due_date = EXCLUDED.due_date`,
      [kind.id, parsed.raw, due, kind.default_assignee_id]
    );
  }
}

router.get("/responsaveis", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, nome, cpf FROM platform_admins
       WHERE COALESCE(active, true) IS TRUE
       ORDER BY is_owner DESC, nome NULLS LAST, cpf`
    );
    res.json(rows.map((r) => ({ id: r.id, nome: r.nome || r.cpf })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/kinds", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT k.*, a.nome AS default_assignee_nome
       FROM monthly_follow_kinds k
       LEFT JOIN platform_admins a ON a.id = k.default_assignee_id
       ORDER BY k.ordem, k.titulo`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/kinds", async (req, res) => {
  try {
    const titulo = String(req.body?.titulo || "").trim();
    if (!validateString(titulo, 2, 120)) {
      return res.status(400).json({ error: "Informe o nome da ramificação" });
    }
    const prazo_tipo = String(req.body?.prazo_tipo || "n_dia_bancario");
    if (!PRAZOS_OK.has(prazo_tipo)) {
      return res.status(400).json({ error: "Tipo de prazo inválido" });
    }
    const prazo_n = prazo_tipo === "n_dia_bancario" ? Math.min(22, Math.max(1, Number(req.body?.prazo_n) || 5)) : null;
    const descricao = validateString(req.body?.descricao, 0, 400) ? String(req.body.descricao).trim() : "";
    let id = slugKind(titulo);
    const exists = await db.query("SELECT 1 FROM monthly_follow_kinds WHERE id = $1", [id]);
    if (exists.rows.length) id = `${id}_${Date.now().toString(36)}`;
    const { rows: ord } = await db.query("SELECT COALESCE(MAX(ordem), 0) + 1 AS n FROM monthly_follow_kinds");
    const { rows } = await db.query(
      `INSERT INTO monthly_follow_kinds (id, titulo, descricao, prazo_tipo, prazo_n, ordem)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, titulo, descricao, prazo_tipo, prazo_n, ord[0].n]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/kinds/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const { rows: cur } = await db.query("SELECT * FROM monthly_follow_kinds WHERE id = $1", [id]);
    if (!cur.length) return res.status(404).json({ error: "Ramificação não encontrada" });
    const titulo = req.body.titulo != null ? String(req.body.titulo).trim() : cur[0].titulo;
    if (!validateString(titulo, 2, 120)) return res.status(400).json({ error: "Título inválido" });
    let prazo_tipo = cur[0].prazo_tipo;
    if (req.body.prazo_tipo != null) {
      if (!PRAZOS_OK.has(String(req.body.prazo_tipo))) {
        return res.status(400).json({ error: "Tipo de prazo inválido" });
      }
      prazo_tipo = String(req.body.prazo_tipo);
    }
    let prazo_n = cur[0].prazo_n;
    if (req.body.prazo_n != null) prazo_n = Math.min(22, Math.max(1, Number(req.body.prazo_n) || 1));
    if (prazo_tipo === "ultimo_dia_bancario") prazo_n = null;
    const descricao = req.body.descricao != null ? String(req.body.descricao).trim().slice(0, 400) : cur[0].descricao;
    let default_assignee_id = cur[0].default_assignee_id;
    if (req.body.default_assignee_id === null || req.body.default_assignee_id === "") {
      default_assignee_id = null;
    } else if (req.body.default_assignee_id) {
      if (!validateUUID(req.body.default_assignee_id)) {
        return res.status(400).json({ error: "Responsável inválido" });
      }
      default_assignee_id = req.body.default_assignee_id;
    }
    const ativo = typeof req.body.ativo === "boolean" ? req.body.ativo : cur[0].ativo;
    const { rows } = await db.query(
      `UPDATE monthly_follow_kinds SET
         titulo = $1, descricao = $2, prazo_tipo = $3, prazo_n = $4,
         default_assignee_id = $5, ativo = $6
       WHERE id = $7 RETURNING *`,
      [titulo, descricao, prazo_tipo, prazo_n, default_assignee_id, ativo, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/mes", async (req, res) => {
  try {
    const competencia = competenciaOk(req.query.competencia) ? String(req.query.competencia) : competenciaAtual();
    await gerarTarefas(competencia);
    const hoje = hojeSP();
    const { rows } = await db.query(
      `SELECT t.*, k.titulo, k.descricao, k.prazo_tipo, k.prazo_n, k.ordem,
              a.nome AS assigned_nome
       FROM monthly_follow_tasks t
       JOIN monthly_follow_kinds k ON k.id = t.kind_id
       LEFT JOIN platform_admins a ON a.id = t.assigned_admin_id
       WHERE t.competencia = $1
       ORDER BY k.ordem, k.titulo`,
      [competencia]
    );
    const prazos = {};
    const parsed = parseCompetencia(competencia);
    for (const r of rows) {
      prazos[r.kind_id] = asIsoDate(r.due_date);
    }
    res.json({
      competencia,
      hoje,
      quinto_dia_util: parsed ? nEsimoDiaBancario(parsed.y, parsed.m, 5) : null,
      decimo_dia_util: parsed ? nEsimoDiaBancario(parsed.y, parsed.m, 10) : null,
      ultimo_dia_util: parsed ? ultimoDiaBancarioDoMes(parsed.y, parsed.m) : null,
      tarefas: rows.map((r) => formatTask(r, hoje)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/tarefas/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows: cur } = await db.query("SELECT * FROM monthly_follow_tasks WHERE id = $1", [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: "Tarefa não encontrada" });
    const row = cur[0];
    let assigned = row.assigned_admin_id;
    if (req.body.assigned_admin_id === null || req.body.assigned_admin_id === "") assigned = null;
    else if (req.body.assigned_admin_id) {
      if (!validateUUID(req.body.assigned_admin_id)) {
        return res.status(400).json({ error: "Responsável inválido" });
      }
      assigned = req.body.assigned_admin_id;
    }
    let status = row.status;
    if (req.body.status != null) {
      if (!STATUS_OK.has(String(req.body.status))) {
        return res.status(400).json({ error: "Status inválido" });
      }
      status = String(req.body.status);
    }
    const notes = req.body.notes != null ? String(req.body.notes).slice(0, 2000) : row.notes;
    const completed_at = status === "concluido" ? row.completed_at || new Date() : null;
    const completed_by = status === "concluido" ? req.admin?.id || row.completed_by : null;
    const { rows } = await db.query(
      `UPDATE monthly_follow_tasks SET
         assigned_admin_id = $1, status = $2, notes = $3,
         completed_at = $4, completed_by = $5, updated_at = now()
       WHERE id = $6
       RETURNING *`,
      [assigned, status, notes, completed_at, completed_by, req.params.id]
    );
    const { rows: extra } = await db.query(
      `SELECT t.*, k.titulo, k.descricao, a.nome AS assigned_nome
       FROM monthly_follow_tasks t
       JOIN monthly_follow_kinds k ON k.id = t.kind_id
       LEFT JOIN platform_admins a ON a.id = t.assigned_admin_id
       WHERE t.id = $1`,
      [rows[0].id]
    );
    res.json(formatTask(extra[0], hojeSP()));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

function meiPublico(row) {
  return {
    id: row.id,
    company_id: row.company_id,
    nome: row.nome,
    cnpj: row.cnpj,
    portal: row.portal,
    login: row.login,
    tem_senha: Boolean(row.senha_enc),
    observacao: row.observacao,
    assigned_admin_id: row.assigned_admin_id,
    assigned_nome: row.assigned_nome || null,
    ativo: row.ativo,
    updated_at: row.updated_at,
  };
}

router.get("/meis", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.*, a.nome AS assigned_nome
       FROM mei_credentials m
       LEFT JOIN platform_admins a ON a.id = m.assigned_admin_id
       ORDER BY m.ativo DESC, m.nome`
    );
    res.json(rows.map(meiPublico));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/meis", async (req, res) => {
  try {
    const nome = String(req.body?.nome || "").trim();
    if (!validateString(nome, 2, 200)) return res.status(400).json({ error: "Informe o nome do MEI" });
    const cnpj = String(req.body?.cnpj || "").replace(/\D/g, "").slice(0, 14);
    const portal = String(req.body?.portal || "").trim().slice(0, 200);
    const login = String(req.body?.login || "").trim().slice(0, 200);
    const observacao = String(req.body?.observacao || "").trim().slice(0, 1000);
    const senha = req.body?.senha != null ? String(req.body.senha) : "";
    const senha_enc = senha ? encryptSecret(senha) : null;
    let assigned = null;
    if (req.body.assigned_admin_id && validateUUID(req.body.assigned_admin_id)) {
      assigned = req.body.assigned_admin_id;
    }
    let company_id = null;
    if (req.body.company_id && validateUUID(req.body.company_id)) company_id = req.body.company_id;
    const { rows } = await db.query(
      `INSERT INTO mei_credentials
         (company_id, nome, cnpj, portal, login, senha_enc, observacao, assigned_admin_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [company_id, nome, cnpj || null, portal || null, login || null, senha_enc, observacao || null, assigned]
    );
    res.status(201).json(meiPublico({ ...rows[0], assigned_nome: null }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/meis/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows: cur } = await db.query("SELECT * FROM mei_credentials WHERE id = $1", [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: "MEI não encontrado" });
    const row = cur[0];
    const nome = req.body.nome != null ? String(req.body.nome).trim() : row.nome;
    if (!validateString(nome, 2, 200)) return res.status(400).json({ error: "Nome inválido" });
    const cnpj =
      req.body.cnpj != null ? String(req.body.cnpj).replace(/\D/g, "").slice(0, 14) : row.cnpj;
    const portal = req.body.portal != null ? String(req.body.portal).trim().slice(0, 200) : row.portal;
    const login = req.body.login != null ? String(req.body.login).trim().slice(0, 200) : row.login;
    const observacao =
      req.body.observacao != null ? String(req.body.observacao).trim().slice(0, 1000) : row.observacao;
    let senha_enc = row.senha_enc;
    if (typeof req.body.senha === "string" && req.body.senha.length) {
      senha_enc = encryptSecret(req.body.senha);
    }
    let assigned = row.assigned_admin_id;
    if (req.body.assigned_admin_id === null || req.body.assigned_admin_id === "") assigned = null;
    else if (req.body.assigned_admin_id && validateUUID(req.body.assigned_admin_id)) {
      assigned = req.body.assigned_admin_id;
    }
    let company_id = row.company_id;
    if (req.body.company_id === null || req.body.company_id === "") company_id = null;
    else if (req.body.company_id && validateUUID(req.body.company_id)) company_id = req.body.company_id;
    const ativo = typeof req.body.ativo === "boolean" ? req.body.ativo : row.ativo;
    const { rows } = await db.query(
      `UPDATE mei_credentials SET
         company_id = $1, nome = $2, cnpj = $3, portal = $4, login = $5,
         senha_enc = $6, observacao = $7, assigned_admin_id = $8, ativo = $9, updated_at = now()
       WHERE id = $10 RETURNING *`,
      [company_id, nome, cnpj || null, portal || null, login || null, senha_enc, observacao || null, assigned, ativo, req.params.id]
    );
    const { rows: extra } = await db.query(
      `SELECT m.*, a.nome AS assigned_nome FROM mei_credentials m
       LEFT JOIN platform_admins a ON a.id = m.assigned_admin_id WHERE m.id = $1`,
      [rows[0].id]
    );
    res.json(meiPublico(extra[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/meis/:id/senha", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query("SELECT senha_enc FROM mei_credentials WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "MEI não encontrado" });
    if (!rows[0].senha_enc) return res.json({ senha: "" });
    const senha = decryptSecret(rows[0].senha_enc);
    if (senha == null) {
      return res.status(500).json({ error: "Não foi possível decifrar a senha (confira SETTINGS_ENC_KEY)." });
    }
    res.json({ senha });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
