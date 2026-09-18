/**
 * Circulares: o escritório compõe texto + vídeo/imagem e manda para as empresas ativas.
 *
 * Fluxo da tela: cria a circular → manda para UMA empresa (teste) → confere no celular →
 * manda para todas. Quem já recebeu nesta circular não recebe de novo no segundo lote.
 *
 * Área "alertas": quem cuida do que sai pelo WhatsApp cuida também da circular.
 */
const router = require("express").Router();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID } = require("../middleware/validate");
const { UPLOAD_DIR } = require("../uploads");
const numeroWpp = require("../whatsappNumero");
const { dentroDaJanela, descricaoJanela } = require("../janelaEnvio");
const { minutosSP } = require("../diasBancarios");
const circular = require("../circular");

// Subpasta própria: a limpeza de órfãos (uploadsLimpeza.js) só varre a raiz do volume,
// então a mídia da circular nunca é apagada por engano.
const PASTA = "circulares";
const DIR = path.join(UPLOAD_DIR, PASTA);
fs.mkdirSync(DIR, { recursive: true });

// 16 MB: limite do WhatsApp para vídeo. Acompanha o client_max_body_size do nginx.
const MAX_MIDIA_BYTES = 16 * 1024 * 1024;
const MAX_TEXTO = 4000;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || "") || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
      // Nome aleatório: a pasta de uploads é servida publicamente (a uazapi precisa do link).
      cb(null, `${crypto.randomBytes(16).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: MAX_MIDIA_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!circular.tipoDaMidia(file.mimetype, file.originalname)) {
      return cb(new Error("Envie vídeo MP4 ou imagem JPG/PNG/WEBP."));
    }
    cb(null, true);
  },
});

function adminOnly(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: "Acesso restrito a administradores" });
  next();
}

router.use(authMiddleware);
router.use(adminOnly);
router.use(requireArea("alertas"));

const RESUMO_SQL = `
  SELECT c.id, c.texto, c.midia_nome, c.midia_tipo, c.midia_arquivo, c.status, c.ultimo_erro,
         c.criado_em, c.atualizado_em,
         count(e.id) FILTER (WHERE e.status = 'enviado')::int AS enviados,
         count(e.id) FILTER (WHERE e.status = 'pendente')::int AS pendentes,
         count(e.id) FILTER (WHERE e.status = 'falhou')::int AS falhas,
         count(e.id) FILTER (WHERE e.status IN ('sem_whatsapp', 'duplicado'))::int AS ignorados
    FROM circulares c
    LEFT JOIN circular_envios e ON e.circular_id = c.id`;

function comUrl(c) {
  return { ...c, midia_url: c.midia_arquivo ? `/api/uploads/${c.midia_arquivo}` : null, rodando: circular.estaRodando(c.id) };
}

/** Histórico de circulares (mais recente primeiro). */
router.get("/", async (_req, res) => {
  try {
    const { rows } = await db.query(`${RESUMO_SQL} GROUP BY c.id ORDER BY c.criado_em DESC LIMIT 50`);
    res.json(rows.map(comUrl));
  } catch (err) {
    console.error("[circulares] listar:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Empresas ativas (estritamente: nem arquivada, nem excluída) com o WhatsApp de envio. */
router.get("/destinatarios", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.cnpj, ${numeroWpp.celularSql()} AS whatsapp
         FROM companies c
         LEFT JOIN gclick_clients g ON g.company_id = c.id
        WHERE c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
        ORDER BY c.name`
    );
    res.json(
      rows.map((r) => {
        const v = numeroWpp.validar(r.whatsapp);
        return {
          id: r.id,
          name: r.name,
          cnpj: r.cnpj,
          whatsapp: v.ok ? numeroWpp.formatar(v.numero) : r.whatsapp || null,
          whatsapp_ok: v.ok,
          motivo: v.ok ? null : v.motivo,
        };
      })
    );
  } catch (err) {
    console.error("[circulares] destinatários:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Cria a circular (multipart: `texto` + `midia` opcional). */
router.post("/", (req, res) => {
  upload.single("midia")(req, res, async (erroUpload) => {
    if (erroUpload) {
      const msg =
        erroUpload.code === "LIMIT_FILE_SIZE" ? "Arquivo acima de 16 MB (limite do WhatsApp para vídeo)." : erroUpload.message;
      return res.status(400).json({ error: msg });
    }
    try {
      const texto = String(req.body?.texto || "").trim();
      if (!texto && !req.file) return res.status(400).json({ error: "Escreva o texto ou anexe um vídeo/imagem." });
      if (texto.length > MAX_TEXTO) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: `Texto acima de ${MAX_TEXTO} caracteres.` });
      }
      const tipo = req.file ? circular.tipoDaMidia(req.file.mimetype, req.file.originalname) : null;
      const { rows } = await db.query(
        `INSERT INTO circulares (texto, midia_arquivo, midia_nome, midia_tipo, criado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          texto,
          req.file ? `${PASTA}/${req.file.filename}` : null,
          req.file ? req.file.originalname : null,
          tipo,
          req.admin?.id || null,
        ]
      );
      const { rows: r } = await db.query(`${RESUMO_SQL} WHERE c.id = $1 GROUP BY c.id`, [rows[0].id]);
      res.status(201).json(comUrl(r[0]));
    } catch (err) {
      if (req.file) fs.unlink(req.file.path, () => {});
      console.error("[circulares] criar:", err.message);
      res.status(500).json({ error: "Erro ao salvar a circular" });
    }
  });
});

/** Uma circular com o andamento por empresa. */
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const { rows } = await db.query(`${RESUMO_SQL} WHERE c.id = $1 GROUP BY c.id`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Circular não encontrada" });
    const { rows: envios } = await db.query(
      `SELECT id, company_id, empresa_nome, numero, status, erro, enviado_em
         FROM circular_envios WHERE circular_id = $1
        ORDER BY criado_em, empresa_nome`,
      [id]
    );
    res.json({ ...comUrl(rows[0]), envios });
  } catch (err) {
    console.error("[circulares] detalhe:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Manda para as empresas escolhidas (uma = teste; todas = envio geral). Quem já está
 * nesta circular fica de fora. Responde na hora; o envio segue em segundo plano.
 */
router.post("/:id/enviar", async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
  const ids = Array.isArray(req.body?.company_ids) ? req.body.company_ids : [];
  if (!ids.length || !ids.every(validateUUID)) {
    return res.status(400).json({ error: "Escolha ao menos uma empresa." });
  }
  if (!dentroDaJanela(minutosSP())) {
    return res.status(409).json({ error: `Fora da janela de envio (${descricaoJanela()}). Envie durante o dia.` });
  }
  try {
    const { rows: cs } = await db.query("SELECT id FROM circulares WHERE id = $1", [id]);
    if (!cs.length) return res.status(404).json({ error: "Circular não encontrada" });

    const { rows: empresas } = await db.query(
      `SELECT c.id, c.name, ${numeroWpp.celularSql()} AS whatsapp
         FROM companies c
         LEFT JOIN gclick_clients g ON g.company_id = c.id
        WHERE c.id = ANY($1) AND c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
        ORDER BY c.name`,
      [ids]
    );
    const { rows: existentes } = await db.query(
      `SELECT company_id, numero, status FROM circular_envios
        WHERE circular_id = $1 AND status IN ('enviado', 'pendente')`,
      [id]
    );
    const envios = circular.planejarEnvios(empresas, {
      jaNaCircular: new Set(existentes.map((e) => e.company_id)),
      numerosJaUsados: new Set(existentes.map((e) => e.numero).filter(Boolean)),
    });

    // Falhas anteriores das mesmas empresas voltam para a fila em vez de duplicar a linha.
    for (const e of envios) {
      const { rowCount } = await db.query(
        `UPDATE circular_envios SET status = $3, numero = $4, erro = $5
          WHERE circular_id = $1 AND company_id = $2 AND status IN ('falhou', 'sem_whatsapp', 'duplicado')`,
        [id, e.company_id, e.status, e.numero, e.erro]
      );
      if (!rowCount) {
        await db.query(
          `INSERT INTO circular_envios (circular_id, company_id, empresa_nome, numero, status, erro)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, e.company_id, e.empresa_nome, e.numero, e.status, e.erro]
        );
      }
    }

    const naFila = envios.filter((e) => e.status === "pendente").length;
    if (naFila) setImmediate(() => circular.processar(db, id));
    res.json({
      na_fila: naFila,
      ignorados: envios.length - naFila,
      ja_estavam: empresas.length - envios.length,
      minutos_estimados: Math.ceil((naFila * 30) / 60),
    });
  } catch (err) {
    console.error("[circulares] enviar:", err.message);
    res.status(500).json({ error: "Erro ao iniciar o envio" });
  }
});

/** Retoma uma circular pausada (janela, reinício, instância caída). */
router.post("/:id/retomar", async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
  if (!dentroDaJanela(minutosSP())) {
    return res.status(409).json({ error: `Fora da janela de envio (${descricaoJanela()}).` });
  }
  setImmediate(() => circular.processar(db, id));
  res.json({ ok: true });
});

/** Para o envio depois da mensagem em curso. O que falta fica pendente para retomar. */
router.post("/:id/parar", async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
  res.json({ ok: true, estava_rodando: circular.pedirParada(id) });
});

/** Apaga a circular que ainda não mandou nada (e a mídia dela). */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const { rows: env } = await db.query(
      "SELECT 1 FROM circular_envios WHERE circular_id = $1 AND status = 'enviado' LIMIT 1",
      [id]
    );
    if (env.length) return res.status(409).json({ error: "Esta circular já foi enviada — fica no histórico." });
    if (circular.estaRodando(id)) return res.status(409).json({ error: "Envio em andamento." });
    const { rows } = await db.query("DELETE FROM circulares WHERE id = $1 RETURNING midia_arquivo", [id]);
    if (!rows.length) return res.status(404).json({ error: "Circular não encontrada" });
    if (rows[0].midia_arquivo) fs.unlink(path.join(UPLOAD_DIR, rows[0].midia_arquivo), () => {});
    res.json({ ok: true });
  } catch (err) {
    console.error("[circulares] apagar:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
