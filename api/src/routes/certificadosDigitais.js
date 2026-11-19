/**
 * Certificado digital das empresas: validade e aviso de vencimento.
 *
 * - adminRouter (/api/admin/certificados): painel, área "licencas" (mesmo setor Fiscal).
 * - portalRouter (/api/certificado-digital): o cliente vê o seu e informa a renovação.
 *
 * Regras do estado em certificadoDigital.js — o painel, o portal e o aviso usam a mesma.
 */
const express = require("express");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID, validateString, validateDate } = require("../middleware/validate");
const numeroWpp = require("../whatsappNumero");
const {
  CERT_STATUSES,
  certWarnDays,
  certStatusSql,
  montarAvisoCertificado,
  lerCamposCertificado,
} = require("../certificadoDigital");
const arq = require("../certificadoArquivo");
const { clientIp } = require("../deliverableAccess");
const { mascararEmail } = require("../emailMascara");

const validadores = { validateDate, validateString };

/** Empresas ativas com o certificado vigente (o de maior validade) e o estado calculado. */
function baseQuery() {
  return `
    WITH base AS (
      SELECT c.id AS company_id, c.name, c.cnpj,
             ${numeroWpp.celularSql("c", "g")} AS whatsapp,
             k.id AS certificado_id, k.tipo, k.titular, k.emissor, k.emitido_em, k.vence_em,
             k.observacao, k.origem, k.avisado_em, k.updated_at,
             (k.arquivo_cifrado IS NOT NULL) AS tem_arquivo, (k.senha_cifrada IS NOT NULL) AS tem_senha
        FROM companies c
        LEFT JOIN gclick_clients g ON g.company_id = c.id
        LEFT JOIN LATERAL (
          SELECT x.* FROM company_certificados x
           WHERE x.company_id = c.id
           ORDER BY x.vence_em DESC
           LIMIT 1
        ) k ON TRUE
       WHERE c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
    )
    SELECT base.*, ${certStatusSql("vence_em")} AS status,
           (vence_em - CURRENT_DATE) AS dias_restantes
      FROM base
  `;
}

// ---------------------------------------------------------------- painel
const adminRouter = express.Router();
adminRouter.use(authMiddleware);
adminRouter.use(requireArea("licencas"));

adminRouter.get("/overview", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT status, COUNT(*)::int AS n FROM (${baseQuery()}) q GROUP BY status`
    );
    const por_status = Object.fromEntries(CERT_STATUSES.map((s) => [s, 0]));
    for (const r of rows) por_status[r.status] = r.n;
    res.json({ dias_aviso: certWarnDays(), por_status });
  } catch (err) {
    console.error("[certificados overview]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.get("/itens", async (req, res) => {
  try {
    const where = [];
    const vals = [];
    const { status, q } = req.query;
    if (status) {
      if (!CERT_STATUSES.includes(status)) return res.status(400).json({ error: "Estado inválido" });
      vals.push(status);
      where.push(`status = $${vals.length}`);
    }
    if (q && String(q).trim()) {
      vals.push(`%${String(q).trim()}%`);
      where.push(`(name ILIKE $${vals.length} OR cnpj ILIKE $${vals.length})`);
    }
    const { rows } = await db.query(
      `SELECT * FROM (${baseQuery()}) q
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY CASE status WHEN 'vencido' THEN 0 WHEN 'a_vencer' THEN 1 WHEN 'ausente' THEN 2 ELSE 3 END,
                 vence_em ASC NULLS LAST, name ASC`,
      vals
    );
    res.json(rows);
  } catch (err) {
    console.error("[certificados itens]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.post("/", async (req, res) => {
  try {
    const companyId = req.body?.company_id;
    if (!validateUUID(companyId)) return res.status(400).json({ error: "Selecione a empresa" });
    const c = lerCamposCertificado(req.body, validadores);
    if (c.erro) return res.status(400).json({ error: c.erro });
    const { rowCount } = await db.query("SELECT 1 FROM companies WHERE id = $1", [companyId]);
    if (!rowCount) return res.status(404).json({ error: "Empresa não encontrada" });
    const { rows } = await db.query(
      `INSERT INTO company_certificados (company_id, tipo, titular, emissor, emitido_em, vence_em, observacao, origem)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'escritorio') RETURNING *`,
      [companyId, c.tipo, c.titular, c.emissor, c.emitido, c.vence, c.observacao]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[certificados criar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * POST /arquivo — guarda o .pfx (cifrado) e a senha (cifrada) no certificado da empresa.
 * Corpo: { company_id, arquivo_base64, senha, vence_em, titular?, emitido_em?, emissor? }.
 * Usa o certificado já cadastrado com a mesma validade; se não houver, cria um.
 * A senha precisa abrir o arquivo — senão nada é gravado.
 */
adminRouter.post("/arquivo", async (req, res) => {
  try {
    if (!arq.cifraDisponivel()) {
      return res.status(503).json({ error: "Defina CERT_ENC_KEY (ou SETTINGS_ENC_KEY) no servidor antes de guardar certificados" });
    }
    const b = req.body || {};
    if (!validateUUID(b.company_id)) return res.status(400).json({ error: "Selecione a empresa" });
    const pfx = Buffer.from(String(b.arquivo_base64 || ""), "base64");
    if (!pfx.length) return res.status(400).json({ error: "Envie o arquivo do certificado" });
    if (pfx.length > arq.MAX_PFX_BYTES) return res.status(400).json({ error: "Arquivo grande demais para um certificado" });
    const senha = typeof b.senha === "string" ? b.senha : "";
    if (senha.length > 200) return res.status(400).json({ error: "Senha inválida" });
    const conf = arq.conferirPfx(pfx, senha);
    if (!conf.ok) {
      return res.status(400).json({
        error: conf.motivo === "senha_incorreta" ? "A senha não abre este certificado" : "Arquivo de certificado inválido",
      });
    }
    const c = lerCamposCertificado({ tipo: "a1", ...b }, validadores);
    if (c.erro) return res.status(400).json({ error: c.erro });
    const emp = await db.query("SELECT 1 FROM companies WHERE id = $1", [b.company_id]);
    if (!emp.rowCount) return res.status(404).json({ error: "Empresa não encontrada" });

    const arquivo = arq.cifrar(pfx);
    const senhaCifrada = senha ? arq.cifrarTexto(senha) : null;
    const atual = await db.query(
      "SELECT id FROM company_certificados WHERE company_id = $1 AND vence_em = $2 ORDER BY created_at LIMIT 1",
      [b.company_id, c.vence]
    );
    let id;
    if (atual.rowCount) {
      id = atual.rows[0].id;
      await db.query(
        `UPDATE company_certificados
            SET arquivo_cifrado = $1, arquivo_tamanho = $2, arquivo_em = now(), senha_cifrada = $3,
                tipo = 'a1', updated_at = now()
          WHERE id = $4`,
        [arquivo, pfx.length, senhaCifrada, id]
      );
    } else {
      const { rows } = await db.query(
        `INSERT INTO company_certificados
           (company_id, tipo, titular, emissor, emitido_em, vence_em, observacao, origem,
            arquivo_cifrado, arquivo_tamanho, arquivo_em, senha_cifrada)
         VALUES ($1, 'a1', $2, $3, $4, $5, $6, 'escritorio', $7, $8, now(), $9) RETURNING id`,
        [b.company_id, c.titular, c.emissor, c.emitido, c.vence, c.observacao, arquivo, pfx.length, senhaCifrada]
      );
      id = rows[0].id;
    }
    res.status(201).json({ ok: true, id, criado: !atual.rowCount, nao_verificado: !!conf.nao_verificado });
  } catch (err) {
    console.error("[certificados arquivo]", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** DELETE /:id/arquivo — tira o arquivo e a senha guardados (a validade fica). */
adminRouter.delete("/:id/arquivo", async (req, res) => {
  try {
    if (!validateUUID(req.params.id)) return res.status(400).json({ error: "ID inválido" });
    const { rowCount } = await db.query(
      `UPDATE company_certificados
          SET arquivo_cifrado = NULL, arquivo_tamanho = NULL, arquivo_em = NULL, senha_cifrada = NULL, updated_at = now()
        WHERE id = $1`,
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Certificado não encontrado" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[certificados arquivo apagar]", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const c = lerCamposCertificado(req.body, validadores);
    if (c.erro) return res.status(400).json({ error: c.erro });
    const { rows, rowCount } = await db.query(
      `UPDATE company_certificados
          SET tipo = $1, titular = $2, emissor = $3, emitido_em = $4, vence_em = $5,
              observacao = $6, updated_at = now()
        WHERE id = $7 RETURNING *`,
      [c.tipo, c.titular, c.emissor, c.emitido, c.vence, c.observacao, id]
    );
    if (!rowCount) return res.status(404).json({ error: "Certificado não encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[certificados editar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

adminRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const { rowCount } = await db.query("DELETE FROM company_certificados WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Certificado não encontrado" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[certificados apagar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * POST /avisar/:companyId — manda o aviso de vencimento pelo WhatsApp da empresa.
 * Só sai quando alguém do escritório clica: nada é enviado sozinho.
 */
adminRouter.post("/avisar/:companyId", requireArea("alertas"), async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!validateUUID(companyId)) return res.status(400).json({ error: "ID inválido" });
    const { rows } = await db.query(`SELECT * FROM (${baseQuery()}) q WHERE company_id = $1`, [companyId]);
    const item = rows[0];
    if (!item) return res.status(404).json({ error: "Empresa não encontrada" });
    const v = numeroWpp.validar(String(item.whatsapp || ""));
    if (!v.ok) return res.status(400).json({ error: `Empresa sem WhatsApp válido: ${v.motivo}` });
    const texto = montarAvisoCertificado({ empresa: item.name, venceEm: item.vence_em });
    const { enviarTexto } = require("../uazapi");
    await enviarTexto({ numero: v.numero, texto, delayMs: 300 });
    if (item.certificado_id) {
      await db.query("UPDATE company_certificados SET avisado_em = now() WHERE id = $1", [item.certificado_id]);
    }
    res.json({ ok: true, numero: v.numero });
  } catch (err) {
    console.error("[certificados avisar]", err.message);
    res.status(502).json({ error: err.message || "Falha ao enviar o aviso" });
  }
});

// ---------------------------------------------------------------- portal
const portalRouter = express.Router();
portalRouter.use(authMiddleware);

function soEmpresa(req, res, next) {
  if (req.isAdmin || !req.company?.id) return res.status(403).json({ error: "Sessão de empresa inválida" });
  // Gerente (login por CPF) só emite advertência e suspensão.
  if (req.companyUser) return res.status(403).json({ error: "Acesso de gerente não inclui o certificado" });
  next();
}

portalRouter.get("/", soEmpresa, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT k.id, k.tipo, k.titular, k.emissor, k.emitido_em, k.vence_em, k.origem, k.updated_at,
              (k.arquivo_cifrado IS NOT NULL) AS tem_arquivo, (k.senha_cifrada IS NOT NULL) AS tem_senha,
              ${certStatusSql("k.vence_em")} AS status, (k.vence_em - CURRENT_DATE) AS dias_restantes
         FROM company_certificados k
        WHERE k.company_id = $1
        ORDER BY k.vence_em DESC
        LIMIT 1`,
      [req.company.id]
    );
    res.json({
      dias_aviso: certWarnDays(),
      certificado: rows[0] || null,
      status: rows[0]?.status || "ausente",
    });
  } catch (err) {
    console.error("[certificado portal]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** O cliente informa o certificado novo depois de renovar. */
portalRouter.post("/", soEmpresa, async (req, res) => {
  try {
    const c = lerCamposCertificado(req.body, validadores);
    if (c.erro) return res.status(400).json({ error: c.erro });
    const { rows } = await db.query(
      `INSERT INTO company_certificados (company_id, tipo, titular, emissor, emitido_em, vence_em, observacao, origem)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'cliente') RETURNING *`,
      [req.company.id, c.tipo, c.titular, c.emissor, c.emitido, c.vence, c.observacao]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[certificado portal criar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ------------------------------------------------ portal: arquivo e senha

function registrarAcesso(req, certificadoId, acao) {
  db.query(
    `INSERT INTO certificado_acessos (company_id, certificado_id, acao, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
    [req.company.id, certificadoId, acao, clientIp(req), String(req.headers["user-agent"] || "").slice(0, 500)]
  ).catch((err) => console.error("[certificado acesso]", err.message));
}

/** O certificado vigente que tem arquivo guardado. */
async function vigenteComArquivo(companyId) {
  const { rows } = await db.query(
    `SELECT k.id, k.vence_em, k.arquivo_cifrado, k.senha_cifrada, c.cnpj
       FROM company_certificados k JOIN companies c ON c.id = k.company_id
      WHERE k.company_id = $1 AND k.arquivo_cifrado IS NOT NULL
      ORDER BY k.vence_em DESC LIMIT 1`,
    [companyId]
  );
  return rows[0] || null;
}

/** E-mail da empresa: o do cadastro do portal; senão, o do G-Click. */
async function emailDaEmpresa(companyId) {
  const { rows } = await db.query(
    `SELECT NULLIF(TRIM(c.contact_email), '') AS a, NULLIF(TRIM(g.email), '') AS b
       FROM companies c LEFT JOIN gclick_clients g ON g.company_id = c.id
      WHERE c.id = $1 LIMIT 1`,
    [companyId]
  );
  const e = rows[0] ? rows[0].a || rows[0].b : null;
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** GET /arquivo — baixa o .pfx (o nome do arquivo não leva a senha). */
portalRouter.get("/arquivo", soEmpresa, async (req, res) => {
  try {
    const k = await vigenteComArquivo(req.company.id);
    if (!k) return res.status(404).json({ error: "O escritório ainda não guardou o arquivo do seu certificado" });
    const pfx = arq.decifrar(k.arquivo_cifrado);
    registrarAcesso(req, k.id, "download");
    const nome = arq.nomeDownload(k.cnpj, k.vence_em instanceof Date ? k.vence_em.toISOString() : k.vence_em);
    res.setHeader("Content-Type", "application/x-pkcs12");
    res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(pfx);
  } catch (err) {
    console.error("[certificado download]", err.message);
    res.status(500).json({ error: "Não foi possível baixar o certificado" });
  }
});

/** POST /senha/codigo — manda um código de 6 dígitos para o e-mail da empresa. */
portalRouter.post("/senha/codigo", soEmpresa, async (req, res) => {
  try {
    const k = await vigenteComArquivo(req.company.id);
    if (!k || !k.senha_cifrada) return res.status(404).json({ error: "O escritório ainda não guardou a senha do seu certificado" });
    const email = await emailDaEmpresa(req.company.id);
    if (!email) {
      return res.status(400).json({ error: "Sua empresa não tem e-mail cadastrado. Fale com o escritório para cadastrar." });
    }
    const recente = await db.query(
      `SELECT 1 FROM certificado_senha_codigos
        WHERE company_id = $1 AND created_at > now() - ($2 || ' seconds')::interval`,
      [req.company.id, String(arq.CODIGO_REENVIO_SEGUNDOS)]
    );
    if (recente.rowCount) {
      return res.status(429).json({ error: "Já enviamos um código há pouco. Confira o e-mail ou espere 1 minuto." });
    }
    const { isSmtpConfigured, createTransport } = require("../mailer");
    if (!isSmtpConfigured()) return res.status(503).json({ error: "Envio de e-mail indisponível no momento" });
    const codigo = arq.gerarCodigo();
    await db.query(
      `UPDATE certificado_senha_codigos SET usado_em = now() WHERE company_id = $1 AND usado_em IS NULL`,
      [req.company.id]
    );
    await db.query(
      `INSERT INTO certificado_senha_codigos (company_id, codigo_hash, email, expira_em)
       VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
      [req.company.id, arq.hashCodigo(req.company.id, codigo), email, String(arq.CODIGO_MINUTOS)]
    );
    await createTransport().sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: `Código para ver a senha do certificado digital: ${codigo}`,
      text: [
        `Seu código é ${codigo}.`,
        `Digite no portal da Nescon para ver a senha do certificado digital. Ele vale por ${arq.CODIGO_MINUTOS} minutos.`,
        "Se não foi você, ignore este e-mail e avise o escritório.",
      ].join("\n\n"),
    });
    registrarAcesso(req, k.id, "codigo_enviado");
    res.json({ ok: true, email: mascararEmail(email), minutos: arq.CODIGO_MINUTOS });
  } catch (err) {
    console.error("[certificado codigo]", err.message);
    res.status(500).json({ error: "Não foi possível enviar o código" });
  }
});

/** POST /senha — confere o código e devolve a senha do certificado. */
portalRouter.post("/senha", soEmpresa, async (req, res) => {
  try {
    const codigo = String(req.body?.codigo || "").replace(/\D/g, "");
    if (codigo.length !== 6) return res.status(400).json({ error: "Digite o código de 6 números" });
    const { rows } = await db.query(
      `SELECT id, codigo_hash, tentativas FROM certificado_senha_codigos
        WHERE company_id = $1 AND usado_em IS NULL AND expira_em > now()
        ORDER BY created_at DESC LIMIT 1`,
      [req.company.id]
    );
    const linha = rows[0];
    if (!linha) return res.status(400).json({ error: "Código vencido. Peça um novo." });
    if (linha.tentativas >= arq.CODIGO_TENTATIVAS) {
      return res.status(400).json({ error: "Muitas tentativas. Peça um novo código." });
    }
    if (arq.hashCodigo(req.company.id, codigo) !== linha.codigo_hash) {
      await db.query("UPDATE certificado_senha_codigos SET tentativas = tentativas + 1 WHERE id = $1", [linha.id]);
      registrarAcesso(req, null, "codigo_errado");
      return res.status(400).json({ error: "Código incorreto" });
    }
    await db.query("UPDATE certificado_senha_codigos SET usado_em = now() WHERE id = $1", [linha.id]);
    const k = await vigenteComArquivo(req.company.id);
    if (!k || !k.senha_cifrada) return res.status(404).json({ error: "Senha não encontrada" });
    registrarAcesso(req, k.id, "senha_vista");
    res.setHeader("Cache-Control", "no-store");
    res.json({ senha: arq.decifrarTexto(k.senha_cifrada) });
  } catch (err) {
    console.error("[certificado senha]", err.message);
    res.status(500).json({ error: "Não foi possível mostrar a senha" });
  }
});

module.exports = { adminRouter, portalRouter };
