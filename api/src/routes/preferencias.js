/**
 * Preferências de aviso — decididas pelo CLIENTE, no portal dele.
 *
 * Até aqui, quem não queria mensagem tinha de ligar para o escritório e pedir para
 * alguém desmarcar. Isso transforma incômodo em ligação, e ligação em nada feito: o
 * cliente reclama uma vez, ninguém desliga, e ele passa a ignorar o canal inteiro.
 *
 * Duas decisões distintas moram aqui, de donos diferentes:
 *
 *  - `avisos_documentos_ativos` — "não quero ser avisado quando chega documento novo".
 *    Chave do cliente. O escritório VÊ no painel, mas não desfaz por lá: a coluna do
 *    escritório é outra (`alertas_ativos`).
 *  - dispensa do aviso de férias — "já recebi este, pode parar". Vale por
 *    **funcionário × limite**, nunca em geral: dispensa global calaria também o
 *    funcionário que vence daqui a três meses, e o passivo apareceria sem aviso.
 *
 * O alerta de VENCIMENTO de guia não entra nesta tela de propósito. Ele existe para
 * evitar multa, e desligar sozinho o aviso do que se paga com juros não é conveniência
 * — é prejuízo silencioso. Quem quiser parar fala com o escritório, que desliga em
 * `alertas_ativos` sabendo o que está fazendo.
 */
const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { validateUUID, validateString } = require("../middleware/validate");

router.use(authMiddleware);

/** A empresa da sessão. Admin precisa dizer qual — nunca há empresa "padrão". */
function empresaDe(req) {
  if (req.isAdmin) {
    const id = (req.query.company_id || req.body?.company_id || "").toString();
    if (!validateUUID(id)) return { erro: "Informe company_id" };
    return { companyId: id };
  }
  if (!req.company?.id) return { erro: "Sessão de empresa inválida" };
  return { companyId: req.company.id };
}

/** O que o cliente escolheu, e o que ele já dispensou. */
router.get("/", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(400).json({ error: erro });
  try {
    const { rows } = await db.query(
      `SELECT avisos_documentos_ativos, avisos_alterados_em FROM companies WHERE id = $1`,
      [companyId]
    );
    if (!rows.length) return res.status(404).json({ error: "Empresa não encontrada" });

    const { rows: acks } = await db.query(
      `SELECT funcionario, to_char(limite_gozo, 'YYYY-MM-DD') AS limite_gozo, criado_em
         FROM vacation_alert_acks WHERE company_id = $1
        ORDER BY limite_gozo`,
      [companyId]
    );

    res.json({
      avisos_documentos_ativos: rows[0].avisos_documentos_ativos,
      avisos_alterados_em: rows[0].avisos_alterados_em,
      ferias_dispensadas: acks,
    });
  } catch (err) {
    console.error("[preferencias] ler:", err.message);
    res.status(500).json({ error: "Erro ao carregar as preferências" });
  }
});

/** Ligar/desligar o aviso de documento novo. */
router.put("/", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(400).json({ error: erro });
  const { avisos_documentos_ativos } = req.body || {};
  if (typeof avisos_documentos_ativos !== "boolean") {
    return res.status(400).json({ error: "avisos_documentos_ativos deve ser booleano" });
  }
  try {
    const { rows } = await db.query(
      `UPDATE companies
          SET avisos_documentos_ativos = $2, avisos_alterados_em = now()
        WHERE id = $1
        RETURNING avisos_documentos_ativos, avisos_alterados_em`,
      [companyId, avisos_documentos_ativos]
    );
    if (!rows.length) return res.status(404).json({ error: "Empresa não encontrada" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[preferencias] gravar:", err.message);
    res.status(500).json({ error: "Erro ao salvar" });
  }
});

/**
 * "Já recebi este aviso de férias." Idempotente: marcar duas vezes não é erro, é a
 * mesma vontade repetida.
 */
router.post("/ferias-visto", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(400).json({ error: erro });
  const { funcionario, limite_gozo } = req.body || {};
  if (!validateString(funcionario, 1, 200)) {
    return res.status(400).json({ error: "funcionario inválido" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(limite_gozo || ""))) {
    return res.status(400).json({ error: "limite_gozo deve ser YYYY-MM-DD" });
  }
  try {
    await db.query(
      `INSERT INTO vacation_alert_acks (company_id, funcionario, limite_gozo)
       VALUES ($1, $2, $3::date)
       ON CONFLICT (company_id, funcionario, limite_gozo) DO NOTHING`,
      [companyId, funcionario, limite_gozo]
    );
    res.json({ dispensado: true, funcionario, limite_gozo });
  } catch (err) {
    console.error("[preferencias] ferias-visto:", err.message);
    res.status(500).json({ error: "Erro ao registrar" });
  }
});

/** Desfazer a dispensa — voltar a receber o aviso daquele funcionário. */
router.delete("/ferias-visto", async (req, res) => {
  const { companyId, erro } = empresaDe(req);
  if (erro) return res.status(400).json({ error: erro });
  const { funcionario, limite_gozo } = req.body || {};
  if (!validateString(funcionario, 1, 200) || !/^\d{4}-\d{2}-\d{2}$/.test(String(limite_gozo || ""))) {
    return res.status(400).json({ error: "funcionario e limite_gozo são obrigatórios" });
  }
  try {
    await db.query(
      `DELETE FROM vacation_alert_acks
        WHERE company_id = $1 AND funcionario = $2 AND limite_gozo = $3::date`,
      [companyId, funcionario, limite_gozo]
    );
    res.json({ dispensado: false });
  } catch (err) {
    console.error("[preferencias] desfazer:", err.message);
    res.status(500).json({ error: "Erro ao desfazer" });
  }
});

module.exports = router;
