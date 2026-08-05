const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { generateToken, generateAdminToken, authMiddleware } = require("../middleware/auth");
const { mergeToolAccess } = require("../companyTools");
const { getCompanyByCnpjForLogin } = require("../toolAccessDb");
const {
  validateCNPJ,
  validateString,
  validateCPF,
  validateEmailFormat,
} = require("../middleware/validate");
const { isSmtpConfigured, getPublicAppUrl, sendPasswordResetEmail } = require("../mailer");
const { LGPD_CONSENT_VERSION, lgpdTermo } = require("../lgpd");
const { mergeAreas } = require("../adminAreas");
const { funcionarioRealSql } = require("../payrollRoles");

/**
 * Admin no login. Base antiga sem as colunas de permissão (42703) devolve o mínimo e
 * o login continua funcionando — a migração roda no arranque, mas nunca dependemos dela.
 */
async function getAdminByCpfForLogin(dbConn, cpfDigits) {
  try {
    const { rows } = await dbConn.query(
      `SELECT id, cpf, nome, password_hash, areas, is_owner, active, must_change_password
         FROM platform_admins WHERE cpf = $1`,
      [cpfDigits]
    );
    return rows;
  } catch (err) {
    if (err.code !== "42703") throw err;
    const { rows } = await dbConn.query(
      "SELECT id, cpf, password_hash FROM platform_admins WHERE cpf = $1",
      [cpfDigits]
    );
    return rows.map((r) => ({
      ...r,
      nome: null,
      areas: null,
      is_owner: true,
      active: true,
      must_change_password: false,
    }));
  }
}

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_MAX || 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_RESET_PASSWORD_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
});

const resetTokenCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Trocar senha exige a atual: limita tentativa de adivinhação por força bruta. */
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_CHANGE_PASSWORD_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
});

function normalizeEmail(val) {
  if (val == null) return "";
  return String(val).trim().toLowerCase();
}

/** joao@empresa.com → j***@empresa.com — confirma o destino sem expor o endereço. */
function maskEmail(email) {
  const s = String(email || "").trim();
  const at = s.indexOf("@");
  if (at < 1) return "seu e-mail";
  const nome = s.slice(0, at);
  const dominio = s.slice(at);
  const visivel = nome.slice(0, 1);
  return `${visivel}${"*".repeat(Math.max(nome.length - 1, 1))}${dominio}`;
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Senhas na BD são quase sempre só dígitos; o utilizador pode digitar com máscara (CPF/CNPJ). */
function passwordVariants(password) {
  const s = String(password);
  const digits = s.replace(/\D/g, "");
  if (!digits) return [s];
  const set = new Set([s, digits]);
  return [...set];
}

async function bcryptMatches(storedHash, password) {
  for (const candidate of passwordVariants(password)) {
    if (await bcrypt.compare(candidate, storedHash)) return true;
  }
  return false;
}

const GENERIC_FORGOT_MSG =
  "Se os dados estiverem corretos e houver e-mail cadastrado, você receberá um link em instantes.";

/**
 * Cria o token de redefinição (só o hash fica na BD) e envia o link por e-mail.
 * Partilhado pelo "esqueci minha senha" (sem login) e pelo botão de quem já está logado.
 * Lança Error("EMAIL_FALHOU") se o envio falhar — o token é apagado antes.
 */
async function emitirLinkDeReset({ companyId, adminId, emailOnRecord, publicUrl }) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const ttlMin = Math.min(
    Math.max(parseInt(process.env.PASSWORD_RESET_EXPIRY_MINUTES || "60", 10), 5),
    24 * 7
  );
  const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (companyId) {
      await client.query(
        "DELETE FROM password_reset_tokens WHERE company_id = $1 AND used_at IS NULL",
        [companyId]
      );
      await client.query(
        `INSERT INTO password_reset_tokens (token_hash, expires_at, company_id)
         VALUES ($1, $2, $3)`,
        [tokenHash, expiresAt, companyId]
      );
    } else {
      await client.query(
        "DELETE FROM password_reset_tokens WHERE admin_id = $1 AND used_at IS NULL",
        [adminId]
      );
      await client.query(
        `INSERT INTO password_reset_tokens (token_hash, expires_at, admin_id)
         VALUES ($1, $2, $3)`,
        [tokenHash, expiresAt, adminId]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  const resetUrl = `${publicUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  try {
    await sendPasswordResetEmail({ to: emailOnRecord.trim(), resetUrl });
  } catch (err) {
    console.error("sendPasswordResetEmail:", err.message);
    await db.query("DELETE FROM password_reset_tokens WHERE token_hash = $1", [tokenHash]);
    throw new Error("EMAIL_FALHOU");
  }
}

router.post("/login", async (req, res) => {
  try {
    const raw = (req.body.login || req.body.cnpj || "").toString();
    const { password } = req.body;

    if (!raw || !validateString(password, 1, 128)) {
      return res.status(400).json({ error: "Login e senha obrigatórios" });
    }

    const clean = raw.replace(/\D/g, "");

    // Administrador: CPF 11 dígitos (tabela platform_admins). Não achando admin com
    // esse CPF, o fluxo SEGUE para o login de cliente: alguns clientes do G-Click são
    // pessoa física e o cadastro deles usa o CPF como identificador.
    const admins = clean.length === 11 ? await getAdminByCpfForLogin(db, clean) : [];
    if (admins.length) {
      if (!validateCPF(raw)) {
        return res.status(400).json({ error: "CPF inválido" });
      }
      const adm = admins[0];
      if (adm.active === false) {
        return res.status(403).json({ error: "Acesso desativado. Procure o administrador." });
      }
      const ok = await bcryptMatches(adm.password_hash, password);
      if (!ok) return res.status(401).json({ error: "Senha incorreta" });
      const token = generateAdminToken({ id: adm.id, cpf: adm.cpf });
      return res.json({
        token,
        role: "admin",
        admin: {
          id: adm.id,
          cpf: adm.cpf,
          nome: adm.nome || null,
          is_owner: Boolean(adm.is_owner),
          areas: mergeAreas(adm.areas),
          must_change_password: Boolean(adm.must_change_password),
        },
      });
    }

    // Cliente: CNPJ (14 dígitos) ou, para pessoa física, CPF (11).
    if (clean.length === 14 || clean.length === 11) {
      if (clean.length === 14 && !validateCNPJ(raw)) {
        return res.status(400).json({ error: "CNPJ inválido" });
      }
      const rows = await getCompanyByCnpjForLogin(db, clean);
      if (!rows.length) return res.status(401).json({ error: "Acesso não encontrado" });
      const company = rows[0];
      const valid = await bcryptMatches(company.password_hash, password);
      if (!valid) return res.status(401).json({ error: "Senha incorreta" });
      const token = generateToken({
        company_id: company.id,
        company_name: company.name,
        company_cnpj: company.cnpj,
      });
      // Carimba o acesso: é o que tira a empresa da lista de "nunca entrou" e,
      // com isso, das mensagens de incentivo. Falhar aqui não pode barrar o login.
      db.query("UPDATE companies SET ultimo_login_em = now() WHERE id = $1", [company.id]).catch(
        (e) => console.error("ultimo_login_em:", e.message)
      );
      return res.json({
        token,
        role: "company",
        company: {
          id: company.id,
          name: company.name,
          cnpj: company.cnpj,
          tool_access: mergeToolAccess(company.tool_access),
          // Ainda com a senha inicial (= CNPJ): o front leva direto para a troca.
          must_change_password: Boolean(company.must_change_password),
        },
      });
    }

    return res.status(400).json({
      error: "Informe CNPJ da empresa (14 dígitos) ou CPF do administrador (11 dígitos)",
    });
  } catch (err) {
    console.error("Login error:", err.message, err.code || "");
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  try {
    const rawLogin = (req.body.login || req.body.cnpj || req.body.cpf || "").toString();
    const emailRaw = req.body.email;
    if (!rawLogin || !validateString(emailRaw, 3, 254) || !validateEmailFormat(emailRaw)) {
      return res.status(400).json({ error: "Informe login (CNPJ ou CPF) e um e-mail válido" });
    }
    if (!isSmtpConfigured()) {
      return res.status(503).json({
        error: "Recuperação por e-mail não está configurada. Contacte o suporte.",
      });
    }
    const publicUrl = getPublicAppUrl();
    if (!publicUrl) {
      console.error("PUBLIC_APP_URL não definido — link de recuperação inválido");
      return res.status(503).json({ error: "Configuração incompleta do servidor." });
    }

    const clean = rawLogin.replace(/\D/g, "");
    const emailNorm = normalizeEmail(emailRaw);

    let companyId = null;
    let adminId = null;
    let emailOnRecord = null;

    if (clean.length === 11) {
      if (!validateCPF(rawLogin)) {
        return res.json({ message: GENERIC_FORGOT_MSG });
      }
      const { rows } = await db.query(
        "SELECT id, contact_email FROM platform_admins WHERE cpf = $1",
        [clean]
      );
      if (!rows.length || !rows[0].contact_email) {
        return res.json({ message: GENERIC_FORGOT_MSG });
      }
      if (normalizeEmail(rows[0].contact_email) !== emailNorm) {
        return res.json({ message: GENERIC_FORGOT_MSG });
      }
      adminId = rows[0].id;
      emailOnRecord = rows[0].contact_email;
    } else if (clean.length === 14) {
      if (!validateCNPJ(rawLogin)) {
        return res.json({ message: GENERIC_FORGOT_MSG });
      }
      const { rows } = await db.query(
        "SELECT id, contact_email FROM companies WHERE cnpj = $1",
        [clean]
      );
      if (!rows.length || !rows[0].contact_email) {
        return res.json({ message: GENERIC_FORGOT_MSG });
      }
      if (normalizeEmail(rows[0].contact_email) !== emailNorm) {
        return res.json({ message: GENERIC_FORGOT_MSG });
      }
      companyId = rows[0].id;
      emailOnRecord = rows[0].contact_email;
    } else {
      return res.status(400).json({
        error: "Login deve ser CNPJ (empresa) ou CPF (administrador)",
      });
    }

    try {
      await emitirLinkDeReset({ companyId, adminId, emailOnRecord, publicUrl });
    } catch (err) {
      if (err.message === "EMAIL_FALHOU") {
        return res.status(502).json({
          error: "Não foi possível enviar o e-mail. Tente novamente mais tarde.",
        });
      }
      throw err;
    }

    return res.json({ message: GENERIC_FORGOT_MSG });
  } catch (err) {
    console.error("forgot-password:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/reset-token", resetTokenCheckLimiter, async (req, res) => {
  try {
    const token = (req.query.token || "").toString();
    if (!validateString(token, 32, 128)) {
      return res.json({ valid: false });
    }
    const tokenHash = hashToken(token);
    const { rows } = await db.query(
      `SELECT id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash]
    );
    res.json({ valid: rows.length > 0 });
  } catch (err) {
    console.error("reset-token:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/reset-password", resetPasswordLimiter, async (req, res) => {
  try {
    const token = (req.body.token || "").toString();
    const password = req.body.password;
    if (!validateString(token, 32, 128) || !validateString(password, 8, 128)) {
      return res.status(400).json({
        error: "Token inválido ou senha muito curta (mínimo 8 caracteres)",
      });
    }
    const tokenHash = hashToken(token);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT id, company_id, admin_id FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [tokenHash]
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Link inválido ou expirado. Solicite um novo." });
      }
      const row = rows[0];
      const passwordHash = await bcrypt.hash(password, 10);
      if (row.company_id) {
        await client.query(
          "UPDATE companies SET password_hash = $1, must_change_password = false WHERE id = $2",
          [passwordHash, row.company_id]
        );
      } else {
        await client.query("UPDATE platform_admins SET password_hash = $1 WHERE id = $2", [
          passwordHash,
          row.admin_id,
        ]);
      }
      await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [row.id]);
      await client.query("COMMIT");
      res.json({ message: "Senha atualizada. Você já pode entrar." });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("reset-password:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Trocar a senha estando logado (senha atual + nova). Não depende de e-mail/SMTP —
 * é o caminho para quem não tem e-mail cadastrado.
 */
router.post("/change-password", authMiddleware, changePasswordLimiter, async (req, res) => {
  try {
    const current = req.body.current_password;
    const next = req.body.new_password;
    if (!current || typeof current !== "string") {
      return res.status(400).json({ error: "Informe a senha atual" });
    }
    if (!validateString(next, 8, 128)) {
      return res.status(400).json({ error: "A nova senha precisa de pelo menos 8 caracteres" });
    }

    const tabela = req.isAdmin ? "platform_admins" : "companies";
    const id = req.isAdmin ? req.admin?.id : req.company?.id;
    if (!id) return res.status(401).json({ error: "Sessão inválida" });

    const { rows } = await db.query(`SELECT password_hash FROM ${tabela} WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Cadastro não encontrado" });

    if (!(await bcryptMatches(rows[0].password_hash, current))) {
      return res.status(401).json({ error: "Senha atual incorreta" });
    }
    // Bloqueia "trocar" pela mesma senha — senão a marca de 1º acesso cairia à toa.
    if (await bcryptMatches(rows[0].password_hash, next)) {
      return res.status(400).json({ error: "A nova senha precisa ser diferente da atual" });
    }

    const hash = await bcrypt.hash(next, 10);
    if (req.isAdmin) {
      await db.query(
        "UPDATE platform_admins SET password_hash = $1, must_change_password = false WHERE id = $2",
        [hash, id]
      );
    } else {
      await db.query(
        "UPDATE companies SET password_hash = $1, must_change_password = false WHERE id = $2",
        [hash, id]
      );
    }
    // Links de redefinição pendentes deixam de valer: a senha já mudou.
    await db.query(
      `DELETE FROM password_reset_tokens
       WHERE used_at IS NULL AND ${req.isAdmin ? "admin_id" : "company_id"} = $1`,
      [id]
    );
    res.json({ message: "Senha alterada com sucesso." });
  } catch (err) {
    console.error("change-password:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Estando logado, pedir o link de redefinição para o e-mail já cadastrado.
 * Não recebe e-mail no corpo de propósito — evita que a sessão sirva para mandar
 * link para um endereço qualquer.
 */
router.post("/send-reset-link", authMiddleware, forgotPasswordLimiter, async (req, res) => {
  try {
    if (!isSmtpConfigured()) {
      return res.status(503).json({
        error: "Envio por e-mail não está configurado. Use a troca com a senha atual.",
      });
    }
    const publicUrl = getPublicAppUrl();
    if (!publicUrl) {
      return res.status(503).json({ error: "Configuração incompleta do servidor." });
    }

    const tabela = req.isAdmin ? "platform_admins" : "companies";
    const id = req.isAdmin ? req.admin?.id : req.company?.id;
    if (!id) return res.status(401).json({ error: "Sessão inválida" });

    const { rows } = await db.query(`SELECT contact_email FROM ${tabela} WHERE id = $1`, [id]);
    const email = rows[0]?.contact_email;
    if (!email) {
      return res.status(400).json({
        error: "Não há e-mail cadastrado. Peça à contabilidade para cadastrar, ou troque usando a senha atual.",
      });
    }

    try {
      await emitirLinkDeReset({
        companyId: req.isAdmin ? null : id,
        adminId: req.isAdmin ? id : null,
        emailOnRecord: email,
        publicUrl,
      });
    } catch (err) {
      if (err.message === "EMAIL_FALHOU") {
        return res.status(502).json({ error: "Não foi possível enviar o e-mail. Tente mais tarde." });
      }
      throw err;
    }
    // Mostra o e-mail mascarado: confirma o destino sem expor o endereço todo.
    res.json({ message: `Link enviado para ${maskEmail(email)}. Verifique a caixa de entrada.` });
  } catch (err) {
    console.error("send-reset-link:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Atualizar nome da empresa e permissões (tool_access) sem novo login — usa o mesmo Bearer. */
router.get("/company-session", authMiddleware, async (req, res) => {
  if (req.isAdmin) {
    return res.status(400).json({ error: "Este recurso é só para login de empresa (CNPJ)." });
  }
  if (!req.company?.id) {
    return res.status(401).json({ error: "Sessão inválida" });
  }
  // Férias só faz sentido para quem tem funcionário celetista: empresa só com
  // pró-labore não vê a seção. A regra vive em payrollRoles.js.
  let temFuncionarios = false;
  try {
    const { rows } = await db.query(
      `SELECT EXISTS (SELECT 1 FROM employees e WHERE e.company_id = $1 AND ${funcionarioRealSql("e")}) AS tem`,
      [req.company.id]
    );
    temFuncionarios = Boolean(rows[0]?.tem);
  } catch (err) {
    console.error("company-session funcionarios:", err.message);
  }

  // O estado do LGPD vem da base (não do token): o aviso do primeiro acesso some
  // assim que o cliente responde, sem precisar de novo login.
  let lgpd = { consent_at: null, prompt_seen_at: null, versao: null };
  try {
    const { rows } = await db.query(
      `SELECT lgpd_consent_at, lgpd_prompt_seen_at, lgpd_consent_version
         FROM companies WHERE id = $1`,
      [req.company.id]
    );
    if (rows.length) {
      lgpd = {
        consent_at: rows[0].lgpd_consent_at,
        prompt_seen_at: rows[0].lgpd_prompt_seen_at,
        versao: rows[0].lgpd_consent_version,
      };
    }
  } catch (err) {
    // Base ainda sem as colunas (migração por rodar): o portal segue normalmente.
    console.error("company-session lgpd:", err.message);
  }
  res.json({
    company: {
      id: req.company.id,
      name: req.company.name,
      cnpj: req.company.cnpj,
    },
    tool_access: req.companyToolAccess,
    tem_funcionarios: temFuncionarios,
    lgpd,
  });
});

/** Texto do termo LGPD (fonte única, ver src/lgpd.js). Público: é o que o cliente lê. */
router.get("/lgpd-termo", (_req, res) => {
  res.json(lgpdTermo());
});

/**
 * Registro do aceite. Idempotente: se já houver aceite, mantém a data original —
 * o consentimento é dado uma vez, não a cada visita.
 */
router.post("/lgpd-consent", authMiddleware, async (req, res) => {
  try {
    if (req.isAdmin || !req.company?.id) {
      return res.status(403).json({ error: "Recurso exclusivo para login de empresa" });
    }
    const ip = (req.ip || "").slice(0, 60) || null;
    const { rows } = await db.query(
      `UPDATE companies
          SET lgpd_consent_at = COALESCE(lgpd_consent_at, now()),
              lgpd_consent_ip = COALESCE(lgpd_consent_ip, $1),
              lgpd_consent_version = COALESCE(lgpd_consent_version, $2),
              lgpd_prompt_seen_at = COALESCE(lgpd_prompt_seen_at, now())
        WHERE id = $3
        RETURNING lgpd_consent_at, lgpd_consent_version`,
      [ip, LGPD_CONSENT_VERSION, req.company.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Empresa não encontrada" });
    res.json({ ok: true, consent_at: rows[0].lgpd_consent_at, versao: rows[0].lgpd_consent_version });
  } catch (err) {
    console.error("lgpd-consent:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Cliente viu o aviso e fechou sem aceitar. O aviso não bloqueia o portal e não
 * volta a aparecer; o admin vê "visto, sem aceite" na auditoria.
 */
router.post("/lgpd-visto", authMiddleware, async (req, res) => {
  try {
    if (req.isAdmin || !req.company?.id) {
      return res.status(403).json({ error: "Recurso exclusivo para login de empresa" });
    }
    await db.query(
      "UPDATE companies SET lgpd_prompt_seen_at = COALESCE(lgpd_prompt_seen_at, now()) WHERE id = $1",
      [req.company.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("lgpd-visto:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
