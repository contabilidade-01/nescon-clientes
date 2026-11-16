/**
 * Gerentes da empresa — cadastro feito pelo login principal da empresa no portal.
 * Ver gerentes.js para o que o gerente pode fazer depois de entrar.
 */
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authMiddleware, requireCompanyOwner } = require("../middleware/auth");
const { validateCPF, validateString, validateUUID, validateEmailFormat } = require("../middleware/validate");
const { gerarSenhaInicial } = require("../senhaInicial");
const { novoPrazoSenhaTemporaria } = require("../senhaExpiracao");
const { normalizarPermissoes, permissoesForaDaEmpresa, PERMISSOES_GERENTE } = require("../gerentes");

router.use(authMiddleware, requireCompanyOwner);

const CAMPOS = `id, cpf, nome, email, permissions, active, must_change_password,
  password_expires_at, ultimo_login_em, criado_em`;

function validarPermissoes(req, raw) {
  const permissoes = normalizarPermissoes(raw);
  if (!PERMISSOES_GERENTE.some((k) => permissoes[k])) {
    return { erro: "Marque ao menos uma permissão (advertência ou suspensão)." };
  }
  if (permissoesForaDaEmpresa(req.companyToolAccess, permissoes).length) {
    return { erro: "O escritório não liberou essa ferramenta para a sua empresa." };
  }
  return { permissoes };
}

function validarEmail(email) {
  if (email === undefined || email === null || email === "") return { email: null };
  if (typeof email !== "string" || !validateEmailFormat(email.trim())) return { erro: "E-mail inválido" };
  return { email: email.trim().toLowerCase() };
}

/** Senha nova, mostrada uma vez ao dono, que repassa ao gerente. */
async function novaSenha() {
  const senha = gerarSenhaInicial();
  return { senha, hash: await bcrypt.hash(senha, 10), expira: novoPrazoSenhaTemporaria() };
}

router.get("/", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ${CAMPOS} FROM company_users WHERE company_id = $1 ORDER BY active DESC, nome`,
      [req.company.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("gerentes list:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { cpf, nome } = req.body || {};
    if (!validateCPF(cpf)) return res.status(400).json({ error: "CPF inválido" });
    if (!validateString(nome, 2, 200)) return res.status(400).json({ error: "Nome inválido" });
    const em = validarEmail(req.body.email);
    if (em.erro) return res.status(400).json({ error: em.erro });
    const p = validarPermissoes(req, req.body.permissions);
    if (p.erro) return res.status(400).json({ error: p.erro });

    const cpfLimpo = cpf.replace(/\D/g, "");
    // O login por CPF procura primeiro o escritório e depois o cliente pessoa física.
    // Um gerente com o mesmo CPF ficaria escondido atrás deles (ou os esconderia).
    const { rows: conflito } = await db.query(
      `SELECT 1 FROM platform_admins WHERE cpf = $1
       UNION ALL SELECT 1 FROM companies WHERE cnpj = $1
       UNION ALL SELECT 1 FROM company_users WHERE cpf = $1
       LIMIT 1`,
      [cpfLimpo]
    );
    if (conflito.length) {
      return res.status(409).json({ error: "Este CPF já tem acesso ao portal. Use outro CPF ou fale com o escritório." });
    }

    const s = await novaSenha();
    const { rows } = await db.query(
      `INSERT INTO company_users (company_id, cpf, nome, email, password_hash, must_change_password, password_expires_at, permissions)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7::jsonb)
       RETURNING ${CAMPOS}`,
      [req.company.id, cpfLimpo, nome.trim(), em.email, s.hash, s.expira, JSON.stringify(p.permissoes)]
    );
    res.status(201).json({ gerente: rows[0], senha: s.senha });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Este CPF já tem acesso ao portal." });
    }
    console.error("gerentes create:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { nome, active } = req.body || {};
    const sets = [];
    const vals = [];
    if (nome !== undefined) {
      if (!validateString(nome, 2, 200)) return res.status(400).json({ error: "Nome inválido" });
      vals.push(nome.trim());
      sets.push(`nome = $${vals.length}`);
    }
    if (req.body.email !== undefined) {
      const em = validarEmail(req.body.email);
      if (em.erro) return res.status(400).json({ error: em.erro });
      vals.push(em.email);
      sets.push(`email = $${vals.length}`);
    }
    if (req.body.permissions !== undefined) {
      const p = validarPermissoes(req, req.body.permissions);
      if (p.erro) return res.status(400).json({ error: p.erro });
      vals.push(JSON.stringify(p.permissoes));
      sets.push(`permissions = $${vals.length}::jsonb`);
    }
    if (active !== undefined) {
      if (typeof active !== "boolean") return res.status(400).json({ error: "Situação inválida" });
      vals.push(active);
      sets.push(`active = $${vals.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: "Nenhum campo para atualizar" });

    vals.push(req.params.id, req.company.id);
    const { rows } = await db.query(
      `UPDATE company_users SET ${sets.join(", ")}, atualizado_em = now()
        WHERE id = $${vals.length - 1} AND company_id = $${vals.length}
        RETURNING ${CAMPOS}`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Gerente não encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error("gerentes update:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Esqueceu a senha: o dono gera outra, e o gerente troca no próximo acesso. */
router.post("/:id/nova-senha", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const s = await novaSenha();
    const { rows } = await db.query(
      `UPDATE company_users
          SET password_hash = $1, must_change_password = true, password_expires_at = $2, atualizado_em = now()
        WHERE id = $3 AND company_id = $4
        RETURNING ${CAMPOS}`,
      [s.hash, s.expira, req.params.id, req.company.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Gerente não encontrado" });
    res.json({ gerente: rows[0], senha: s.senha });
  } catch (err) {
    console.error("gerentes nova-senha:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rowCount } = await db.query(
      "DELETE FROM company_users WHERE id = $1 AND company_id = $2",
      [req.params.id, req.company.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Gerente não encontrado" });
    res.json({ ok: true });
  } catch (err) {
    console.error("gerentes delete:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
