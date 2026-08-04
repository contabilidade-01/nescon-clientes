/**
 * Usuários do painel (login por CPF), com acesso por área.
 *
 * Só o **dono** entra aqui. As regras de proteção contra tiro no pé estão no fim de
 * cada handler: ninguém se desativa, ninguém edita as áreas de um dono (dono vê tudo
 * por definição) e esta rota não cria donos novos.
 */
const router = require("express").Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireOwner } = require("../middleware/adminArea");
const { validateCPF, validateString, validateUUID } = require("../middleware/validate");
const { mergeAreas, sanitizeAreas } = require("../adminAreas");

router.use(authMiddleware);
router.use(requireOwner);

const CAMPOS = `id, cpf, nome, areas, is_owner, active, must_change_password, contact_email, created_at`;

/** Senha inicial legível, mostrada UMA vez ao dono — o usuário troca no 1º acesso. */
function gerarSenha() {
  return crypto.randomBytes(6).toString("base64url").slice(0, 10);
}

function formatar(row) {
  return { ...row, areas: mergeAreas(row.areas) };
}

router.get("/", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ${CAMPOS} FROM platform_admins ORDER BY is_owner DESC, nome NULLS LAST, cpf`
    );
    res.json(rows.map(formatar));
  } catch (err) {
    console.error("[usuarios listar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/", async (req, res) => {
  try {
    const rawCpf = String(req.body?.cpf || "");
    const cpf = rawCpf.replace(/\D/g, "");
    if (!validateCPF(rawCpf) || cpf.length !== 11) {
      return res.status(400).json({ error: "CPF inválido (11 dígitos)" });
    }
    if (!validateString(req.body?.nome, 2, 120)) {
      return res.status(400).json({ error: "Informe o nome (2 a 120 caracteres)" });
    }
    const senha = req.body?.senha ? String(req.body.senha) : gerarSenha();
    if (!validateString(senha, 8, 128)) {
      return res.status(400).json({ error: "A senha inicial precisa de pelo menos 8 caracteres" });
    }
    const areas = sanitizeAreas(req.body?.areas);

    const { rows } = await db.query(
      `INSERT INTO platform_admins
         (cpf, nome, password_hash, areas, is_owner, active, must_change_password, created_by)
       VALUES ($1, $2, $3, $4::jsonb, false, true, true, $5)
       RETURNING ${CAMPOS}`,
      [cpf, String(req.body.nome).trim(), await bcrypt.hash(senha, 10), JSON.stringify(areas), req.admin.id]
    );
    // A senha só aparece aqui: não fica legível em lugar nenhum depois disto.
    res.status(201).json({ usuario: formatar(rows[0]), senha_inicial: senha });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Já existe um usuário com esse CPF" });
    console.error("[usuarios criar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });

    const { rows: alvo } = await db.query(
      "SELECT id, is_owner FROM platform_admins WHERE id = $1",
      [id]
    );
    if (!alvo.length) return res.status(404).json({ error: "Usuário não encontrado" });

    const sets = [];
    const vals = [];
    let i = 1;

    if (Object.prototype.hasOwnProperty.call(req.body, "nome")) {
      if (!validateString(req.body.nome, 2, 120)) {
        return res.status(400).json({ error: "Nome inválido (2 a 120 caracteres)" });
      }
      sets.push(`nome = $${i++}`);
      vals.push(String(req.body.nome).trim());
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "areas")) {
      if (alvo[0].is_owner) {
        return res.status(400).json({ error: "O administrador dono vê todas as áreas — não há o que restringir" });
      }
      sets.push(`areas = $${i++}::jsonb`);
      vals.push(JSON.stringify(sanitizeAreas(req.body.areas)));
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "active")) {
      if (typeof req.body.active !== "boolean") {
        return res.status(400).json({ error: "active deve ser true ou false" });
      }
      if (id === req.admin.id && req.body.active === false) {
        return res.status(400).json({ error: "Você não pode desativar o próprio acesso" });
      }
      sets.push(`active = $${i++}`);
      vals.push(req.body.active);
    }

    if (!sets.length) {
      return res.status(400).json({ error: "Envie ao menos um campo: nome, areas ou active" });
    }

    vals.push(id);
    const { rows } = await db.query(
      `UPDATE platform_admins SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${CAMPOS}`,
      vals
    );
    res.json(formatar(rows[0]));
  } catch (err) {
    console.error("[usuarios editar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Redefine a senha e obriga a troca no próximo acesso. */
router.post("/:id/senha", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const senha = req.body?.senha ? String(req.body.senha) : gerarSenha();
    if (!validateString(senha, 8, 128)) {
      return res.status(400).json({ error: "A senha precisa de pelo menos 8 caracteres" });
    }
    const { rowCount } = await db.query(
      `UPDATE platform_admins SET password_hash = $1, must_change_password = true WHERE id = $2`,
      [await bcrypt.hash(senha, 10), id]
    );
    if (!rowCount) return res.status(404).json({ error: "Usuário não encontrado" });
    // Link de redefinição pendente deixa de valer: a senha já mudou.
    await db.query("DELETE FROM password_reset_tokens WHERE used_at IS NULL AND admin_id = $1", [id]);
    res.json({ ok: true, senha_inicial: senha });
  } catch (err) {
    console.error("[usuarios senha]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
