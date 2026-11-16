/**
 * Envio de documentos pelo cliente, sem login — página /enviar.
 *
 * Público (`/api/envio-avulso`):
 *   GET  /tipos          → { tipos: [{chave, rotulo}], max_arquivos, max_mb_arquivo, max_mb_envio, accept }
 *   GET  /empresa?cnpj=  → { encontrada, nome }   (só o nome, como no /avulso)
 *   POST /enviar         → multipart: cnpj, tipo, observacao?, remetente?, arquivos[] (1..10)
 *
 * Painel (`/api/admin/envios-avulsos`, área "entregas"):
 *   GET   /                     → lista (filtro status/busca)
 *   PATCH /:id                  → { status: "novo" | "tratado" }
 *   GET   /arquivos/:id/file    → download (sempre como anexo, nunca exibido no navegador)
 *
 * Proteções (o link é público; quem sabe um CNPJ consegue enviar):
 * - Limite por IP na consulta e no envio, mais teto por empresa e teto geral por dia
 *   (ninguém enche o disco nem o WhatsApp do escritório com envios em massa).
 * - Arquivo conferido pelo CONTEÚDO (ver ../envioAvulso.js); lista fechada de formatos.
 * - Grava em pasta própria com nome aleatório. A pasta começa com ponto e ainda é barrada
 *   explicitamente em index.js: o `express.static` de /api/uploads não a serve.
 * - Nada da empresa volta para quem envia além do nome. O aviso vai só para o escritório.
 * - Campo-isca (`site`) para robô: se vier preenchido, finge sucesso e descarta.
 */
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { UPLOAD_DIR, corrigirNomeUtf8 } = require("../uploads");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID } = require("../middleware/validate");
const { isSmtpConfigured, createTransport, getPublicAppUrl } = require("../mailer");
const { configurado: whatsappConfigurado, enviarTexto } = require("../uazapi");
const regras = require("../envioAvulso");

const ARQUIVOS_DIR = path.join(path.resolve(UPLOAD_DIR), ".envios-avulsos");
fs.mkdirSync(ARQUIVOS_DIR, { recursive: true, mode: 0o750 });

const AVISO_EMAIL = process.env.ENVIO_AVULSO_EMAIL || process.env.DP_EMAIL || "dp@nesconcontabilidade.com.br";
const AVISO_WHATSAPP = (process.env.ENVIO_AVULSO_WHATSAPP || process.env.ADMIN_WHATSAPP || "5511948626605").replace(/\D/g, "");

/** Teto de envios aceitos em 24 h — por empresa e no total. */
const TETO_EMPRESA_DIA = 40;
const TETO_GERAL_DIA = 500;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: regras.MAX_BYTES_ARQUIVO,
    files: regras.MAX_ARQUIVOS,
    fields: 10,
    fieldSize: 4 * 1024,
    parts: regras.MAX_ARQUIVOS + 10,
  },
});

const limiteConsulta = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas consultas. Aguarde alguns minutos." },
});

const limiteEnvio = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitos envios em pouco tempo. Aguarde alguns minutos." },
});

function semCache(_req, res, next) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store, private");
  next();
}

async function empresaPorCnpj(cnpj) {
  const { rows } = await db.query(
    `SELECT id, name, cnpj FROM companies
      WHERE regexp_replace(cnpj, '[^0-9]', '', 'g') = $1
        AND COALESCE(arquivada, false) = false
        AND COALESCE(excluida, false) = false
      LIMIT 1`,
    [cnpj]
  );
  return rows[0] || null;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ───────────────────────────── público ───────────────────────────── */

const publicRouter = express.Router();
publicRouter.use(semCache);

publicRouter.get("/tipos", (_req, res) => {
  res.json({
    tipos: regras.TIPOS.map(({ chave, rotulo }) => ({ chave, rotulo })),
    max_arquivos: regras.MAX_ARQUIVOS,
    max_mb_arquivo: regras.MAX_BYTES_ARQUIVO / (1024 * 1024),
    max_mb_envio: regras.MAX_BYTES_ENVIO / (1024 * 1024),
    accept: regras.ACCEPT_HTML,
  });
});

publicRouter.get("/empresa", limiteConsulta, async (req, res) => {
  try {
    const cnpj = regras.digitos(req.query.cnpj);
    if (cnpj.length !== 14) return res.status(400).json({ error: "CNPJ inválido." });
    const empresa = await empresaPorCnpj(cnpj);
    if (!empresa) return res.json({ encontrada: false });
    return res.json({ encontrada: true, nome: empresa.name });
  } catch (err) {
    console.error("[envio-avulso] empresa:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** multer com erro traduzido (tamanho, quantidade) em vez de 500. */
function receberArquivos(req, res, next) {
  // Corta cedo o que já declara ser grande demais (o nginx também barra; isto vale sem ele).
  const declarado = Number(req.headers["content-length"] || 0);
  if (declarado > regras.MAX_BYTES_ENVIO + 1024 * 1024) {
    return res.status(413).json({ error: `O envio passa de ${regras.MAX_BYTES_ENVIO / (1024 * 1024)} MB. Divida em mais de um envio.` });
  }
  upload.array("arquivos", regras.MAX_ARQUIVOS)(req, res, (err) => {
    if (!err) return next();
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "Um dos arquivos passa de 10 MB."
        : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE"
          ? `Envie no máximo ${regras.MAX_ARQUIVOS} arquivos por vez.`
          : "Envio inválido.";
    return res.status(400).json({ error: msg });
  });
}

publicRouter.post("/enviar", limiteEnvio, receberArquivos, async (req, res) => {
  const gravados = [];
  try {
    // Campo-isca: invisível para gente, robô preenche. Responde como se fosse sucesso.
    if (String(req.body?.site || "").trim()) return res.status(201).json({ ok: true, protocolo: "EV-000000" });

    const campos = regras.validarCampos(req.body);
    if (campos.erro) return res.status(400).json({ error: campos.erro });

    const arquivos = Array.isArray(req.files) ? req.files : [];
    if (!arquivos.length) return res.status(400).json({ error: "Anexe pelo menos um arquivo." });
    const total = arquivos.reduce((s, f) => s + (f.size || 0), 0);
    if (total > regras.MAX_BYTES_ENVIO) {
      return res.status(400).json({ error: `O envio passa de ${regras.MAX_BYTES_ENVIO / (1024 * 1024)} MB. Divida em mais de um envio.` });
    }
    const conferidos = [];
    for (const f of arquivos) {
      const c = regras.conferirArquivo({ ...f, originalname: corrigirNomeUtf8(f.originalname) });
      if (c.erro) return res.status(400).json({ error: c.erro });
      conferidos.push({ ...c, buffer: f.buffer });
    }

    const empresa = await empresaPorCnpj(campos.cnpj);
    if (!empresa) return res.status(404).json({ error: "Empresa não encontrada no cadastro da Nescon." });

    const { rows: cont } = await db.query(
      `SELECT count(*) FILTER (WHERE company_id = $1)::int AS empresa, count(*)::int AS geral
         FROM envios_avulsos WHERE created_at > now() - interval '24 hours'`,
      [empresa.id]
    );
    if (cont[0].empresa >= TETO_EMPRESA_DIA || cont[0].geral >= TETO_GERAL_DIA) {
      console.warn(`[envio-avulso] teto diário atingido (empresa ${empresa.cnpj}, ip ${req.ip})`);
      return res.status(429).json({ error: "Limite de envios de hoje atingido. Fale com a Nescon pelo WhatsApp." });
    }

    for (const c of conferidos) {
      const arquivo = `${crypto.randomUUID()}.${c.ext}`;
      fs.writeFileSync(path.join(ARQUIVOS_DIR, arquivo), c.buffer, { mode: 0o640, flag: "wx" });
      gravados.push({
        arquivo,
        nome: c.nome,
        tamanho: c.buffer.length,
        sha256: crypto.createHash("sha256").update(c.buffer).digest("hex"),
      });
    }

    const ip = String(req.ip || "").slice(0, 60);
    const cliente = await db.connect();
    let protocolo;
    try {
      await cliente.query("BEGIN");
      let envioId;
      for (let tentativa = 0; tentativa < 5 && !envioId; tentativa++) {
        protocolo = regras.gerarProtocolo(crypto.randomBytes);
        const r = await cliente.query(
          `INSERT INTO envios_avulsos (protocolo, company_id, tipo, observacao, remetente, ip)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (protocolo) DO NOTHING RETURNING id`,
          [protocolo, empresa.id, campos.tipo, campos.observacao || null, campos.remetente || null, ip]
        );
        envioId = r.rows[0]?.id;
      }
      if (!envioId) throw new Error("não gerou protocolo único");
      for (const g of gravados) {
        await cliente.query(
          `INSERT INTO envios_avulsos_arquivos (envio_id, file_path, file_name, tamanho, sha256) VALUES ($1,$2,$3,$4,$5)`,
          [envioId, g.arquivo, g.nome, g.tamanho, g.sha256]
        );
      }
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
    console.log(`[envio-avulso] ${protocolo}: ${gravados.length} arquivo(s) de ${empresa.cnpj} (ip ${ip})`);

    avisarEscritorio({ empresa, campos, protocolo, qtd: gravados.length, ip });
    return res.status(201).json({ ok: true, protocolo, arquivos: gravados.length });
  } catch (err) {
    for (const g of gravados) fs.unlink(path.join(ARQUIVOS_DIR, g.arquivo), () => {});
    console.error("[envio-avulso] enviar:", err.message);
    res.status(500).json({ error: "Não foi possível receber agora. Tente de novo em instantes." });
  }
});

function avisarEscritorio({ empresa, campos, protocolo, qtd, ip }) {
  const tipo = regras.rotuloTipo(campos.tipo);
  const base = getPublicAppUrl() || "";
  const link = base ? `${base}/admin/envios-recebidos` : "";

  if (whatsappConfigurado() && AVISO_WHATSAPP) {
    const texto =
      `📎 Documento recebido pelo link de envio\nEmpresa: ${empresa.name}\nTipo: ${tipo}\nArquivos: ${qtd}` +
      `\nProtocolo: ${protocolo}` +
      (campos.remetente ? `\nEnviado por: ${campos.remetente}` : "") +
      (link ? `\n\nVer no painel: ${link}` : "");
    enviarTexto({ numero: AVISO_WHATSAPP, texto, delayMs: 1000 }).catch(() => {});
  }

  // Sem anexo de propósito: arquivo de origem desconhecida não circula por e-mail.
  // O escritório baixa pelo painel, logado.
  if (isSmtpConfigured()) {
    createTransport()
      .sendMail({
        from: process.env.SMTP_FROM,
        to: AVISO_EMAIL,
        subject: `Documento recebido (${tipo}) — ${empresa.name} — ${protocolo}`,
        html: `
          <p>Chegou documento pela página pública de envio (sem login).</p>
          <p>Empresa: ${escapeHtml(empresa.name)} (CNPJ ${escapeHtml(empresa.cnpj)})<br>
          Tipo: ${escapeHtml(tipo)}<br>
          Arquivos: ${qtd}<br>
          Protocolo: ${escapeHtml(protocolo)}</p>
          ${campos.remetente ? `<p>Enviado por: ${escapeHtml(campos.remetente)}</p>` : ""}
          ${campos.observacao ? `<p>Observação: ${escapeHtml(campos.observacao)}</p>` : ""}
          <p>IP de origem: ${escapeHtml(ip)}</p>
          ${link ? `<p><a href="${escapeHtml(link)}">Abrir no painel</a></p>` : ""}`,
      })
      .catch((err) => console.error("[envio-avulso] e-mail:", err.message));
  }
}

/* ───────────────────────────── painel ───────────────────────────── */

const adminRouter = express.Router();
adminRouter.use(authMiddleware);
adminRouter.use(requireArea("entregas"));
adminRouter.use(semCache);

adminRouter.get("/", async (req, res) => {
  try {
    const status = ["novo", "tratado"].includes(req.query.status) ? req.query.status : null;
    const busca = String(req.query.busca || "").trim().slice(0, 100);
    const params = [];
    const where = [];
    if (status) {
      params.push(status);
      where.push(`e.status = $${params.length}`);
    }
    if (busca) {
      params.push(`%${busca.toLowerCase()}%`);
      const conds = [`lower(c.name) LIKE $${params.length}`];
      params.push(`%${busca.toUpperCase()}%`);
      conds.push(`e.protocolo LIKE $${params.length}`);
      const num = regras.digitos(busca);
      if (num.length >= 3) {
        params.push(`%${num}%`);
        conds.push(`regexp_replace(c.cnpj, '[^0-9]', '', 'g') LIKE $${params.length}`);
      }
      where.push(`(${conds.join(" OR ")})`);
    }
    const { rows } = await db.query(
      `SELECT e.id, e.protocolo, e.tipo, e.observacao, e.remetente, e.status, e.tratado_por, e.tratado_em,
              e.created_at, c.id AS company_id, c.name AS empresa, c.cnpj,
              COALESCE(json_agg(json_build_object('id', a.id, 'nome', a.file_name, 'tamanho', a.tamanho)
                       ORDER BY a.created_at) FILTER (WHERE a.id IS NOT NULL), '[]') AS arquivos
         FROM envios_avulsos e
         JOIN companies c ON c.id = e.company_id
         LEFT JOIN envios_avulsos_arquivos a ON a.envio_id = e.id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY e.id, c.id
        ORDER BY e.created_at DESC
        LIMIT 300`,
      params
    );
    const { rows: r2 } = await db.query(`SELECT count(*)::int AS novos FROM envios_avulsos WHERE status = 'novo'`);
    res.json({
      envios: rows.map((r) => ({ ...r, tipo_rotulo: regras.rotuloTipo(r.tipo) })),
      novos: r2[0].novos,
      tipos: regras.TIPOS.map(({ chave, rotulo }) => ({ chave, rotulo })),
    });
  } catch (err) {
    console.error("[envio-avulso] lista:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.patch("/:id", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const status = req.body?.status;
    if (!["novo", "tratado"].includes(status)) return res.status(400).json({ error: "Status inválido" });
    const quem = String(req.admin?.nome || req.admin?.cpf || "admin").slice(0, 120);
    const { rowCount } = await db.query(
      `UPDATE envios_avulsos
          SET status = $2,
              tratado_por = CASE WHEN $2 = 'tratado' THEN $3 ELSE NULL END,
              tratado_em = CASE WHEN $2 = 'tratado' THEN now() ELSE NULL END
        WHERE id = $1`,
      [req.params.id, status, quem]
    );
    if (!rowCount) return res.status(404).json({ error: "Envio não encontrado" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[envio-avulso] status:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/arquivos/:id/file", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query(`SELECT file_path, file_name FROM envios_avulsos_arquivos WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Arquivo não encontrado" });
    // file_path é sempre um UUID.ext gerado aqui; mesmo assim, nada de caminho fora da pasta.
    const nomeDisco = path.basename(rows[0].file_path);
    const full = path.join(ARQUIVOS_DIR, nomeDisco);
    if (!full.startsWith(ARQUIVOS_DIR + path.sep) || !fs.existsSync(full)) {
      return res.status(404).json({ error: "Arquivo ausente" });
    }
    const nome = regras.nomeExibicao(rows[0].file_name);
    const ascii = nome.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    // Sempre download, nunca exibido: conteúdo de terceiro não roda no navegador do painel.
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    console.error("[envio-avulso] download:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = { publicRouter, adminRouter, ARQUIVOS_DIR };
