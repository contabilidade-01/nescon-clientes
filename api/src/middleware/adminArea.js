/**
 * Trava de acesso por área do painel.
 *
 * Esconder o item no menu é conforto; o que impede um usuário restrito de ler dados de
 * outra área é ESTE middleware. Sem ele bastaria chamar a API direto.
 *
 * As permissões vêm do banco a cada requisição (ver middleware/auth.js), não do token:
 * tirar o acesso de alguém tem efeito imediato, sem esperar o JWT expirar.
 */

/** O dono vê tudo; os demais, só o que estiver marcado. */
function adminHasArea(req, area) {
  if (!req.isAdmin) return false;
  if (req.admin?.isOwner) return true;
  return Boolean(req.admin?.areas?.[area]);
}

/** Bloqueia a rota para quem não tem a área. Use depois de authMiddleware. */
function requireArea(area) {
  return function (req, res, next) {
    if (!req.isAdmin) {
      return res.status(403).json({ error: "Acesso restrito a administradores" });
    }
    if (!adminHasArea(req, area)) {
      return res.status(403).json({ error: "Você não tem acesso a esta área do painel" });
    }
    next();
  };
}

/** Rotas de gestão de usuários: só o dono. */
function requireOwner(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: "Acesso restrito a administradores" });
  }
  if (!req.admin?.isOwner) {
    return res.status(403).json({ error: "Só o administrador dono pode gerenciar usuários" });
  }
  next();
}

module.exports = { adminHasArea, requireArea, requireOwner };
