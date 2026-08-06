const jwt = require("jsonwebtoken");
const db = require("../db");
const { getToolAccessForCompany } = require("../toolAccessDb");
const { mergeAreas } = require("../adminAreas");

/**
 * Perfil do administrador na base. Devolve null se não existe ou está desativado.
 * Base antiga sem as colunas novas (42703): trata como dono, para não trancar ninguém
 * para fora antes de a migração rodar.
 */
async function getAdminProfile(dbConn, adminId) {
  try {
    const { rows } = await dbConn.query(
      "SELECT cpf, nome, areas, is_owner, active, must_change_password FROM platform_admins WHERE id = $1",
      [adminId]
    );
    if (!rows.length || rows[0].active === false) return null;
    return {
      cpf: rows[0].cpf,
      nome: rows[0].nome,
      isOwner: Boolean(rows[0].is_owner),
      areas: mergeAreas(rows[0].areas),
      mustChangePassword: Boolean(rows[0].must_change_password),
    };
  } catch (err) {
    if (err.code !== "42703") throw err;
    const { rows } = await dbConn.query("SELECT cpf FROM platform_admins WHERE id = $1", [adminId]);
    if (!rows.length) return null;
    return { cpf: rows[0].cpf, nome: null, isOwner: true, areas: mergeAreas(null) };
  }
}

/**
 * O segredo que assina TODOS os tokens. Sem ele, qualquer pessoa que leia este arquivo
 * forja um token de administrador — e o valor padrão antigo estava versionado aqui.
 *
 * Por isso a API **não sobe** sem um segredo próprio, em vez de subir insegura e
 * silenciosa: um sistema que não arranca é um chamado de dez minutos; um sistema que
 * arranca com o segredo público é uma invasão que ninguém percebe.
 *
 * A lista abaixo pega os padrões que já circularam no repositório e no compose.
 */
const SEGREDOS_PROIBIDOS = [
  "change-this-secret-in-production",
  "troque-este-segredo-em-producao",
  "secret",
  "changeme",
];

function segredoValido() {
  const s = (process.env.JWT_SECRET || "").trim();
  if (!s) return { ok: false, motivo: "JWT_SECRET não está definido." };
  if (SEGREDOS_PROIBIDOS.includes(s.toLowerCase())) {
    return { ok: false, motivo: "JWT_SECRET ainda é o valor de exemplo." };
  }
  if (s.length < 32) {
    return { ok: false, motivo: `JWT_SECRET é curto demais (${s.length} caracteres, mínimo 32).` };
  }
  return { ok: true };
}

const conferencia = segredoValido();
if (!conferencia.ok) {
  console.error(
    [
      "",
      `[SEGURANCA] ${conferencia.motivo}`,
      "Sem um segredo proprio qualquer um forja um token de administrador.",
      "Gere um com:  openssl rand -hex 32",
      "e defina JWT_SECRET no ambiente do servico.",
      "",
    ].join("\n")
  );
  // `NODE_ENV=test` deixa a suíte rodar sem exigir segredo — os testes não assinam nada.
  if (process.env.NODE_ENV !== "test") process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = "8h";

/** JWT de empresa (CNPJ) */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/** JWT de administrador (CPF na tabela platform_admins) */
function generateAdminToken(admin) {
  return jwt.sign(
    { role: "admin", admin_id: admin.id, admin_cpf: admin.cpf },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === "admin") {
      // Permissões vêm da BASE, não do token: alterar ou desativar um usuário tem
      // efeito na requisição seguinte, sem esperar o JWT expirar.
      const perfil = await getAdminProfile(db, decoded.admin_id);
      if (!perfil) return res.status(401).json({ error: "Acesso não encontrado ou desativado" });
      req.isAdmin = true;
      req.admin = {
        id: decoded.admin_id,
        cpf: perfil.cpf || decoded.admin_cpf || "",
        nome: perfil.nome || null,
        isOwner: perfil.isOwner,
        areas: perfil.areas,
      };
      req.company = null;
      req.companyToolAccess = null;
      req.mustChangePassword = Boolean(perfil.mustChangePassword);
    } else if (decoded.company_id) {
      req.isAdmin = false;
      req.admin = null;
      req.company = {
        id: decoded.company_id,
        name: decoded.company_name,
        cnpj: decoded.company_cnpj,
      };
      req.companyToolAccess = await getToolAccessForCompany(db, decoded.company_id);
      // Lido da BASE, não do token: quem trocou a senha noutra aba deixa de ser barrado
      // na requisição seguinte, sem esperar o JWT expirar.
      try {
        const { rows } = await db.query(
          "SELECT must_change_password FROM companies WHERE id = $1",
          [decoded.company_id]
        );
        req.mustChangePassword = Boolean(rows[0]?.must_change_password);
      } catch {
        req.mustChangePassword = false;
      }
    } else {
      return res.status(401).json({ error: "Token inválido" });
    }
    // A checagem mora AQUI, e não como middleware solto no index: aplicada no app antes
    // das rotas ela rodaria antes desta função e leria `mustChangePassword` indefinido,
    // deixando tudo passar. Dentro, vale para toda rota autenticada — inclusive as que
    // alguém criar amanhã sem lembrar disso.
    return blockUntilPasswordChanged(req, res, next);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

/**
 * Barra quem ainda está com a SENHA INICIAL.
 *
 * O front já redireciona para a troca, mas isso é conforto de navegação: quem entrar com
 * a senha inicial e chamar a API direto — `curl`, Postman, qualquer coisa — recebia os
 * documentos normalmente. A trava existia só na tela.
 *
 * Importa porque a senha inicial da empresa é o próprio CNPJ, que é público. Enquanto
 * ninguém trocar, aquele acesso vale para qualquer um que saiba o CNPJ.
 *
 * As exceções são as rotas necessárias para SAIR desse estado: ver quem se é e trocar a
 * senha. Bloquear essas transformaria a proteção em porta trancada por dentro.
 */
const ROTAS_LIVRES_SENHA_INICIAL = [
  "/api/auth/change-password",
  // A tela de troca precisa saber quem está logado para se desenhar.
  "/api/auth/company-session",
  "/api/auth/send-reset-link",
  "/api/health",
];

function blockUntilPasswordChanged(req, res, next) {
  if (!req.mustChangePassword) return next();
  const caminho = req.originalUrl.split("?")[0];
  if (ROTAS_LIVRES_SENHA_INICIAL.some((r) => caminho === r || caminho.startsWith(`${r}/`))) {
    return next();
  }
  return res.status(403).json({
    error: "Troque a senha inicial antes de usar o sistema.",
    code: "MUST_CHANGE_PASSWORD",
  });
}

/** Rotas de cadastro/emitir documento: só empresa, não admin */
function requireCompanyUser(req, res, next) {
  if (req.isAdmin || !req.company?.id) {
    return res.status(403).json({ error: "Recurso exclusivo para login de empresa" });
  }
  next();
}

module.exports = {
  generateToken,
  generateAdminToken,
  authMiddleware,
  blockUntilPasswordChanged,
  requireCompanyUser,
  getAdminProfile,
  JWT_SECRET,
};
