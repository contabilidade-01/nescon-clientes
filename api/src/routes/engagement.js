/**
 * Repositório de mensagens de incentivo + panorama de quem nunca entrou no portal.
 *
 * Fica sob a área **alertas** porque a mensagem pega carona no alerta de vencimento:
 * quem decide quem recebe alerta é quem escreve o que vai junto.
 */
const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID, validateString } = require("../middleware/validate");
const {
  panoramaEngajamento,
  configuracao,
  salvarConfiguracao,
} = require("../engagement");
const { montarTexto } = require("../engagementRules");

const CATEGORIAS = ["acesso", "ferias", "documentos", "dp", "geral"];

function adminOnly(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: "Acesso restrito a administradores" });
  next();
}

router.use(authMiddleware);
router.use(adminOnly);
router.use(requireArea("alertas"));

/** Mensagens + configuração + quantos clientes estão na fila. */
router.get("/", async (_req, res) => {
  try {
    const [{ rows: mensagens }, cfg, panorama] = await Promise.all([
      db.query(
        `SELECT m.*,
                (SELECT count(*)::int FROM engagement_sends s WHERE s.message_id = m.id) AS enviada_vezes
           FROM engagement_messages m
          ORDER BY m.ordem, m.criado_em`
      ),
      configuracao(db),
      panoramaEngajamento(db),
    ]);
    res.json({
      mensagens,
      config: cfg,
      nunca_acessaram: panorama.nunca_acessaram,
      total_empresas: panorama.total,
    });
  } catch (err) {
    console.error("[engajamento listar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Lista completa para a aba "Quem nunca entrou". */
router.get("/panorama", async (_req, res) => {
  try {
    res.json(await panoramaEngajamento(db));
  } catch (err) {
    console.error("[engajamento panorama]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

function lerCampos(body) {
  const titulo = String(body?.titulo || "").trim();
  const texto = String(body?.texto || "").trim();
  const categoria = CATEGORIAS.includes(body?.categoria) ? body.categoria : "geral";
  if (!validateString(titulo, 2, 80)) return { erro: "Título de 2 a 80 caracteres" };
  // Teto de 400: é WhatsApp. Texto longo o cliente não lê e vira incômodo.
  if (!validateString(texto, 10, 400)) return { erro: "Mensagem de 10 a 400 caracteres" };
  return { titulo, texto, categoria };
}

router.post("/", async (req, res) => {
  try {
    const c = lerCampos(req.body);
    if (c.erro) return res.status(400).json({ error: c.erro });
    const { rows } = await db.query(
      `INSERT INTO engagement_messages (titulo, texto, categoria, ordem)
       VALUES ($1, $2, $3, COALESCE((SELECT max(ordem) + 1 FROM engagement_messages), 1))
       RETURNING *`,
      [c.titulo, c.texto, c.categoria]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[engajamento criar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });

    // Ligar/desligar é o caminho comum: aceita sozinho, sem exigir o texto.
    if (
      Object.prototype.hasOwnProperty.call(req.body, "ativa") &&
      !Object.prototype.hasOwnProperty.call(req.body, "texto")
    ) {
      if (typeof req.body.ativa !== "boolean") {
        return res.status(400).json({ error: "ativa deve ser true ou false" });
      }
      const { rows, rowCount } = await db.query(
        `UPDATE engagement_messages SET ativa = $2, atualizado_em = now()
          WHERE id = $1 RETURNING *`,
        [id, req.body.ativa]
      );
      if (!rowCount) return res.status(404).json({ error: "Mensagem não encontrada" });
      return res.json(rows[0]);
    }

    const c = lerCampos(req.body);
    if (c.erro) return res.status(400).json({ error: c.erro });
    const { rows, rowCount } = await db.query(
      `UPDATE engagement_messages
          SET titulo = $2, texto = $3, categoria = $4,
              ativa = COALESCE($5, ativa), atualizado_em = now()
        WHERE id = $1
        RETURNING *`,
      [id, c.titulo, c.texto, c.categoria, typeof req.body.ativa === "boolean" ? req.body.ativa : null]
    );
    if (!rowCount) return res.status(404).json({ error: "Mensagem não encontrada" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[engajamento editar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const { rowCount } = await db.query("DELETE FROM engagement_messages WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Mensagem não encontrada" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[engajamento apagar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Frequência: a cada quantos avisos e o piso de dias entre mensagens. */
router.put("/config", async (req, res) => {
  try {
    res.json(
      await salvarConfiguracao(db, {
        aCadaEnvios: req.body?.a_cada_envios,
        intervaloMinimoDias: req.body?.intervalo_minimo_dias,
      })
    );
  } catch (err) {
    console.error("[engajamento config]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Prévia com os marcadores trocados — para conferir antes de ativar. */
router.post("/previa", (req, res) => {
  res.json({
    texto: montarTexto(req.body?.texto || "", {
      portal: process.env.PUBLIC_APP_URL || "https://app.gestaoempresa.com",
      empresa: "EMPRESA EXEMPLO LTDA",
    }),
  });
});

module.exports = router;
