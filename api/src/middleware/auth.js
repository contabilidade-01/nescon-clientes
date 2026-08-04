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
      "SELECT cpf, nome, areas, is_owner, active FROM platform_admins WHERE id = $1",
      [adminId]
    );
    if (!rows.length || rows[0].active === false) return null;
    return {
      cpf: rows[0].cpf,
      nome: rows[0].nome,
      isOwner: Boolean(rows[0].is_owner),
      areas: mergeAreas(rows[0].areas),
    };
  } catch (err) {
    if (err.code !== "42703") throw err;
    const { rows } = await dbConn.query("SELECT cpf FROM platform_admins WHERE id = $1", [adminId]);
    if (!rows.length) return null;
    return { cpf: rows[0].cpf, nome: null, isOwner: true, areas: mergeAreas(null) };
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
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
    } else if (decoded.company_id) {
      req.isAdmin = false;
      req.admin = null;
      req.company = {
        id: decoded.company_id,
        name: decoded.company_name,
        cnpj: decoded.company_cnpj,
      };
      req.companyToolAccess = await getToolAccessForCompany(db, decoded.company_id);
    } else {
      return res.status(401).json({ error: "Token inválido" });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
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
  requireCompanyUser,
  getAdminProfile,
  JWT_SECRET,
};
