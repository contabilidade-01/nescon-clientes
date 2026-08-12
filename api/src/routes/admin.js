const router = require("express").Router();
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea, requireOwner } = require("../middleware/adminArea");
const { validateUUID, validateEmailFormat, validateString, validateCNPJ } = require("../middleware/validate");
const { mergeToolAccess } = require("../companyTools");
const { listCompanies, insertCompanyRow, PG_UNDEFINED_COLUMN } = require("../toolAccessDb");
const { importEmployeesForCompany } = require("../employeeImport");
const { parseExtratoEmployees } = require("../extratoEmployees");
const { resolveUploadPath, uploadPdf, removeUploadFile } = require("../uploads");
const arquivosIntegridade = require("../arquivosIntegridade");
const backupAgendador = require("../backupAgendador");
const { LGPD_CONSENT_VERSION } = require("../lgpd");
const sync = require("../gclick/sync");
const clientSync = require("../gclick/clientSync");
const extratoAuto = require("../extratoAuto");
const { funcionarioRealSql } = require("../payrollRoles");
const { parseVacationPdf } = require("../vacationParser");
const {
  conferirEmpresa,
  salvarProgramacao,
  ultimaProgramacao,
} = require("../vacationImport");
const { getSetting, setBoolSetting, setSetting, getSecretSetting, setSecretSetting } = require("../appSettings");
const gclickClient = require("../gclick/client");
const coraSync = require("../coraSync");
const coraClient = require("../cora");
const { TIPOS: TIPOS_GCLICK } = require("../gclick/guides");
const { gerarSenhaInicial } = require("../senhaInicial");
const { enviarTexto } = require("../uazapi");
const dueDateSugestoes = require("../dueDateSugestoes");
const { varrerVencimentos } = dueDateSugestoes;
const fs = require("fs");

function adminOnly(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: "Acesso restrito a administradores" });
  }
  next();
}

router.use(authMiddleware);
router.use(adminOnly);

router.get("/summary", async (_req, res) => {
  try {
    const [c, d, e, cert, deliv] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS n FROM companies WHERE arquivada IS NOT TRUE AND excluida IS NOT TRUE"),
      db.query("SELECT COUNT(*)::int AS n FROM issued_documents"),
      db.query("SELECT COUNT(*)::int AS n FROM employees"),
      db.query("SELECT COUNT(*)::int AS n FROM medical_certificates"),
      db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE released_at IS NOT NULL)::int AS liberadas,
                COUNT(*) FILTER (WHERE released_at IS NULL)::int AS retidas
           FROM deliverables`
      ),
    ]);
    res.json({
      companies: c.rows[0].n,
      documents: d.rows[0].n,
      employees: e.rows[0].n,
      certificates: cert.rows[0].n,
      deliverables: deliv.rows[0].total,
      deliverables_liberadas: deliv.rows[0].liberadas,
      deliverables_retidas: deliv.rows[0].retidas,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Painel de entregas: quantas entregas (guias, boletos, folha, documentos) cada
 * empresa recebeu, separando liberadas (visíveis ao cliente) de retidas (à espera
 * de o escritório clicar "Enviar" no sistema de guias). Resolve a confusão do
 * cartão "Documentos emitidos", que conta issued_documents (fluxo antigo de DP),
 * não a tabela deliverables (guias/folha vindas do G-Click).
 */
router.get("/deliverables-overview", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.cnpj,
              COUNT(d.id)::int AS total,
              COUNT(d.id) FILTER (WHERE d.released_at IS NOT NULL)::int AS liberadas,
              COUNT(d.id) FILTER (WHERE d.released_at IS NULL)::int AS retidas,
              to_char(MAX(d.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ultima_entrada
         FROM companies c
         JOIN deliverables d ON d.company_id = c.id
        WHERE c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
        GROUP BY c.id, c.name, c.cnpj
        ORDER BY total DESC, c.name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Auditoria LGPD: quem já concordou com o tratamento de dados, quando e em que versão
 * do termo. 'visto' = o aviso foi exibido e fechado sem aceite (não bloqueamos o portal).
 */
router.get("/lgpd-consents", requireArea("lgpd"), async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, cnpj, lgpd_consent_at, lgpd_consent_version, lgpd_consent_ip,
              lgpd_prompt_seen_at,
              CASE
                WHEN lgpd_consent_at IS NOT NULL THEN 'aceito'
                WHEN lgpd_prompt_seen_at IS NOT NULL THEN 'visto'
                ELSE 'pendente'
              END AS situacao
         FROM companies
        WHERE arquivada IS NOT TRUE AND excluida IS NOT TRUE
        ORDER BY (lgpd_consent_at IS NOT NULL), name`
    );
    const resumo = { aceito: 0, visto: 0, pendente: 0 };
    for (const r of rows) resumo[r.situacao] += 1;
    res.json({ versao_atual: LGPD_CONSENT_VERSION, resumo, total: rows.length, empresas: rows });
  } catch (err) {
    console.error("[lgpd-consents]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/companies", async (_req, res) => {
  try {
    const rows = await listCompanies(db);
    res.json(rows.map((r) => ({ ...r, tool_access: mergeToolAccess(r.tool_access) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

function normalizePhone(val) {
  if (val === null || val === undefined || val === "") return null;
  const d = String(val).replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return null;
  return d;
}

/** Cria a empresa com senha inicial ALEATÓRIA, devolvida uma única vez. */
router.post("/companies", requireArea("empresas"), async (req, res) => {
  try {
    const { name, cnpj, contact_email, phone } = req.body;
    if (!validateString(name, 2, 200)) {
      return res.status(400).json({ error: "Razão social inválida (2–200 caracteres)" });
    }
    const rawCnpj = (cnpj || "").toString();
    const cnpjDigits = rawCnpj.replace(/\D/g, "");
    if (!validateCNPJ(rawCnpj) || cnpjDigits.length !== 14) {
      return res.status(400).json({ error: "CNPJ inválido (14 dígitos)" });
    }
    let emailNorm = null;
    if (contact_email !== undefined && contact_email !== null && String(contact_email).trim()) {
      emailNorm = normalizeEmailField(contact_email);
      if (!validateEmailFormat(emailNorm)) {
        return res.status(400).json({ error: "E-mail inválido" });
      }
    }
    let phoneNorm = null;
    if (phone !== undefined && phone !== null && String(phone).trim()) {
      phoneNorm = normalizePhone(phone);
      if (!phoneNorm) {
        return res.status(400).json({ error: "Telefone inválido (mínimo 8 dígitos)" });
      }
    }
    // Senha inicial ALEATÓRIA, não o CNPJ. Mostrada uma única vez a quem cadastrou —
    // não fica guardada em claro em lugar nenhum, então não há como recuperá-la depois:
    // se perder, gera outra.
    const senhaInicial = gerarSenhaInicial();
    const passwordHash = await bcrypt.hash(senhaInicial, 10);
    const created = await insertCompanyRow(db, {
      name: name.trim(),
      cnpjDigits,
      passwordHash,
      emailNorm,
      phoneNorm,
    });
    res.status(201).json({
      company: { ...created, tool_access: mergeToolAccess(created.tool_access) },
      senha_inicial: senhaInicial,
      message:
        "Empresa criada. Login: CNPJ com ou sem máscara. Anote a senha inicial agora — " +
        "ela não é exibida de novo.",
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "CNPJ já cadastrado" });
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

function normalizeEmailField(val) {
  if (val === null || val === undefined || val === "") return null;
  return String(val).trim().toLowerCase();
}

/**
 * Perfil do administrador logado. Devolve também as permissões, para o painel esconder
 * o que a pessoa não pode ver sem depender do que ficou guardado no login.
 */
router.get("/me", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, cpf, nome, contact_email FROM platform_admins WHERE id = $1",
      [req.admin.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Não encontrado" });
    res.json({ ...rows[0], is_owner: Boolean(req.admin.isOwner), areas: req.admin.areas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/me/contact-email", async (req, res) => {
  try {
    if (!Object.prototype.hasOwnProperty.call(req.body, "contact_email")) {
      return res.status(400).json({ error: "contact_email é obrigatório no corpo (use null ou \"\" para limpar)" });
    }
    const norm = normalizeEmailField(req.body.contact_email);
    if (norm && !validateEmailFormat(norm)) {
      return res.status(400).json({ error: "E-mail inválido" });
    }
    await db.query("UPDATE platform_admins SET contact_email = $1 WHERE id = $2", [
      norm,
      req.admin.id,
    ]);
    res.json({ ok: true, contact_email: norm });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/companies/:id", requireArea("empresas"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });

    const sets = [];
    const vals = [];
    let i = 1;
    let newRazaoSocial = null;

    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      const n = req.body.name;
      if (n === null || n === "") {
        return res.status(400).json({ error: "Razão social não pode ser vazia" });
      }
      if (!validateString(n, 2, 200)) {
        return res.status(400).json({ error: "Razão social inválida (2–200 caracteres)" });
      }
      newRazaoSocial = String(n).trim();
      sets.push(`name = $${i++}`);
      vals.push(newRazaoSocial);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "contact_email")) {
      const norm = normalizeEmailField(req.body.contact_email);
      if (norm && !validateEmailFormat(norm)) {
        return res.status(400).json({ error: "E-mail inválido" });
      }
      sets.push(`contact_email = $${i++}`);
      vals.push(norm);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "phone")) {
      const p = req.body.phone === null || req.body.phone === "" ? null : normalizePhone(req.body.phone);
      if (p === null && (req.body.phone === null || req.body.phone === "")) {
        sets.push(`phone = $${i++}`);
        vals.push(null);
      } else if (!p) {
        return res.status(400).json({ error: "Telefone inválido" });
      } else {
        sets.push(`phone = $${i++}`);
        vals.push(p);
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "tool_access")) {
      const ta = req.body.tool_access;
      if (ta === null || typeof ta !== "object" || Array.isArray(ta)) {
        return res.status(400).json({ error: "tool_access deve ser um objeto com as chaves das ferramentas" });
      }
      sets.push(`tool_access = $${i++}::jsonb`);
      vals.push(JSON.stringify(mergeToolAccess(ta)));
    }

    if (!sets.length) {
      return res.status(400).json({
        error: "Envie ao menos um campo: name, contact_email, phone ou tool_access",
      });
    }

    vals.push(id);
    const hasToolAccessSet = sets.some((s) => s.startsWith("tool_access"));
    const sqlBase = `UPDATE companies SET ${sets.join(", ")} WHERE id = $${i}`;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      let rows;
      let rowCount;
      try {
        const r = await client.query(
          `${sqlBase} RETURNING id, name, cnpj, contact_email, phone, tool_access, created_at`,
          vals
        );
        rows = r.rows;
        rowCount = r.rowCount;
      } catch (e) {
        if (e.code === PG_UNDEFINED_COLUMN && hasToolAccessSet) {
          await client.query("ROLLBACK");
          return res.status(503).json({
            error:
              "A base ainda não tem a coluna tool_access. Reinicie o contentor da API (migração no arranque) ou execute db/migration-add-tool-access.sql no Postgres.",
          });
        }
        if (e.code === PG_UNDEFINED_COLUMN) {
          await client.query("ROLLBACK");
          await client.query("BEGIN");
          const r = await client.query(
            `${sqlBase} RETURNING id, name, cnpj, contact_email, phone, created_at`,
            vals
          );
          rows = r.rows.map((row) => ({ ...row, tool_access: null }));
          rowCount = r.rowCount;
        } else {
          throw e;
        }
      }
      if (!rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Empresa não encontrada" });
      }
      if (newRazaoSocial) {
        await client.query(`UPDATE issued_documents SET company_name = $1 WHERE company_id = $2`, [
          newRazaoSocial,
          id,
        ]);
      }
      await client.query("COMMIT");
      const row = rows[0];
      res.json({ ...row, tool_access: mergeToolAccess(row.tool_access) });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Estado da sincronização com o G-Click (para o painel mostrar). */
router.get("/sync-gclick/status", requireArea("sincronizacao"), (_req, res) => {
  res.json({
    configurado: gclickClient.isConfigured(),
    rodando: sync.estaRodando(),
    ultima: sync.ultimaExecucao(),
  });
});

/** Dispara a sincronização com o G-Click em segundo plano (pode levar minutos). */
router.post("/sync-gclick", requireArea("sincronizacao"), async (req, res) => {
  if (!gclickClient.isConfigured()) {
    return res.status(503).json({ error: "G-Click não configurado (GCLICK_CLIENT_ID/SECRET)." });
  }
  if (sync.estaRodando()) {
    return res.status(409).json({ error: "Já existe uma sincronização em andamento." });
  }
  const meses = Number(req.body?.meses) || undefined;
  // Não segura a resposta: a carga pode demorar; o painel acompanha pelo /status.
  sync.sincronizar({ meses }).catch((e) => console.error("[admin sync]", e.message));
  res.status(202).json({ message: "Sincronização iniciada." });
});

// ---------------------------------------------------------------------------
// Cora — boletos mensais
// ---------------------------------------------------------------------------

router.get("/sync-cora/status", requireArea("sincronizacao"), (_req, res) => {
  res.json({
    configurado: coraClient.isConfigured(),
    rodando: coraSync.estaRodando(),
    ultima: coraSync.ultimaExecucao(),
    diagnostico: coraClient.diagnostico(),
  });
});

/** Dispara a sincronização de boletos da Cora em segundo plano. */
router.post("/sync-cora", requireArea("sincronizacao"), async (req, res) => {
  if (!coraClient.isConfigured()) {
    return res.status(503).json({ error: "Cora não configurado (certificados não encontrados)." });
  }
  if (coraSync.estaRodando()) {
    return res.status(409).json({ error: "Já existe uma sincronização em andamento." });
  }
  const de = req.body?.de || undefined; // "YYYY-MM"
  const ate = req.body?.ate || undefined; // "YYYY-MM"
  coraSync.sincronizar({ de, ate }).catch((e) => console.error("[admin sync cora]", e.message));
  res.status(202).json({ message: "Sincronização de boletos iniciada." });
});

/** Sync individual de uma empresa (busca por CNPJ). */
router.post("/cora/sync-empresa", requireArea("sincronizacao"), async (req, res) => {
  if (!coraClient.isConfigured()) {
    return res.status(503).json({ error: "Cora não configurado." });
  }
  const cnpj = String(req.body?.cnpj || "").replace(/\D/g, "");
  if (!cnpj || cnpj.length < 11) {
    return res.status(400).json({ error: "CNPJ inválido." });
  }
  if (coraSync.estaRodando()) {
    return res.status(409).json({ error: "Já existe uma sincronização em andamento." });
  }
  coraSync.sincronizar({ cnpjFiltro: cnpj }).catch((e) => console.error("[admin cora empresa]", e.message));
  res.status(202).json({ message: `Sincronização iniciada para ${cnpj}.` });
});

/** Lista empresas com info de boletos Cora. */
router.get("/cora/empresas", requireArea("sincronizacao"), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT c.id, c.name, c.cnpj,
             COALESCE(c.tool_access->>'boletos', 'true') AS boletos_ativo,
             COUNT(d.id) FILTER (WHERE d.source = 'cora') AS total_boletos,
             MAX(d.created_at) FILTER (WHERE d.source = 'cora') AS ultimo_importado
      FROM companies c
      LEFT JOIN deliverables d ON d.company_id = c.id AND d.source = 'cora'
      WHERE c.cnpj IS NOT NULL AND c.cnpj != '' AND c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
      GROUP BY c.id
      ORDER BY c.name
    `);
    res.json(rows.map((r) => ({
      ...r,
      boletos_ativo: r.boletos_ativo !== "false",
      total_boletos: Number(r.total_boletos) || 0,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Toggle importação de boletos para uma empresa. */
router.patch("/cora/empresas/:id", requireArea("sincronizacao"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const ativo = req.body?.boletos_ativo !== false;
    await db.query(`
      UPDATE companies
      SET tool_access = COALESCE(tool_access, '{}'::jsonb) || jsonb_build_object('boletos', $1::boolean)
      WHERE id = $2
    `, [ativo, id]);
    res.json({ ok: true, boletos_ativo: ativo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Lista boletos Cora importados (com nome da empresa). */
router.get("/cora/boletos", requireArea("sincronizacao"), async (req, res) => {
  try {
    const { company_id, status, competencia } = req.query;
    const params = [];
    let sql = `
      SELECT d.id, d.company_id, c.name AS empresa_nome, c.cnpj AS empresa_cnpj,
             d.title, d.competencia, to_char(d.due_date, 'YYYY-MM-DD') AS due_date,
             d.status, d.doc_type, d.external_ref, d.pdf_url, d.valor_centavos,
             d.created_at
      FROM deliverables d
      JOIN companies c ON c.id = d.company_id
      -- Cancelado na Cora nao e conta a pagar nem pagamento: some da tela dos dois
      -- lados. Continua no banco para explicar depois por que deixou de aparecer.
      WHERE d.source = 'cora' AND d.cancelado IS NOT TRUE
    `;
    if (company_id) {
      if (!validateUUID(company_id)) return res.status(400).json({ error: "company_id inválido" });
      params.push(company_id);
      sql += ` AND d.company_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND d.status = $${params.length}`;
    }
    if (competencia) {
      params.push(competencia);
      sql += ` AND d.competencia = $${params.length}`;
    }
    sql += ` ORDER BY d.due_date DESC NULLS LAST, d.created_at DESC LIMIT 500`;
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Os tipos de documento que o G-Click entrega — para a tela montar a escolha. */
router.get("/sync-gclick/tipos", requireArea("sincronizacao"), (_req, res) => {
  res.json(
    TIPOS_GCLICK.map((t) => ({
      codigo: t.codigo,
      nome: t.nome,
      // Folha não tem vencimento: é documento de consulta, e é o que alimenta os KPIs.
      categoria: t.temVencimento ? "guia" : "folha",
    }))
  );
});

/**
 * Gera uma senha de acesso nova para a empresa e devolve UMA VEZ.
 *
 * Serve para dois casos: o cliente perdeu a senha inicial, e a migração das empresas
 * antigas — as que foram criadas quando a senha era o CNPJ e nunca trocaram.
 *
 * A senha não é guardada em claro, então não existe rota que a "mostre" depois. Isso é
 * de propósito: uma tela que exibe senha de cliente é uma tela que vaza senha de cliente.
 */
router.post("/companies/:id/senha-inicial", requireArea("empresas"), async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const senha = gerarSenhaInicial();
    const { rows } = await db.query(
      `UPDATE companies
          SET password_hash = $1, must_change_password = true
        WHERE id = $2
        RETURNING id, name, cnpj`,
      [await bcrypt.hash(senha, 10), id]
    );
    if (!rows.length) return res.status(404).json({ error: "Empresa não encontrada" });
    res.json({
      ...rows[0],
      senha_inicial: senha,
      message: "Anote agora — esta senha não é exibida de novo. O cliente terá de trocá-la no 1º acesso.",
    });
  } catch (err) {
    console.error("[admin] senha inicial:", err.message);
    res.status(500).json({ error: "Erro ao gerar a senha" });
  }
});

/**
 * Quantas empresas ainda estão com a senha inicial por trocar.
 *
 * `must_change_password` marca exatamente isso. Nas empresas antigas essa senha é o
 * CNPJ — público — então este número é a fila de risco a zerar.
 */
router.get("/companies/senha-pendente", requireArea("empresas"), async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, cnpj, created_at
         FROM companies
        WHERE must_change_password IS TRUE AND arquivada IS NOT TRUE AND excluida IS NOT TRUE
        ORDER BY name`
    );
    res.json({ total: rows.length, empresas: rows });
  } catch (err) {
    console.error("[admin] senha pendente:", err.message);
    res.status(500).json({ error: "Erro ao listar" });
  }
});

/** Backup diário: o que está configurado hoje. */
router.get("/backup/config", requireArea("sincronizacao"), async (_req, res) => {
  try {
    res.json(await backupAgendador.lerConfig(db));
  } catch (err) {
    console.error("[admin] backup config:", err.message);
    res.status(500).json({ error: "Erro ao ler a configuração do backup" });
  }
});

router.put("/backup/config", requireArea("sincronizacao"), async (req, res) => {
  const { ativo, hora, email, whatsapp } = req.body || {};
  if (ativo !== undefined && typeof ativo !== "boolean") {
    return res.status(400).json({ error: "ativo deve ser booleano" });
  }
  if (email !== undefined && email && !validateEmailFormat(String(email).trim().toLowerCase())) {
    return res.status(400).json({ error: "E-mail inválido" });
  }
  try {
    const r = await backupAgendador.salvarConfig(db, { ativo, hora, email, whatsapp });
    if (r.erro) return res.status(400).json({ error: r.erro });
    res.json(r);
  } catch (err) {
    console.error("[admin] backup config:", err.message);
    res.status(500).json({ error: "Erro ao salvar" });
  }
});

/**
 * Roda o backup AGORA e entrega. É também o teste: se der certo aqui, a rotina diária
 * fará o mesmo — e o relatório diz exatamente o que foi entregue e o que não foi.
 */
router.post("/backup/executar", requireArea("sincronizacao"), async (_req, res) => {
  try {
    res.json(await backupAgendador.rodarEEntregar(db));
  } catch (err) {
    console.error("[admin] backup:", err.message);
    res.status(500).json({ error: `Erro ao gerar o backup: ${err.message}` });
  }
});

/**
 * Integridade dos arquivos: quantas entregas apontam para PDF que não está no disco.
 * O volume de uploads não tem backup — mas quase tudo dele é recuperável do G-Click.
 */
router.get("/arquivos/integridade", requireArea("sincronizacao"), async (_req, res) => {
  try {
    res.json(await arquivosIntegridade.conferir(db));
  } catch (err) {
    console.error("[admin] integridade:", err.message);
    res.status(500).json({ error: "Erro ao conferir os arquivos" });
  }
});

/**
 * Marca as entregas órfãs do G-Click para rebaixar. Não baixa aqui: apaga a marca de
 * versão, e a sincronização seguinte refaz o download pelo caminho de sempre.
 */
router.post("/arquivos/rebaixar", requireArea("sincronizacao"), async (_req, res) => {
  try {
    const r = await arquivosIntegridade.marcarParaRebaixar(db);
    res.json({
      ...r,
      message: r.marcadas
        ? `${r.marcadas} documento(s) marcado(s). Rode a sincronização para baixá-los de novo.`
        : "Nenhum arquivo órfão do G-Click.",
    });
  } catch (err) {
    console.error("[admin] rebaixar:", err.message);
    res.status(500).json({ error: "Erro ao marcar os arquivos" });
  }
});

/**
 * Carga HISTÓRICA: traz as competências passadas para o cliente ter o arquivo.
 *
 * Diferente da sincronização normal em duas coisas, e as duas importam:
 *  - os documentos entram **já liberados** (o objetivo é o cliente ver);
 *  - entram marcados como `historico`, então **não viram cobrança**. Sem isso, puxar
 *    de janeiro encheria "próximos pagamentos" de guias vencidas que ninguém deve
 *    pagar — `/deliverables/upcoming` inclui atrasados de propósito.
 *
 * O mês corrente fica de fora: guia deste mês pode estar realmente a vencer, e marcá-la
 * como histórico esconderia uma cobrança de verdade.
 */
router.post("/sync-gclick/historico", requireArea("sincronizacao"), async (req, res) => {
  if (!gclickClient.isConfigured()) {
    return res.status(503).json({ error: "G-Click não configurado (GCLICK_CLIENT_ID/SECRET)." });
  }
  if (sync.estaRodando()) {
    return res.status(409).json({ error: "Já existe uma sincronização em andamento." });
  }

  // Tipos de documento a trazer. Vazio = tudo. O caso que motivou isto: puxar só o
  // Extrato da Folha do ano inteiro, que é o que alimenta os indicadores, sem arrastar
  // dez vezes o volume em guias que ninguém vai reler.
  const tipos = Array.isArray(req.body?.tipos) ? req.body.tipos.map(String) : null;
  if (tipos) {
    const validos = new Set(TIPOS_GCLICK.map((t) => t.codigo));
    const desconhecido = tipos.find((t) => !validos.has(t));
    if (desconhecido) return res.status(400).json({ error: `Tipo desconhecido: ${desconhecido}` });
    if (!tipos.length) return res.status(400).json({ error: "Escolha ao menos um tipo." });
  }

  const desde = String(req.body?.desde || "");
  if (!/^\d{4}-\d{2}$/.test(desde)) {
    return res.status(400).json({ error: "Informe `desde` no formato AAAA-MM (ex.: 2026-01)." });
  }

  const hoje = new Date();
  const anoAtual = hoje.getUTCFullYear();
  const mesAtual = hoje.getUTCMonth() + 1;
  const [ano0, mes0] = desde.split("-").map(Number);
  if (ano0 > anoAtual || (ano0 === anoAtual && mes0 >= mesAtual)) {
    return res.status(400).json({ error: "A carga histórica só cobre competências já encerradas." });
  }

  // Lista as competências de `desde` até o mês ANTERIOR ao corrente.
  const competencias = [];
  let a = ano0;
  let m = mes0;
  while (a < anoAtual || (a === anoAtual && m < mesAtual)) {
    competencias.push(`${a}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
    if (competencias.length > 36) break; // guarda contra pedido absurdo
  }
  if (!competencias.length) {
    return res.status(400).json({ error: "Nenhuma competência encerrada nesse intervalo." });
  }

  sync
    .sincronizar({ competencias, historico: true, tipos })
    .catch((e) => console.error("[admin sync histórico]", e.message));
  res.status(202).json({ message: "Carga histórica iniciada.", competencias, tipos });
});

/**
 * Atualiza só o espelho de clientes do G-Click (sem baixar documentos): traz clientes
 * novos e mudanças de status para a fila de alertas. Rápido — não varre competências.
 */
router.post("/sync-gclick/clientes", requireArea("sincronizacao"), async (_req, res) => {
  if (!gclickClient.isConfigured()) {
    return res.status(503).json({ error: "G-Click não configurado (GCLICK_CLIENT_ID/SECRET)." });
  }
  const r = await clientSync.sincronizarClientes();
  if (!r.ok) return res.status(502).json({ error: r.erro });
  res.json(r);
});

/** Opções da sincronização que o escritório muda pela tela (sem redeploy). */
router.get("/configuracoes/sync", requireArea("sincronizacao"), async (_req, res) => {
  try {
    res.json({
      alerta_so_ativos: await clientSync.alertaSoAtivosAtual(),
    });
  } catch (err) {
    console.error("[config sync]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.put("/configuracoes/sync", requireArea("sincronizacao"), async (req, res) => {
  try {
    if (typeof req.body?.alerta_so_ativos !== "boolean") {
      return res.status(400).json({ error: "Envie alerta_so_ativos: true ou false" });
    }
    await setSetting(db, clientSync.CHAVE_SO_ATIVOS, req.body.alerta_so_ativos);
    res.json({ ok: true, alerta_so_ativos: req.body.alerta_so_ativos });
  } catch (err) {
    console.error("[config sync gravar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});


/**
 * Cobertura operacional: onde o escritório está em dia e onde falta.
 *
 * Nasceu de uma pergunta que antes só se respondia abrindo empresa por empresa:
 * "quais clientes ainda não têm licença cadastrada / programação de férias / extrato
 * lido?". Cada número aqui é uma fila de trabalho, não um enfeite.
 */
router.get("/cobertura", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `WITH base AS (
         SELECT c.id, c.name, c.cnpj, c.established, c.extrato_processado_competencia,
                EXISTS (SELECT 1 FROM company_licenses l WHERE l.company_id = c.id) AS tem_licenca,
                EXISTS (SELECT 1 FROM vacation_uploads v WHERE v.company_id = c.id) AS tem_ferias,
                EXISTS (SELECT 1 FROM employees e
                         WHERE e.company_id = c.id AND ${funcionarioRealSql("e")}) AS tem_funcionarios,
                EXISTS (SELECT 1 FROM deliverables d
                         WHERE d.company_id = c.id AND d.doc_type = 'EXTRATO_FOLHA') AS tem_extrato
           FROM companies c
          WHERE c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
       )
       SELECT * FROM base ORDER BY name`
    );

    const comFuncionarios = rows.filter((r) => r.tem_funcionarios);
    const estabelecidas = rows.filter((r) => r.established);

    const lista = (arr) => arr.slice(0, 50).map((r) => ({ id: r.id, name: r.name, cnpj: r.cnpj }));

    const semLicenca = estabelecidas.filter((r) => !r.tem_licenca);
    // Só cobra Programação de quem tem funcionário celetista: empresa de pró-labore
    // não tem férias a programar.
    const semFerias = comFuncionarios.filter((r) => !r.tem_ferias);
    const semExtratoLido = rows.filter((r) => r.tem_extrato && !r.extrato_processado_competencia);

    res.json({
      empresas: rows.length,
      com_funcionarios: comFuncionarios.length,
      estabelecidas: estabelecidas.length,
      sem_licenca: { total: semLicenca.length, empresas: lista(semLicenca) },
      sem_programacao_ferias: { total: semFerias.length, empresas: lista(semFerias) },
      sem_extrato_lido: { total: semExtratoLido.length, empresas: lista(semExtratoLido) },
    });
  } catch (err) {
    console.error("[cobertura]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Upload em lote de Programação de Férias.
 * O admin arrasta vários PDFs → o sistema lê o CNPJ de cada → aloca automaticamente.
 */
router.post(
  "/ferias/lote",
  requireArea("funcionarios"),
  uploadPdf.array("files", 20),
  async (req, res) => {
    const arquivos = req.files || [];
    if (!arquivos.length) return res.status(400).json({ error: "Nenhum arquivo enviado" });

    const gravados = [];
    const erros = [];

    for (const file of arquivos) {
      const caminho = resolveUploadPath(file.filename);
      try {
        if (!caminho || !fs.existsSync(caminho)) {
          erros.push({ arquivo: file.originalname, motivo: "Arquivo não encontrado no disco" });
          continue;
        }

        const parsed = await parseVacationPdf(fs.readFileSync(caminho));

        if (!parsed.funcionarios.length) {
          erros.push({ arquivo: file.originalname, motivo: "Nenhum funcionário encontrado no PDF" });
          continue;
        }

        const cnpjPdf = String(parsed.cnpj || "").replace(/\D/g, "");
        if (!cnpjPdf || cnpjPdf.length !== 14) {
          erros.push({ arquivo: file.originalname, motivo: "CNPJ não encontrado no cabeçalho do PDF" });
          continue;
        }

        const { rows: empresas } = await db.query(
          `SELECT id, name, cnpj FROM companies WHERE regexp_replace(cnpj, '\\D', '', 'g') = $1`,
          [cnpjPdf]
        );

        if (!empresas.length) {
          erros.push({ arquivo: file.originalname, motivo: `CNPJ ${cnpjPdf} não cadastrado` });
          continue;
        }

        const empresa = empresas[0];
        const r = await salvarProgramacao(db, {
          companyId: empresa.id,
          parsed,
          arquivoNome: file.originalname || file.filename,
          source: "lote",
          adminId: req.admin.id,
        });

        gravados.push({
          arquivo: file.originalname,
          empresa: empresa.name,
          company_id: empresa.id,
          funcionarios: r.funcionarios,
          periodos: r.periodos,
        });
      } catch (err) {
        console.error(`[ferias lote] ${file.originalname}:`, err.message);
        erros.push({ arquivo: file.originalname, motivo: "Erro ao processar: " + err.message });
      } finally {
        removeUploadFile(file.filename);
      }
    }

    res.json({ gravados, erros });
  }
);

/**
 * Programação de Férias: upload do PDF e leitura da última importação.
 *
 * O CNPJ do PDF é conferido contra o da empresa antes de gravar — mandar o arquivo
 * para a empresa errada mostraria os funcionários de um cliente para outro.
 */
router.post(
  "/ferias/:companyId",
  requireArea("funcionarios"),
  uploadPdf.single("file"),
  async (req, res) => {
    const arquivo = req.file;
    try {
      const { companyId } = req.params;
      if (!validateUUID(companyId)) return res.status(400).json({ error: "ID inválido" });
      if (!arquivo) return res.status(400).json({ error: "Envie o PDF da Programação de Férias" });

      const { rows: co } = await db.query("SELECT id, name, cnpj FROM companies WHERE id = $1", [
        companyId,
      ]);
      if (!co.length) return res.status(404).json({ error: "Empresa não encontrada" });

      const caminho = resolveUploadPath(arquivo.filename);
      const parsed = await parseVacationPdf(fs.readFileSync(caminho));
      if (!parsed.funcionarios.length) {
        return res.status(422).json({
          error: "Não consegui ler nenhum funcionário neste PDF. Confira se é a Programação de Férias do G-Click.",
        });
      }

      const conf = conferirEmpresa(parsed.cnpj, co[0].cnpj);
      if (!conf.ok) return res.status(409).json({ error: conf.erro });

      const r = await salvarProgramacao(db, {
        companyId,
        parsed,
        arquivoNome: arquivo.originalname || arquivo.filename,
        source: "manual",
        adminId: req.admin.id,
      });

      res.status(201).json({
        ...r,
        empresa: parsed.empresa,
        data_base: parsed.dataBase,
        emissao: parsed.emissao,
        total_declarado: parsed.totalDeclarado,
        // Divergência entre o que o rodapé declara e o que conseguimos ler é o sinal
        // de leitura parcial — a tela mostra em vez de esconder.
        confere: parsed.totalDeclarado === null || parsed.totalDeclarado === parsed.funcionarios.length,
      });
    } catch (err) {
      console.error("[ferias upload]", err);
      res.status(500).json({ error: "Erro ao importar a Programação de Férias" });
    } finally {
      // O PDF já virou linhas na base; não guardamos o arquivo.
      if (arquivo) removeUploadFile(arquivo.filename);
    }
  }
);

router.get("/ferias/:companyId", requireArea("funcionarios"), async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!validateUUID(companyId)) return res.status(400).json({ error: "ID inválido" });
    const r = await ultimaProgramacao(db, companyId);
    if (!r) return res.json({ upload: null, periodos: [] });
    res.json(r);
  } catch (err) {
    console.error("[ferias listar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Avisos de saída da folha: quem está cadastrado mas não veio no último extrato.
 *
 * A leitura automática do extrato NÃO inativa ninguém — ela abre estes avisos. Um PDF
 * lido pela metade inativaria gente em silêncio; aqui alguém confirma.
 */
router.get("/saidas-folha", requireArea("funcionarios"), async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.nome, a.cpf, a.competencia, a.criado_em,
              c.id AS company_id, c.name AS company_name, c.cnpj
         FROM employee_exit_alerts a
         JOIN companies c ON c.id = a.company_id
        WHERE a.situacao = 'pendente'
        ORDER BY c.name, a.nome`
    );
    res.json({ total: rows.length, saidas: rows });
  } catch (err) {
    console.error("[saidas-folha]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Confirma a saída: inativa o funcionário (some para a empresa, fica para o admin). */
router.post("/saidas-folha/:id/inativar", requireArea("funcionarios"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT employee_id FROM employee_exit_alerts WHERE id = $1 AND situacao = 'pendente'",
        [id]
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Aviso não encontrado ou já resolvido" });
      }
      await client.query("UPDATE employees SET active = false WHERE id = $1", [rows[0].employee_id]);
      await client.query(
        `UPDATE employee_exit_alerts
            SET situacao = 'resolvido', resolucao = 'inativado', resolvido_em = now(), resolvido_por = $2
          WHERE id = $1`,
        [id, req.admin.id]
      );
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[saidas-folha inativar]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Falso alarme (afastamento, extrato parcial): mantém ativo e fecha o aviso. */
router.post("/saidas-folha/:id/manter", requireArea("funcionarios"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
    const { rowCount } = await db.query(
      `UPDATE employee_exit_alerts
          SET situacao = 'resolvido', resolucao = 'mantido', resolvido_em = now(), resolvido_por = $2
        WHERE id = $1 AND situacao = 'pendente'`,
      [id, req.admin.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Aviso não encontrado ou já resolvido" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[saidas-folha manter]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Lê agora os extratos que mudaram, sem esperar a próxima sincronização. */
router.post("/extratos/processar", requireArea("funcionarios"), async (_req, res) => {
  const r = await extratoAuto.processarExtratos(db);
  if (!r.ok) return res.status(409).json({ error: r.erro });
  res.json(r);
});

/** Localiza o extrato de folha mais recente já hospedado no portal para a empresa. */
async function ultimoExtrato(companyId) {
  const { rows } = await db.query(
    `SELECT id, competencia, file_path, file_name
     FROM deliverables
     WHERE company_id = $1 AND doc_type = 'EXTRATO_FOLHA'
     ORDER BY competencia DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [companyId]
  );
  return rows[0] || null;
}

async function funcionariosDoExtrato(companyId) {
  const extrato = await ultimoExtrato(companyId);
  if (!extrato) return { extrato: null, funcionarios: [], invalidos: 0 };
  const full = resolveUploadPath(extrato.file_path);
  if (!full || !fs.existsSync(full)) return { extrato, funcionarios: [], invalidos: 0, semArquivo: true };
  const { funcionarios, invalidos, competencia } = await parseExtratoEmployees(fs.readFileSync(full));
  // A competência do próprio PDF manda; a da entrega é o segundo palpite.
  return { extrato, funcionarios, invalidos, competencia: competencia || extrato.competencia || null };
}

/**
 * Prévia: lê o último extrato de folha da empresa e devolve nome+CPF encontrados,
 * marcando quais já estão cadastrados (para o admin conferir antes de importar).
 */
router.get("/companies/:id/extrato-employees", requireArea("funcionarios"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });

    const { rows: co } = await db.query("SELECT id, name FROM companies WHERE id = $1", [id]);
    if (!co.length) return res.status(404).json({ error: "Empresa não encontrada" });

    const { extrato, funcionarios, invalidos, semArquivo } = await funcionariosDoExtrato(id);
    if (!extrato) {
      return res.status(404).json({ error: "Nenhum extrato de folha encontrado no portal para esta empresa." });
    }
    if (semArquivo) {
      return res.status(404).json({ error: "O arquivo do extrato não está disponível no disco." });
    }

    const { rows: jaTem } = await db.query(
      "SELECT name, cpf, active FROM employees WHERE company_id = $1",
      [id]
    );
    const existentes = new Set(jaTem.map((r) => String(r.cpf).replace(/\D/g, "")));
    const funcs = funcionarios.map((f) => ({ ...f, jaCadastrado: existentes.has(f.cpf) }));

    // Demissão: ativos que NÃO estão no extrato atual = saíram. Serão inativados
    // (continuam visíveis ao admin, somem para a empresa).
    const noExtrato = new Set(funcionarios.map((f) => f.cpf));
    const ausentes = jaTem
      .filter((r) => r.active && !noExtrato.has(String(r.cpf).replace(/\D/g, "")))
      .map((r) => r.name);

    res.json({
      competencia: extrato.competencia,
      arquivo: extrato.file_name,
      com_salario: funcs.filter((f) => f.salarioBase).length,
      invalidos,
      total: funcs.length,
      novos: funcs.filter((f) => !f.jaCadastrado).length,
      inativar: ausentes.length,
      ausentes,
      funcionarios: funcs,
    });
  } catch (err) {
    console.error("[extrato-employees]", err);
    res.status(500).json({ error: "Erro ao ler o extrato" });
  }
});

/**
 * Varre TODAS as empresas e resume quantos funcionários o extrato traria por empresa,
 * sem gravar (dry-run). É a "revisão antes" para o cadastro em massa.
 */
router.post("/extrato-employees/scan-all", requireArea("funcionarios"), async (_req, res) => {
  try {
    const { rows: companies } = await db.query("SELECT id, name, cnpj FROM companies ORDER BY name");
    const resultados = [];
    for (const c of companies) {
      const { extrato, funcionarios } = await funcionariosDoExtrato(c.id);
      if (!extrato || !funcionarios.length) continue;
      const { rows: jaTem } = await db.query("SELECT cpf, active FROM employees WHERE company_id = $1", [c.id]);
      const existentes = new Set(jaTem.map((r) => String(r.cpf).replace(/\D/g, "")));
      const noExtrato = new Set(funcionarios.map((f) => f.cpf));
      const novos = funcionarios.filter((f) => !existentes.has(f.cpf)).length;
      const inativar = jaTem.filter(
        (r) => r.active && !noExtrato.has(String(r.cpf).replace(/\D/g, ""))
      ).length;
      resultados.push({ id: c.id, name: c.name, competencia: extrato.competencia,
        encontrados: funcionarios.length, novos, inativar });
    }
    res.json({
      empresas_com_extrato: resultados.length,
      total_novos: resultados.reduce((s, r) => s + r.novos, 0),
      total_inativar: resultados.reduce((s, r) => s + r.inativar, 0),
      empresas: resultados,
    });
  } catch (err) {
    console.error("[scan-all]", err);
    res.status(500).json({ error: "Erro na varredura" });
  }
});

/**
 * Cadastra os funcionários do extrato. Sem `id` no corpo, faz para TODAS as empresas.
 * Reaproveita a mesma validação/inserção da importação por planilha.
 */
router.post("/extrato-employees/import", requireArea("funcionarios"), async (req, res) => {
  try {
    const alvoId = req.body?.company_id;
    let companies;
    if (alvoId) {
      if (!validateUUID(alvoId)) return res.status(400).json({ error: "company_id inválido" });
      const { rows } = await db.query("SELECT id, name, cnpj FROM companies WHERE id = $1", [alvoId]);
      if (!rows.length) return res.status(404).json({ error: "Empresa não encontrada" });
      companies = rows;
    } else {
      const { rows } = await db.query("SELECT id, name, cnpj FROM companies ORDER BY name");
      companies = rows;
    }

    let totalInseridos = 0;
    let totalPulados = 0;
    let totalInativados = 0;
    const porEmpresa = [];

    for (const c of companies) {
      const { funcionarios, competencia } = await funcionariosDoExtrato(c.id);
      // Guarda: sem funcionários no extrato (parse falhou/vazio), NÃO mexe em nada —
      // senão inativaria a empresa inteira por engano.
      if (!funcionarios.length) continue;
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const r = await importEmployeesForCompany(client, c.id, c.cnpj, c.cnpj, funcionarios, {
          competencia,
        });
        if (r.status !== 201) {
          await client.query("ROLLBACK");
          porEmpresa.push({ name: c.name, erro: r.body.error });
          continue;
        }
        // Demissão: ativos que não estão no extrato atual viram inativos.
        const cpfs = funcionarios.map((f) => f.cpf);
        const inat = await client.query(
          `UPDATE employees SET active = false
           WHERE company_id = $1 AND active IS TRUE AND cpf <> ALL($2::text[])
           RETURNING id, name`,
          [c.id, cpfs]
        );
        // A importação manual É a revisão humana: fecha os avisos abertos dessas
        // pessoas para não pedir a mesma confirmação duas vezes.
        if (inat.rowCount) {
          await client.query(
            `UPDATE employee_exit_alerts
                SET situacao = 'resolvido', resolucao = 'inativado', resolvido_em = now()
              WHERE situacao = 'pendente' AND employee_id = ANY($1::uuid[])`,
            [inat.rows.map((r) => r.id)]
          );
        }
        await client.query("COMMIT");
        totalInseridos += r.body.inserted;
        totalPulados += r.body.skipped;
        totalInativados += inat.rowCount;
        porEmpresa.push({
          name: c.name,
          inseridos: r.body.inserted,
          pulados: r.body.skipped,
          inativados: inat.rowCount,
        });
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        porEmpresa.push({ name: c.name, erro: e.message });
      } finally {
        client.release();
      }
    }

    res.json({ inseridos: totalInseridos, pulados: totalPulados, inativados: totalInativados, empresas: porEmpresa });
  } catch (err) {
    console.error("[extrato-import]", err);
    res.status(500).json({ error: "Erro ao cadastrar funcionários do extrato" });
  }
});

router.post("/companies/:id/import-employees", requireArea("funcionarios"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });

    const { rows: companyRows } = await db.query(
      "SELECT id, cnpj FROM companies WHERE id = $1 LIMIT 1",
      [id]
    );
    if (!companyRows.length) return res.status(404).json({ error: "Empresa não encontrada" });

    const company = companyRows[0];
    const fileCnpj = (req.body?.fileCnpj || "").toString();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await importEmployeesForCompany(
        client,
        company.id,
        company.cnpj,
        fileCnpj,
        rows
      );
      if (result.status !== 201) {
        await client.query("ROLLBACK");
        return res.status(result.status).json(result.body);
      }
      await client.query("COMMIT");
      return res.status(201).json(result.body);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno ao importar funcionários" });
  }
});

/**
 * GET /admin/config/ia — Configuração de IA para CNPJ
 */
router.get("/config/ia", adminOnly, async (req, res) => {
  try {
    const provider = (await getSetting(db, "provider_ia_cnpj")) || "claude";
    const habilitada = (await getSetting(db, "ia_cnpj_habilitada")) === "true";
    const limiar = Number(await getSetting(db, "ia_cnpj_limiar_confianca")) || 85;
    const timeout = Number(await getSetting(db, "ia_cnpj_timeout_ms")) || 30000;
    // Toggle próprio: usa o MESMO provedor/chave acima, mas o admin liga a IA para CNPJ
    // e vencimento de forma independente — um documento genérico confunde mais do que
    // um DARF, então nem todo escritório vai querer os dois ligados juntos.
    const vencimentoHabilitada = (await getSetting(db, "ia_vencimento_habilitada")) === "true";

    res.json({
      provider,
      habilitada,
      limiar_confianca: limiar,
      timeout_ms: timeout,
      vencimento_habilitada: vencimentoHabilitada,
      provedores_disponiveis: ["claude", "gemini", "chatgpt"],
    });
  } catch (err) {
    console.error("[admin] config/ia GET:", err.message);
    res.status(500).json({ error: "Erro ao carregar configuração" });
  }
});

/**
 * PUT /admin/config/ia — Salvar configuração de IA
 */
router.put("/config/ia", adminOnly, async (req, res) => {
  const { provider, habilitada, limiar_confianca, timeout_ms, api_key, vencimento_habilitada } = req.body || {};

  if (provider && !["claude", "gemini", "chatgpt"].includes(provider)) {
    return res.status(400).json({ error: "Provider inválido" });
  }
  if (limiar_confianca !== undefined && (limiar_confianca < 0 || limiar_confianca > 100)) {
    return res.status(400).json({ error: "Limiar deve estar entre 0 e 100" });
  }
  if (timeout_ms !== undefined && timeout_ms < 1000) {
    return res.status(400).json({ error: "Timeout mínimo é 1000ms" });
  }

  try {
    if (provider) await setSetting(db, "provider_ia_cnpj", provider);
    if (habilitada !== undefined) await setSetting(db, "ia_cnpj_habilitada", habilitada ? "true" : "false");
    if (limiar_confianca !== undefined) await setSetting(db, "ia_cnpj_limiar_confianca", String(limiar_confianca));
    if (timeout_ms !== undefined) await setSetting(db, "ia_cnpj_timeout_ms", String(timeout_ms));
    if (vencimento_habilitada !== undefined) {
      await setSetting(db, "ia_vencimento_habilitada", vencimento_habilitada ? "true" : "false");
    }
    if (api_key && provider) await setSecretSetting(db, `ia_api_key_${provider}`, api_key);

    res.json({ ok: true });
  } catch (err) {
    console.error("[admin] config/ia PUT:", err.message);
    res.status(500).json({ error: "Erro ao salvar configuração" });
  }
});

/**
 * POST /admin/config/ia/testar — Testar conexão com o provider de IA
 */
router.post("/config/ia/testar", adminOnly, async (req, res) => {
  const provider = req.body?.provider || (await getSetting(db, "provider_ia_cnpj")) || "claude";

  const chaveEnv = {
    claude: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GOOGLE_API_KEY,
    chatgpt: process.env.OPENAI_API_KEY,
  }[provider];
  const chaveDb = await getSecretSetting(db, `ia_api_key_${provider}`);
  const chave = chaveEnv || chaveDb;

  if (!chave) {
    return res.json({ ok: false, erro: `Sem credencial configurada para ${provider}` });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let resultado;

    if (provider === "claude") {
      resultado = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": chave,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 10,
          messages: [{ role: "user", content: "Responda apenas: ok" }],
        }),
        signal: controller.signal,
      });
    } else if (provider === "gemini") {
      resultado = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${chave}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "ok" }] }] }),
          signal: controller.signal,
        }
      );
    } else if (provider === "chatgpt") {
      resultado = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${chave}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 10,
          messages: [{ role: "user", content: "ok" }],
        }),
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);
    res.json({ ok: resultado.ok, erro: resultado.ok ? null : `HTTP ${resultado.status}` });
  } catch (err) {
    res.json({ ok: false, erro: err.message });
  }
});

/**
 * POST /admin/vencimentos-sugeridos/rodar — dispara a varredura EM SEGUNDO PLANO e volta
 * na hora. Rodar de forma síncrona no request estourava o timeout do nginx (60s) em
 * competências com muitos documentos ou com IA habilitada — o nginx devolvia a própria
 * página de erro (HTML) no lugar da resposta da API. Painel acompanha via GET .../status,
 * mesmo padrão de /sync-gclick.
 */
router.post("/vencimentos-sugeridos/rodar", adminOnly, async (req, res) => {
  const { desde, limite } = req.body || {};
  if (!desde || !/^\d{4}-\d{2}$/.test(desde)) {
    return res.status(400).json({ error: "Parâmetro 'desde' deve estar no formato AAAA-MM" });
  }
  if (dueDateSugestoes.estaRodando()) {
    return res.status(409).json({ error: "Já existe uma varredura em andamento." });
  }
  varrerVencimentos(db, { desde, limite }).catch((e) =>
    console.error("[admin] vencimentos-sugeridos/rodar:", e.message)
  );
  res.status(202).json({ message: "Varredura iniciada." });
});

/**
 * GET /admin/vencimentos-sugeridos/status — para o painel acompanhar a varredura em
 * segundo plano (mesmo padrão de /sync-gclick/status).
 */
router.get("/vencimentos-sugeridos/status", adminOnly, (_req, res) => {
  res.json({ rodando: dueDateSugestoes.estaRodando(), ultima: dueDateSugestoes.ultimaExecucao() });
});

/**
 * GET /admin/vencimentos-sugeridos — fila de revisão (só pendentes).
 */
router.get("/vencimentos-sugeridos", adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.id, s.data_sugerida, s.data_anterior, s.origem, s.confianca, s.provider_ia, s.motivo, s.criado_em,
             d.id AS deliverable_id, d.title, d.category, d.competencia, d.file_name,
             c.id AS company_id, c.name AS company_nome, c.cnpj AS company_cnpj
      FROM due_date_sugestoes s
      JOIN deliverables d ON d.id = s.deliverable_id
      JOIN companies c ON c.id = d.company_id
      WHERE s.status = 'pendente'
      ORDER BY s.criado_em ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error("[admin] GET vencimentos-sugeridos:", err.message);
    res.status(500).json({ error: "Erro ao carregar sugestões" });
  }
});

/**
 * POST /admin/vencimentos-sugeridos/:id/aprovar — grava due_date em deliverables e marca
 * a sugestão como aprovada. Só agora o vencimento vira fato — antes disso era palpite.
 */
router.post("/vencimentos-sugeridos/:id/aprovar", adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT deliverable_id, data_sugerida FROM due_date_sugestoes
       WHERE id = $1 AND status = 'pendente'`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Sugestão não encontrada ou já decidida" });

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE deliverables SET due_date = $1 WHERE id = $2`, [
        rows[0].data_sugerida,
        rows[0].deliverable_id,
      ]);
      await client.query(
        `UPDATE due_date_sugestoes
         SET status = 'aprovada', decidido_em = now(), decidido_por = $2
         WHERE id = $1`,
        [id, req.admin.id]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[admin] aprovar vencimento-sugerido:", err.message);
    res.status(500).json({ error: "Erro ao aprovar sugestão" });
  }
});

/**
 * POST /admin/vencimentos-sugeridos/:id/rejeitar — não repete a mesma sugestão no
 * próximo ciclo de varredura (o índice único é por deliverable_id só entre pendentes).
 */
router.post("/vencimentos-sugeridos/:id/rejeitar", adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `UPDATE due_date_sugestoes
       SET status = 'rejeitada', decidido_em = now(), decidido_por = $2
       WHERE id = $1 AND status = 'pendente'
       RETURNING id`,
      [id, req.admin.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Sugestão não encontrada ou já decidida" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin] rejeitar vencimento-sugerido:", err.message);
    res.status(500).json({ error: "Erro ao rejeitar sugestão" });
  }
});

/**
 * Envia acesso (senha provisória) por WhatsApp para empresas selecionadas ou todas.
 *
 * Fluxo: gera senha aleatória → salva hash + must_change_password → envia mensagem.
 * A senha expira em 30 dias (campo password_expires_at). No primeiro login o cliente
 * obrigatoriamente troca a senha e aceita LGPD.
 */
router.post("/companies/enviar-acesso", requireArea("empresas"), async (req, res) => {
  const { companyIds } = req.body || {};

  if (!companyIds) {
    return res.status(400).json({ error: "Envie companyIds (array de UUIDs ou \"all\")" });
  }

  try {
    let filtro = "";
    const params = [];
    if (companyIds === "all") {
      filtro = "WHERE COALESCE(c.phone, g.phone) IS NOT NULL AND COALESCE(c.phone, g.phone) <> ''";
    } else if (Array.isArray(companyIds) && companyIds.length > 0) {
      if (!companyIds.every(validateUUID)) {
        return res.status(400).json({ error: "IDs inválidos na lista" });
      }
      params.push(companyIds);
      filtro = "WHERE c.id = ANY($1) AND COALESCE(c.phone, g.phone) IS NOT NULL AND COALESCE(c.phone, g.phone) <> ''";
    } else {
      return res.status(400).json({ error: "companyIds deve ser \"all\" ou array de UUIDs" });
    }

    const { rows: empresas } = await db.query(
      `SELECT c.id, c.name, c.cnpj, c.contact_email,
              COALESCE(c.phone, g.phone) AS phone
         FROM companies c
         LEFT JOIN gclick_clients g ON g.company_id = c.id
        ${filtro}`,
      params
    );

    if (!empresas.length) {
      return res.json({ enviados: 0, erros: [], mensagem: "Nenhuma empresa com telefone cadastrado." });
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const resultados = [];
    const erros = [];

    for (const emp of empresas) {
      try {
        const senha = gerarSenhaInicial();
        const hash = await bcrypt.hash(senha, 10);

        await db.query(
          `UPDATE companies
              SET password_hash = $1,
                  must_change_password = true,
                  password_expires_at = $2
            WHERE id = $3`,
          [hash, expiresAt, emp.id]
        );

        const loginDisplay = emp.cnpj
          ? emp.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
          : emp.contact_email || "seu CNPJ";

        const emailDisplay = emp.contact_email || "(não cadastrado)";

        const texto = [
          `Oi! Jeandson da Nescon Contabilidade aqui.`,
          ``,
          `A partir de agora, além dos envios por e-mail, faremos gestão pelo *Portal do Cliente*.`,
          ``,
          `📋 *Seus dados de acesso:*`,
          `Login: ${loginDisplay}`,
          `E-mail cadastrado: ${emailDisplay}`,
          `Senha temporária: *${senha}*`,
          ``,
          `👉 Acesse: https://clientes.nescon.com.br`,
          ``,
          `No primeiro acesso você trocará a senha — só você terá a nova. A senha temporária expira em 30 dias.`,
          ``,
          `No portal você terá:`,
          `• Folhas de pagamento`,
          `• Guias federais`,
          `• Consulta de férias`,
          `• Custo de folha`,
          `• Gestão de guias`,
          ``,
          `📌 Este é um canal informativo. Sobre qualquer assunto, entre em contato pelo WhatsApp de atendimento da Nescon: +55 11 94862-6605`,
        ].join("\n");

        const numero = emp.phone.startsWith("55") ? emp.phone : `55${emp.phone}`;
        await enviarTexto({ numero, texto, delayMs: 2000 });

        resultados.push({ id: emp.id, name: emp.name, status: "enviado" });
      } catch (err) {
        erros.push({ id: emp.id, name: emp.name, erro: err.message });
      }
    }

    res.json({
      enviados: resultados.length,
      erros,
      total: empresas.length,
      resultados,
    });
  } catch (err) {
    console.error("[admin] enviar-acesso:", err.message);
    res.status(500).json({ error: "Erro ao enviar acessos" });
  }
});

/**
 * Arquivar / reativar empresa.
 *
 * Arquivar tira o cliente do ar sem apagar nada: some das listas e das contagens do
 * painel, para de receber alerta, cobranca e aviso de documento, e perde o acesso ao
 * portal. Entregas, boletos e conversas continuam no banco — e e por isso que arquiva
 * em vez de deletar: depois que o contrato acaba, o historico e justamente o que o
 * escritorio precisa poder consultar.
 *
 * A assimetria de permissao e proposital: ARQUIVAR e da area `empresas` (operacao do
 * dia a dia), REATIVAR e so do dono do sistema. Devolver um cliente ao ar religa
 * cobranca automatica e acesso ao portal — nao e coisa para acontecer por engano.
 */
router.post("/companies/:id/arquivar", requireArea("empresas"), async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id)) return res.status(400).json({ error: "id inválido" });
  const motivo = (req.body?.motivo || "").toString().trim().slice(0, 300) || null;
  try {
    const { rowCount } = await db.query(
      `UPDATE companies
          SET arquivada = true, arquivada_em = now(),
              arquivada_por = $2::uuid, arquivada_motivo = $3
        WHERE id = $1::uuid AND arquivada IS NOT TRUE`,
      [id, req.admin.id, motivo]
    );
    // rowCount 0 = ja estava arquivada. Nao e erro: o botao pode ter sido clicado duas
    // vezes, ou por duas pessoas — o estado final e o mesmo.
    res.json({ ok: true, ja_estava_arquivada: rowCount === 0 });
  } catch (err) {
    console.error("[admin] arquivar empresa:", err.message);
    res.status(500).json({ error: "Não foi possível arquivar a empresa" });
  }
});

/** Só o dono do sistema devolve uma empresa ao ar. */
router.post("/companies/:id/reativar", requireOwner, async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id)) return res.status(400).json({ error: "id inválido" });
  try {
    const { rowCount } = await db.query(
      `UPDATE companies
          SET arquivada = false, arquivada_em = NULL,
              arquivada_por = NULL, arquivada_motivo = NULL
        WHERE id = $1::uuid AND arquivada IS TRUE`,
      [id]
    );
    res.json({ ok: true, ja_estava_ativa: rowCount === 0 });
  } catch (err) {
    console.error("[admin] reativar empresa:", err.message);
    res.status(500).json({ error: "Não foi possível reativar a empresa" });
  }
});

/** Lista das arquivadas — a única tela que as mostra. Só o dono, que é quem reativa. */
router.get("/companies/arquivadas", requireOwner, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.cnpj, c.arquivada_em, c.arquivada_motivo,
              a.nome AS arquivada_por_nome
         FROM companies c
         LEFT JOIN platform_admins a ON a.id = c.arquivada_por
        WHERE c.arquivada IS TRUE
        ORDER BY c.arquivada_em DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("[admin] listar arquivadas:", err.message);
    res.status(500).json({ error: "Não foi possível carregar as empresas arquivadas" });
  }
});

/** Excluir empresa (soft-delete). Só o dono. */
router.post("/companies/:id/excluir", requireOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body || {};
    const { rowCount } = await db.query(
      `UPDATE companies
          SET excluida = true, excluida_em = now(),
              excluida_por = $2::uuid, excluida_motivo = $3
        WHERE id = $1::uuid AND excluida IS NOT TRUE`,
      [id, req.admin.id, motivo?.trim() || null]
    );
    res.json({ ok: true, ja_estava_excluida: rowCount === 0 });
  } catch (err) {
    console.error("[admin] excluir empresa:", err.message);
    res.status(500).json({ error: "Não foi possível excluir a empresa" });
  }
});

/** Reverter exclusão de empresa. Só o dono. */
router.post("/companies/:id/reverter-exclusao", requireOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query(
      `UPDATE companies
          SET excluida = false, excluida_em = NULL,
              excluida_por = NULL, excluida_motivo = NULL
        WHERE id = $1::uuid AND excluida IS TRUE`,
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Empresa não encontrada ou não está excluída" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin] reverter exclusao empresa:", err.message);
    res.status(500).json({ error: "Não foi possível reverter a exclusão" });
  }
});

/** Lista das excluídas — só o dono. */
router.get("/companies/excluidas", requireOwner, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.cnpj, c.excluida_em, c.excluida_motivo,
              a.nome AS excluida_por_nome
         FROM companies c
         LEFT JOIN platform_admins a ON a.id = c.excluida_por
        WHERE c.excluida IS TRUE
        ORDER BY c.excluida_em DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("[admin] listar excluidas:", err.message);
    res.status(500).json({ error: "Não foi possível carregar as empresas excluídas" });
  }
});

module.exports = router;
