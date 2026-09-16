/**
 * Integração legada com o app externo de envio de guias (guias.gestaoempresa.com / GCLICK).
 *
 * DESLIGADA DE FORMA DEFINITIVA (set/2026): avisos WhatsApp (boletos, documentos, folha,
 * honorários) saem SOMENTE deste portal (alertasEnvio / docNotify / honorarios*). O app
 * externo foi desativado na VPS — estas rotas não devem mais ser chamadas nem reativar
 * envio paralelo na mesma instância uazapi.
 *
 * Qualquer POST/GET em /api/fiscal/* responde 410 Gone.
 */
const router = require("express").Router();

function desativado(_req, res) {
  res.status(410).json({
    error:
      "Integração com o app de guias foi desativada. Alertas e avisos saem apenas pelo portal (app.gestaoempresa.com).",
  });
}

router.all("*", desativado);

module.exports = router;
