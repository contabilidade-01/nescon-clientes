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
const { enviarTexto, enviarDocumento, statusInstancia, lerWebhookCadastrado } = require("../uazapi");
const { obterChaveApi } = require("../iaProvider");
const numeroWpp = require("../whatsappNumero");
const { minutosSP } = require("../diasBancarios");
const { dentroDaJanela, descricaoJanela } = require("../janelaEnvio");
const dueDateSugestoes = require("../dueDateSugestoes");
const { varrerVencimentos } = dueDateSugestoes;
const { reaplicarRegraNucleo } = require("../reaplicarRegraNucleo");
const { lerManutencao, salvarManutencao } = require("../maintenanceMode");
const fs = require("fs");

function adminOnly(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: "Acesso restrito a administradores" });
  }
  next();
}

router.use(authMiddleware);
router.use(adminOnly);

/**
 * Modo manutenção. GET: qualquer admin vê o estado. PUT: só o dono liga/desliga — é um
 * interruptor global que tranca todos os clientes de fora.
 */
router.get("/manutencao", async (_req, res) => {
  try {
    res.json(await lerManutencao(db, { force: true }));
  } catch (err) {
    console.error("[admin] manutencao ler:", err.message);
    res.status(500).json({ error: "Erro ao ler o modo manutenção" });
  }
});

router.put("/manutencao", requireOwner, async (req, res) => {
  const { ativo, mensagem } = req.body || {};
  if (ativo !== undefined && typeof ativo !== "boolean") {
    return res.status(400).json({ error: "ativo deve ser booleano" });
  }
  if (mensagem !== undefined && mensagem !== null && !validateString(String(mensagem), 0, 500)) {
    return res.status(400).json({ error: "mensagem inválida (máx. 500 caracteres)" });
  }
  try {
    res.json(await salvarManutencao(db, { ativo, mensagem }));
  } catch (err) {
    console.error("[admin] manutencao salvar:", err.message);
    res.status(500).json({ error: "Erro ao salvar o modo manutenção" });
  }
});

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
 * GET /admin/documentos — lista deliverables com filtros (para tela de gestão).
 */
router.get("/documentos", requireArea("entregas"), async (req, res) => {
  try {
    const { company_id, category, de, ate, busca } = req.query;
    const params = [];
    const filtros = ["d.cancelado IS NOT TRUE"];

    if (company_id && validateUUID(company_id.toString())) {
      params.push(company_id);
      filtros.push(`d.company_id = $${params.length}`);
    }
    if (category && ["guia", "boleto", "folha", "outro", "avulso"].includes(category.toString())) {
      params.push(category);
      filtros.push(`d.category = $${params.length}`);
    }
    if (de) {
      params.push(de);
      filtros.push(`d.created_at >= $${params.length}::date`);
    }
    if (ate) {
      params.push(ate);
      filtros.push(`d.created_at < ($${params.length}::date + 1)`);
    }
    if (busca) {
      params.push(`%${busca}%`);
      filtros.push(`(d.title ILIKE $${params.length} OR d.file_name ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
    const { rows } = await db.query(
      `SELECT d.id, d.title, d.file_name, d.category, d.doc_type, d.competencia,
              d.source, d.created_at, d.due_date,
              c.name AS empresa_nome, c.cnpj AS empresa_cnpj
         FROM deliverables d
         JOIN companies c ON c.id = d.company_id
         ${where}
        ORDER BY d.created_at DESC
        LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("[admin] documentos:", err.message);
    res.status(500).json({ error: "Erro ao listar documentos" });
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
/**
 * PUT /admin/companies/:id/matriz — vincula ou desvincula a empresa de uma matriz.
 *
 * `matriz_id = null` → empresa fica independente (sem grupo).
 * `matriz_id = UUID` → empresa vira filial daquela matriz.
 *
 * Validações:
 * - Não pode ser matriz de si mesma
 * - A "matriz" destino não pode ser filial de alguém (só 1 nível de hierarquia)
 * - A empresa não pode ter filiais apontando para ela (se tem, é matriz — desvincule elas antes)
 */
router.put("/companies/:id/matriz", requireArea("empresas"), async (req, res) => {
  const { id } = req.params;
  const { matriz_id } = req.body || {};
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });

  // Desvincular (null)
  if (matriz_id === null || matriz_id === "") {
    try {
      await db.query("UPDATE companies SET matriz_id = NULL WHERE id = $1", [id]);
      return res.json({ ok: true, matriz_id: null });
    } catch (err) {
      console.error("[admin] desvincular matriz:", err.message);
      return res.status(500).json({ error: "Erro ao desvincular" });
    }
  }

  if (!validateUUID(matriz_id)) return res.status(400).json({ error: "matriz_id inválido" });
  if (matriz_id === id) return res.status(400).json({ error: "Empresa não pode ser matriz de si mesma" });

  try {
    // A matriz destino não pode ser filial de outra (só 1 nível)
    const { rows: matrizInfo } = await db.query(
      "SELECT id, matriz_id FROM companies WHERE id = $1",
      [matriz_id]
    );
    if (!matrizInfo.length) return res.status(404).json({ error: "Matriz não encontrada" });
    if (matrizInfo[0].matriz_id) {
      return res.status(400).json({ error: "A empresa selecionada já é filial de outra. Só matrizes (sem vínculo acima) podem ter filiais." });
    }

    // A empresa não pode ter filiais apontando para ela (senão vira cadeia)
    const { rows: filiais } = await db.query(
      "SELECT id FROM companies WHERE matriz_id = $1 LIMIT 1",
      [id]
    );
    if (filiais.length) {
      return res.status(400).json({ error: "Esta empresa já é matriz de outras. Desvincule as filiais antes." });
    }

    await db.query("UPDATE companies SET matriz_id = $1 WHERE id = $2", [matriz_id, id]);
    res.json({ ok: true, matriz_id });
  } catch (err) {
    console.error("[admin] vincular matriz:", err.message);
    res.status(500).json({ error: "Erro ao vincular empresa" });
  }
});

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

// Boletos Cora e honorários: extraídos para adminBoletos.js (mesmo router).
require("./adminBoletos")(router);

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
 * PUT /admin/companies/:id/alterar-senha — admin define uma senha específica para o cliente.
 *
 * Diferente da senha-inicial (aleatória, obriga troca), aqui o admin escolhe a senha
 * e decide se o cliente precisa trocar no próximo login ou não.
 */
router.put("/companies/:id/alterar-senha", requireArea("empresas"), async (req, res) => {
  const { id } = req.params;
  const { nova_senha, obrigar_troca } = req.body || {};
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
  if (!validateString(nova_senha, 4, 128)) {
    return res.status(400).json({ error: "Senha precisa ter pelo menos 4 caracteres" });
  }
  try {
    const hash = await bcrypt.hash(String(nova_senha).trim(), 10);
    const mustChange = obrigar_troca !== false; // default: obriga trocar
    const { rows } = await db.query(
      `UPDATE companies
          SET password_hash = $1, must_change_password = $2, password_expires_at = NULL
        WHERE id = $3
        RETURNING id, name, cnpj`,
      [hash, mustChange, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Empresa não encontrada" });
    res.json({
      ...rows[0],
      must_change_password: mustChange,
      message: mustChange
        ? "Senha alterada. O cliente terá de trocá-la no próximo acesso."
        : "Senha alterada com sucesso.",
    });
  } catch (err) {
    console.error("[admin] alterar senha:", err.message);
    res.status(500).json({ error: "Erro ao alterar a senha" });
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
 * GET /admin/ferias-urgencia — funcionários de TODAS as empresas prestes a perder férias.
 *
 * Consolida a mesma informação que o cliente vê na FériasPage, mas de toda a carteira:
 * o admin quer saber "quem está para vencer?" SEM abrir empresa por empresa.
 *
 * Retorna agrupado por empresa, ordenado por urgência (quem vence antes vem primeiro).
 * Só períodos com situacao "no_prazo" ou "vencidas" que ainda não foram tiradas.
 */
router.get("/ferias-urgencia", async (_req, res) => {
  try {
    const { enriquecer, normalizar: normNome } = require("../routes/vacations");
    const { mediaSalarialDaEmpresa } = require("../folhaKpi");
    const { faltasParaProximaPerda } = require("../vacationRules");

    // Busca todos os períodos do último upload de cada empresa, incluindo salários
    const { rows } = await db.query(
      `WITH ultimo_upload AS (
        SELECT DISTINCT ON (company_id) id, company_id
          FROM vacation_uploads
         ORDER BY company_id, criado_em DESC
      )
      SELECT vp.id, vp.nome, vp.codigo, vp.admissao,
             vp.inicio_aquisitivo, vp.fim_aquisitivo,
             vp.limite_gozo, vp.dias_direito, vp.dias_gozados,
             vp.dias_acumulados, vp.faltas,
             c.id AS company_id, c.name AS empresa_nome, c.cnpj AS empresa_cnpj
        FROM vacation_periods vp
        JOIN ultimo_upload u ON u.id = vp.upload_id
        JOIN companies c ON c.id = vp.company_id
       WHERE c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
         AND vp.limite_gozo IS NOT NULL
         AND vp.limite_gozo <= (CURRENT_DATE + interval '120 days')
         AND (vp.dias_gozados IS NULL OR vp.dias_gozados < vp.dias_direito)
       ORDER BY vp.limite_gozo ASC, c.name, vp.nome`
    );

    // Agrupar por empresa e enriquecer com custos e alertas (igual à FériasPage do cliente)
    const porEmpresa = new Map();
    for (const r of rows) {
      if (!porEmpresa.has(r.company_id)) {
        porEmpresa.set(r.company_id, {
          company_id: r.company_id,
          empresa_nome: r.empresa_nome,
          empresa_cnpj: r.empresa_cnpj,
          periodos_raw: [],
        });
      }
      porEmpresa.get(r.company_id).periodos_raw.push(r);
    }

    // Para cada empresa, carregar salários e calcular custos (mesma lógica do FériasPage)
    const empresas = [];
    for (const [companyId, emp] of porEmpresa) {
      // Salários da empresa
      const { rows: empRows } = await db.query(
        `SELECT codigo, name, salario_base, salario_competencia, vinculo
           FROM employees WHERE company_id = $1`,
        [companyId]
      );
      const porCodigo = new Map();
      const porNome = new Map();
      for (const e of empRows) {
        const salario = e.salario_base === null ? null : Number(e.salario_base);
        if (salario === null || salario <= 0) continue;
        const dado = { salario, competencia: e.salario_competencia, vinculo: e.vinculo };
        if (e.codigo) porCodigo.set(String(e.codigo).replace(/^0+/, ""), dado);
        const chave = normNome(e.name);
        if (chave && !porNome.has(chave)) porNome.set(chave, dado);
      }

      let mediaFolha = null;
      try {
        mediaFolha = await mediaSalarialDaEmpresa(db, companyId);
      } catch { /* sem folha */ }

      const periodos = enriquecer(emp.periodos_raw, { porCodigo, porNome }, mediaFolha);

      // Calcular custo total da empresa
      let custoTotal = 0;
      for (const p of periodos) {
        if (p.custo?.total) custoTotal += p.custo.total;
      }

      empresas.push({
        company_id: emp.company_id,
        empresa_nome: emp.empresa_nome,
        empresa_cnpj: emp.empresa_cnpj,
        custo_total: custoTotal,
        funcionarios: periodos.map((p) => ({
          id: p.id,
          nome: p.nome,
          codigo: p.codigo,
          admissao: p.admissao,
          inicio_aquisitivo: p.inicio_aquisitivo,
          fim_aquisitivo: p.fim_aquisitivo,
          limite_gozo: p.limite_gozo,
          situacao: p.situacao,
          dias_direito: p.dias_direito,
          dias_gozados: p.dias_gozados,
          dias_a_pagar: p.dias_a_pagar,
          faltas: p.faltas,
          alerta_faltas: p.alerta_faltas,
          custo: p.custo,
          origem_salario: p.origem_salario,
        })),
      });
    }

    const totalFuncionarios = empresas.reduce((s, e) => s + e.funcionarios.length, 0);
    const totalVencidos = empresas.reduce(
      (s, e) => s + e.funcionarios.filter((f) => f.situacao === "vencida").length, 0
    );
    const totalEmRiscoFaltas = empresas.reduce(
      (s, e) => s + e.funcionarios.filter((f) => f.alerta_faltas && f.alerta_faltas.faltasRestantes <= 3).length, 0
    );
    const custoCarteira = empresas.reduce((s, e) => s + e.custo_total, 0);

    res.json({
      total_empresas: empresas.length,
      total_funcionarios: totalFuncionarios,
      total_vencidos: totalVencidos,
      total_em_risco_faltas: totalEmRiscoFaltas,
      custo_carteira: custoCarteira,
      empresas,
    });
  } catch (err) {
    console.error("[admin] ferias-urgencia:", err.message);
    res.status(500).json({ error: "Erro ao buscar férias" });
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
 * GET /admin/acompanhamento-envio?competencia=AAAA-MM
 *
 * Painel "visão de pássaro" do envio de Folha e encargos por competência. Para cada
 * grupo (Folha, FGTS, INSS, DAS) diz, de bate-pronto, quantas empresas estão OK e
 * quantas estão pendentes — e devolve as duas listas para o clique.
 *
 * "Quem é esperado" é AUTO-CALIBRADO pelo histórico: a empresa entra como esperada de um
 * documento se ela já recebeu aquele documento em ALGUMA competência. Isso escopa DAS só
 * a optante do Simples, Folha/FGTS só a quem roda folha, etc. — sem precisar cadastrar
 * regime tributário à mão. OK = tem o documento na competência escolhida; pendente =
 * é esperada mas ainda não tem.
 */
router.get("/acompanhamento-envio", requireArea("entregas"), async (req, res) => {
  const competencia = String(req.query.competencia || "").trim();
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return res.status(400).json({ error: "competencia deve estar no formato AAAA-MM" });
  }
  try {
    // Um passe: por empresa, se TEM histórico de cada documento e se TEM na competência.
    // Folha = categoria 'folha' (extrato/holerite); encargos e DAS = doc_type da guia.
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.cnpj,
              bool_or(d.category = 'folha')                          AS hist_folha,
              bool_or(d.category = 'folha' AND d.competencia = $1)   AS cur_folha,
              bool_or(d.doc_type = 'FGTS')                           AS hist_fgts,
              bool_or(d.doc_type = 'FGTS' AND d.competencia = $1)    AS cur_fgts,
              bool_or(d.doc_type IN ('DCTF_WEB','INSS'))                        AS hist_inss,
              bool_or(d.doc_type IN ('DCTF_WEB','INSS') AND d.competencia = $1) AS cur_inss,
              bool_or(d.doc_type = 'DAS')                            AS hist_das,
              bool_or(d.doc_type = 'DAS' AND d.competencia = $1)     AS cur_das
         FROM companies c
         LEFT JOIN deliverables d
                ON d.company_id = c.id AND d.cancelado IS NOT TRUE
        WHERE c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
        GROUP BY c.id, c.name, c.cnpj
        ORDER BY c.name`,
      [competencia]
    );

    const defs = [
      { chave: "folha", rotulo: "Folha de pagamento", hist: "hist_folha", cur: "cur_folha" },
      { chave: "fgts", rotulo: "FGTS", hist: "hist_fgts", cur: "cur_fgts" },
      { chave: "inss", rotulo: "INSS (DCTF Web)", hist: "hist_inss", cur: "cur_inss" },
      { chave: "das", rotulo: "DAS (Simples)", hist: "hist_das", cur: "cur_das" },
    ];
    const empresaLite = (r) => ({ id: r.id, name: r.name, cnpj: r.cnpj });

    const grupos = defs.map((g) => {
      const esperadas = rows.filter((r) => r[g.hist]);
      const ok = esperadas.filter((r) => r[g.cur]);
      const pendentes = esperadas.filter((r) => !r[g.cur]);
      return {
        chave: g.chave,
        rotulo: g.rotulo,
        esperadas: esperadas.length,
        ok: ok.length,
        pendentes: pendentes.length,
        empresas_ok: ok.map(empresaLite),
        empresas_pendentes: pendentes.map(empresaLite),
      };
    });

    res.json({ competencia, total_empresas: rows.length, grupos });
  } catch (err) {
    console.error("[acompanhamento-envio]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * GET /admin/honorarios-folha?desde=AAAA-MM
 *
 * Cálculo de honorários por HEADCOUNT da folha, por unidade Queijeiro, mês a mês
 * (retroativo a partir de `desde`, padrão 2026-01). Regra: base cobre até 3 registros;
 * a partir do 4º, adicional por colaborador.
 *
 *   honorário = BASE + max(0, registros - REGISTROS_BASE) * ADICIONAL
 *
 * "registros" = nº de empregados da folha daquele mês (payroll_snapshots.empregados, que
 * vem do Extrato Mensal). Mês sem folha lida entra marcado `sem_folha` — mostra a base,
 * mas avisa que o adicional não pôde ser calculado (leia o extrato para fechar).
 */
// Padrão da regra (usado quando o escritório ainda não salvou nada na tela).
const HON_DEFAULT = { base: 350, registros_base: 3, adicional: 50 };

/** Regra vigente: lê de app_settings com fallback no padrão. Configurável pela tela. */
async function lerRegraHon() {
  const num = async (chave, padrao) => {
    const v = await getSetting(db, chave);
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : padrao;
  };
  return {
    base: await num("honorario_base", HON_DEFAULT.base),
    registros_base: await num("honorario_registros_base", HON_DEFAULT.registros_base),
    adicional: await num("honorario_adicional", HON_DEFAULT.adicional),
  };
}

/** Lista de competências 'AAAA-MM' de `desde` até `ate`, inclusive. */
function competenciasEntre(desde, ate) {
  const [ay, am] = desde.split("-").map(Number);
  const [by, bm] = ate.split("-").map(Number);
  const out = [];
  let y = ay;
  let m = am;
  // Trava de segurança: no máximo 120 meses, para nunca cair em laço infinito.
  for (let i = 0; i < 120 && (y < by || (y === by && m <= bm)); i += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function calcularHonorario(registros, regra) {
  const extra = Math.max(0, registros - regra.registros_base);
  return regra.base + extra * regra.adicional;
}

router.get("/honorarios-folha", requireArea("funcionarios"), async (req, res) => {
  const desde = String(req.query.desde || "2026-01").trim();
  if (!/^\d{4}-\d{2}$/.test(desde)) {
    return res.status(400).json({ error: "desde deve estar no formato AAAA-MM" });
  }
  try {
    const regra = await lerRegraHon();
    // Competência atual (São Paulo) como limite superior.
    const agora = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
    }).format(new Date());
    const ate = agora.slice(0, 7);
    const meses = competenciasEntre(desde, ate);
    if (!meses.length) return res.json({ desde, ate, regra, unidades: [] });

    // Unidades Queijeiro (nome contém "queijeiro"), ativas.
    const { rows: unidades } = await db.query(
      `SELECT id, name, cnpj FROM companies
        WHERE name ILIKE '%queijeiro%'
          AND arquivada IS NOT TRUE AND excluida IS NOT TRUE
        ORDER BY name`
    );
    if (!unidades.length) return res.json({ desde, ate, regra, unidades: [] });

    const ids = unidades.map((u) => u.id);
    const { rows: snaps } = await db.query(
      `SELECT company_id, competencia, empregados
         FROM payroll_snapshots
        WHERE company_id = ANY($1) AND competencia = ANY($2)`,
      [ids, meses]
    );
    const porEmpresaComp = new Map();
    for (const s of snaps) porEmpresaComp.set(`${s.company_id}|${s.competencia}`, s.empregados);

    const resultado = unidades.map((u) => {
      let total = 0;
      const mesesLinha = meses.map((competencia) => {
        const emp = porEmpresaComp.get(`${u.id}|${competencia}`);
        const semFolha = emp === undefined || emp === null;
        const registros = semFolha ? null : Number(emp);
        const honorario = semFolha ? regra.base : calcularHonorario(registros, regra);
        total += honorario;
        return { competencia, empregados: registros, sem_folha: semFolha, honorario };
      });
      return { id: u.id, name: u.name, cnpj: u.cnpj, meses: mesesLinha, total };
    });

    res.json({ desde, ate, regra, unidades: resultado });
  } catch (err) {
    console.error("[honorarios-folha]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** GET/PUT /admin/honorarios-config — regra de cálculo (base, registros da base, adicional). */
router.get("/honorarios-config", requireArea("funcionarios"), async (_req, res) => {
  try {
    res.json({ ...(await lerRegraHon()), padrao: HON_DEFAULT });
  } catch (err) {
    console.error("[admin] honorarios-config GET:", err.message);
    res.status(500).json({ error: "Erro ao carregar a configuração" });
  }
});

router.put("/honorarios-config", requireArea("funcionarios"), async (req, res) => {
  const { base, registros_base, adicional } = req.body || {};
  const valida = (v) => v === undefined || (Number.isFinite(Number(v)) && Number(v) >= 0);
  if (!valida(base) || !valida(registros_base) || !valida(adicional)) {
    return res.status(400).json({ error: "Valores devem ser números não negativos" });
  }
  if (registros_base !== undefined && !Number.isInteger(Number(registros_base))) {
    return res.status(400).json({ error: "Registros da base deve ser um número inteiro" });
  }
  try {
    if (base !== undefined) await setSetting(db, "honorario_base", String(Number(base)));
    if (registros_base !== undefined)
      await setSetting(db, "honorario_registros_base", String(Number(registros_base)));
    if (adicional !== undefined) await setSetting(db, "honorario_adicional", String(Number(adicional)));
    res.json({ ...(await lerRegraHon()), padrao: HON_DEFAULT });
  } catch (err) {
    console.error("[admin] honorarios-config PUT:", err.message);
    res.status(500).json({ error: "Erro ao salvar a configuração" });
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
    const { rows: companies } = await db.query(
      "SELECT id, name, cnpj FROM companies WHERE arquivada IS NOT TRUE AND excluida IS NOT TRUE ORDER BY name"
    );
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
      const { rows } = await db.query(
        "SELECT id, name, cnpj FROM companies WHERE arquivada IS NOT TRUE AND excluida IS NOT TRUE ORDER BY name"
      );
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
 * GET /admin/whatsapp/diagnostico — check de comunicação com a uazapi.
 *
 * Junta os três pontos onde o assistente de DP (advertência/suspensão) pode falhar
 * silenciosamente: (1) a instância está conectada? (2) o webhook está no ar e, se há
 * secret, a URL registrada na uazapi PRECISA levar `?token=<secret>` — senão TODO
 * webhook recebe 401 e o assistente nunca responde; (3) a transcrição de áudio tem chave.
 */
router.get("/whatsapp/diagnostico", requireArea("alertas"), async (_req, res) => {
  try {
    const instancia = await statusInstancia();
    const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
    const secretConfigurado = Boolean((process.env.UAZAPI_WEBHOOK_SECRET || "").trim());
    const openaiEnv = Boolean((process.env.OPENAI_API_KEY || "").trim());
    const groqEnv = Boolean((process.env.GROQ_API_KEY || "").trim());
    const chatgptTela = Boolean(await getSecretSetting(db, "ia_api_key_chatgpt"));
    const transcricaoOk = openaiEnv || groqEnv || chatgptTela;
    const providerIa = (await getSetting(db, "provider_ia_cnpj")) || "claude";
    const classificacaoOk = Boolean(await obterChaveApi(providerIa, db));
    const subdominio = (process.env.UAZAPI_SUBDOMAIN || "").trim();
    const contato = (process.env.NESCON_CONTATO_WHATSAPP || "").trim();
    const adminWpp = (process.env.ADMIN_WHATSAPP || "").trim();
    res.json({
      instancia,
      ambiente: {
        public_app_url: base || null,
        uazapi_subdomain: subdominio || null,
        uazapi_token_configurado: Boolean((process.env.UAZAPI_TOKEN || "").trim()),
        webhook_secret_configurado: secretConfigurado,
        nescon_contato_whatsapp: contato || null,
        admin_whatsapp: adminWpp || null,
        openai_api_key_configurada: openaiEnv,
        groq_api_key_configurada: groqEnv,
        chatgpt_tela_configurada: chatgptTela,
      },
      webhook: {
        secret_configurado: secretConfigurado,
        url_base: base ? `${base}/api/whatsapp/webhook` : null,
        url_com_token: secretConfigurado && base
          ? `${base}/api/whatsapp/webhook?token=SEU_SECRET`
          : null,
        cadastrado_na_uazapi: await lerWebhookCadastrado(),
      },
      assistente_dp: {
        transcricao_audio_configurada: transcricaoOk,
        classificacao_ia_configurada: classificacaoOk,
      },
    });
  } catch (err) {
    console.error("[admin] whatsapp/diagnostico:", err.message);
    res.status(500).json({ error: "Erro ao consultar o diagnóstico" });
  }
});

/**
 * POST /admin/whatsapp/testar — envia uma mensagem de teste para um número, provando que
 * o ENVIO (saída) funciona de ponta a ponta. Não valida o recebimento de webhook — para
 * isso, mande "advertência" do seu WhatsApp para o número da Nescon e veja se responde.
 */
router.post("/whatsapp/testar", requireArea("alertas"), async (req, res) => {
  const v = numeroWpp.validar(String(req.body?.numero || ""));
  if (!v.ok) return res.status(400).json({ ok: false, erro: v.motivo });
  try {
    await enviarTexto({
      numero: v.numero,
      texto:
        "✅ Teste de conexão do Portal Nescon. Se você recebeu esta mensagem, o envio pelo WhatsApp está funcionando.",
      delayMs: 300,
    });
    res.json({ ok: true, numero: v.numero });
  } catch (err) {
    console.error("[admin] whatsapp/testar:", err.message);
    res.status(502).json({ ok: false, erro: err.message });
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
 * POST /admin/vencimentos/reaplicar-regra — recalcula pela REGRA o vencimento do núcleo
 * (FGTS/DAS/DCTF Web) já gravado. É cálculo puro, então roda síncrono aqui mesmo.
 *
 * `aplicar` (bool): false (padrão) só PRÉ-VISUALIZA o que mudaria; true grava. É a forma
 * de corrigir pela interface os documentos que entraram com data errada, sem terminal na
 * VPS — mesma lógica do script scripts/backfill-vencimentos.js.
 */
router.post("/vencimentos/reaplicar-regra", adminOnly, async (req, res) => {
  try {
    const { desde, aplicar } = req.body || {};
    const resultado = await reaplicarRegraNucleo(db, { desde, simular: aplicar !== true });
    res.json(resultado);
  } catch (err) {
    console.error("[admin] vencimentos/reaplicar-regra:", err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /admin/acessos?dias=90 — dados da tela "Controle de acessos".
 *
 * Junta portal_eventos (login/uso) com deliverable_accesses (visualização/download).
 * `dias` filtra ranking, contagens e views/downloads (0/ausente = desde sempre). Os
 * "últimos 5 acessos" de cada cliente são sempre os 5 mais recentes, ignorando `dias`.
 * O front filtra a tabela (busca/status) em memória — o volume é de dezenas de clientes.
 */
router.get("/acessos", adminOnly, async (req, res) => {
  try {
    // dias é inteiro sanitizado — seguro inlinar no intervalo (sem injeção).
    const dias = Math.max(0, parseInt(req.query.dias, 10) || 0);
    const janelaPortal = dias > 0 ? `AND criado_em >= now() - interval '${dias} days'` : "";
    const janelaAcc = dias > 0 ? `AND a.acessado_em >= now() - interval '${dias} days'` : "";
    const emUTC = `to_char(criado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')`;

    const [totais, ranking, documentos, clientes, logins, docsPorEmpresa, ultimos, topFerr] =
      await Promise.all([
        db.query(`
          SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE ultimo_login_em IS NOT NULL)::int AS acessaram,
                 count(*) FILTER (WHERE ultimo_login_em >= now() - interval '30 days')::int AS ativos_30d
            FROM companies WHERE excluida IS NOT TRUE AND arquivada IS NOT TRUE`),
        db.query(`
          SELECT ferramenta, count(*)::int AS usos
            FROM portal_eventos
           WHERE tipo = 'uso' ${janelaPortal}
           GROUP BY ferramenta ORDER BY usos DESC`),
        db.query(`
          SELECT count(*) FILTER (WHERE a.evento = 'pagina')::int   AS visualizados,
                 count(*) FILTER (WHERE a.evento = 'download')::int AS baixados
            FROM deliverable_accesses a
           WHERE a.eh_bot = false ${janelaAcc}`),
        db.query(`
          SELECT id, name, cnpj,
                 to_char(ultimo_login_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS ultimo_acesso
            FROM companies WHERE excluida IS NOT TRUE AND arquivada IS NOT TRUE ORDER BY name`),
        db.query(`
          SELECT company_id, count(*)::int AS num_logins
            FROM portal_eventos WHERE tipo = 'login' ${janelaPortal}
           GROUP BY company_id`),
        db.query(`
          SELECT d.company_id,
                 count(*) FILTER (WHERE a.evento = 'pagina')::int   AS views,
                 count(*) FILTER (WHERE a.evento = 'download')::int AS downloads
            FROM deliverable_accesses a
            JOIN deliverables d ON d.id = a.deliverable_id
           WHERE a.eh_bot = false ${janelaAcc}
           GROUP BY d.company_id`),
        db.query(`
          SELECT company_id, ${emUTC} AS em, ip FROM (
            SELECT company_id, criado_em, ip,
                   ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY criado_em DESC) AS rn
              FROM portal_eventos WHERE tipo = 'login'
          ) t WHERE rn <= 5 ORDER BY company_id, criado_em DESC`),
        db.query(`
          SELECT company_id, ferramenta, usos FROM (
            SELECT company_id, ferramenta, count(*)::int AS usos,
                   ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY count(*) DESC) AS rn
              FROM portal_eventos WHERE tipo = 'uso' ${janelaPortal}
             GROUP BY company_id, ferramenta
          ) t WHERE rn <= 3 ORDER BY company_id, usos DESC`),
      ]);

    const loginsMap = new Map(logins.rows.map((r) => [r.company_id, r.num_logins]));
    const docsMap = new Map(docsPorEmpresa.rows.map((r) => [r.company_id, r]));
    const ultimosMap = new Map();
    for (const r of ultimos.rows) {
      if (!ultimosMap.has(r.company_id)) ultimosMap.set(r.company_id, []);
      ultimosMap.get(r.company_id).push({ em: r.em, ip: r.ip });
    }
    const topMap = new Map();
    for (const r of topFerr.rows) {
      if (!topMap.has(r.company_id)) topMap.set(r.company_id, []);
      topMap.get(r.company_id).push({ ferramenta: r.ferramenta, usos: r.usos });
    }

    const listaClientes = clientes.rows.map((c) => {
      const d = docsMap.get(c.id) || { views: 0, downloads: 0 };
      return {
        id: c.id,
        name: c.name,
        cnpj: c.cnpj,
        ultimo_acesso: c.ultimo_acesso,
        num_logins: loginsMap.get(c.id) || 0,
        views: d.views,
        downloads: d.downloads,
        nunca_acessou: !c.ultimo_acesso,
        ultimos_acessos: ultimosMap.get(c.id) || [],
        top_ferramentas: topMap.get(c.id) || [],
      };
    });

    const t = totais.rows[0];
    res.json({
      dias,
      totais: {
        total: t.total,
        acessaram: t.acessaram,
        nunca_acessaram: t.total - t.acessaram,
        ativos_30d: t.ativos_30d,
      },
      ranking: ranking.rows,
      documentos: documentos.rows[0],
      clientes: listaClientes,
    });
  } catch (err) {
    console.error("[admin] acessos:", err.message);
    res.status(500).json({ error: "Erro ao carregar controle de acessos" });
  }
});

/**
 * GET /admin/vencimentos-sugeridos — fila de revisão (só pendentes).
 */
router.get("/vencimentos-sugeridos", adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.id,
             to_char(s.data_sugerida, 'YYYY-MM-DD') AS data_sugerida,
             to_char(s.data_anterior, 'YYYY-MM-DD') AS data_anterior,
             s.origem, s.confianca, s.provider_ia, s.motivo, s.criado_em,
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
 * POST /admin/vencimentos-sugeridos/rejeitar-ferias — rejeita em lote todas as sugestões
 * pendentes que vieram de Programação de Férias (erro de leituras anteriores ao filtro).
 */
router.post("/vencimentos-sugeridos/rejeitar-ferias", adminOnly, async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `UPDATE due_date_sugestoes s
          SET status = 'rejeitada', decidido_em = now(), decidido_por = $1
        WHERE s.status = 'pendente'
          AND EXISTS (
            SELECT 1 FROM deliverables d
             WHERE d.id = s.deliverable_id
               AND (d.file_name ILIKE '%Programa__o de F_rias%'
                 OR d.title ILIKE '%Programa__o de F_rias%'
                 OR d.file_name ILIKE '%Programacao de Ferias%'
                 OR d.title ILIKE '%Programacao de Ferias%')
          )`,
      [req.admin.id]
    );
    res.json({ ok: true, rejeitadas: rowCount });
  } catch (err) {
    console.error("[admin] rejeitar-ferias:", err.message);
    res.status(500).json({ error: "Erro ao rejeitar sugestões de férias" });
  }
});

/**
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

  // Não manda acesso de madrugada. Mesma janela diurna do resto do sistema (janelaEnvio.js):
  // é mensagem que chega no WhatsApp do cliente, então respeita o mesmo horário.
  if (!dentroDaJanela(minutosSP())) {
    return res.json({
      enviados: 0,
      erros: [],
      total: 0,
      resultados: [],
      foraDaJanela: true,
      mensagem: `Fora da janela diurna de envio (${descricaoJanela()}). Nada foi enviado; tente durante o dia.`,
    });
  }

  try {
    // Arquivada/excluída nunca recebe acesso: o contrato acabou e ela nem consegue mais
    // entrar no portal (o login já barra). Sem este filtro, o "Enviar Todos" gerava senha
    // e mandava WhatsApp para ex-clientes — inclusive as arquivadas que a lista da tela
    // já escondia, porque o caminho "all" resolvia as empresas direto aqui no banco.
    const BASE = "c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE";
    const TEM_FONE = "COALESCE(c.phone, g.phone) IS NOT NULL AND COALESCE(c.phone, g.phone) <> ''";
    let filtro = "";
    const params = [];
    if (companyIds === "all") {
      filtro = `WHERE ${BASE} AND ${TEM_FONE}`;
    } else if (Array.isArray(companyIds) && companyIds.length > 0) {
      if (!companyIds.every(validateUUID)) {
        return res.status(400).json({ error: "IDs inválidos na lista" });
      }
      params.push(companyIds);
      filtro = `WHERE c.id = ANY($1) AND ${BASE} AND ${TEM_FONE}`;
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
    // Endereço do portal vem do ambiente (PUBLIC_APP_URL), não fixo no código: assim o
    // link certo sai em qualquer instalação sem editar a mensagem. Fallback no domínio
    // de produção só para a instalação que ainda não configurou a variável.
    const PORTAL_BASE = (process.env.PUBLIC_APP_URL || "https://clientes.nescon.com.br").replace(/\/+$/, "");
    const resultados = [];
    const erros = [];

    for (const emp of empresas) {
      try {
        // Número validado/normalizado pelo mesmo caminho do envio de alertas: telefone
        // fixo ou torto é recusado ANTES de gastar uma senha e uma chamada à uazapi (que
        // aceitaria e a mensagem sumiria no vazio). O acesso só é gravado se o número presta.
        const v = numeroWpp.validar(emp.phone);
        if (!v.ok) {
          erros.push({ id: emp.id, name: emp.name, erro: v.motivo || "WhatsApp inválido." });
          continue;
        }

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

        // O enredo tem de casar: mando o acesso → cliente entra com a senha temporária →
        // troca por uma senha só dele → aceita os termos → está dentro. Os passos numerados
        // deixam essa sequência explícita, para o cliente saber exatamente o que fazer.
        const texto = [
          `Oi! Jeandson da Nescon Contabilidade aqui.`,
          ``,
          `A partir de agora, além dos envios por e-mail, você acompanha tudo pelo *Portal do Cliente*.`,
          ``,
          `📋 *Seus dados de acesso:*`,
          `Login (seu CNPJ): ${loginDisplay}`,
          `Senha temporária: *${senha}*`,
          ``,
          `✅ *Como entrar (leva 1 minuto):*`,
          `1️⃣ Acesse: ${PORTAL_BASE}`,
          `2️⃣ Entre com o login e a senha temporária acima`,
          `3️⃣ No primeiro acesso, você *cria uma nova senha* — só você vai conhecê-la`,
          `4️⃣ Aceite os termos (LGPD) e pronto, está dentro`,
          ``,
          `🔒 A senha temporária expira em *30 dias*. Depois que você trocar, a antiga deixa de valer.`,
          ``,
          `No portal você encontra:`,
          `• Folhas de pagamento`,
          `• Guias federais`,
          `• Consulta de férias`,
          `• Custo de folha`,
          `• Boletos do escritório`,
          ``,
          `📌 Este é um canal informativo. Para atendimento, fale com a Nescon no WhatsApp: +55 11 94862-6605`,
        ].join("\n");

        await enviarTexto({ numero: v.numero, texto, delayMs: 2000 });

        // Só carimba DEPOIS que a mensagem saiu: o verde da tela significa "o cliente
        // recebeu de fato", não "geramos a senha". Se o envio falhar, cai no catch abaixo
        // e a empresa continua vermelha (ainda não enviada), como deve ser.
        await db.query(`UPDATE companies SET acesso_enviado_em = now() WHERE id = $1`, [emp.id]);

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

/**
 * POST /admin/documento-ia — gera campos de advertência/suspensão a partir de texto livre.
 *
 * O admin escreve ou fala (transcrição no front) algo como:
 * "Advertência para Maria, empresa Queijeiro, falta dia 15/08 e 16/08"
 *
 * A IA extrai os campos e devolve estruturado para o front preencher o formulário.
 * O documento final é gerado pelo mesmo código do formulário manual (mesma lib).
 */
router.post("/documento-ia", async (req, res) => {
  const { texto } = req.body || {};
  if (!texto || typeof texto !== "string" || texto.trim().length < 10) {
    return res.status(400).json({ error: "Texto muito curto. Descreva o funcionário, empresa, tipo e motivo." });
  }

  try {
    const { extrairCamposDocumento } = require("../documentoIa");
    const campos = await extrairCamposDocumento(texto.trim());
    if (!campos) {
      return res.status(503).json({
        error: "IA não configurada (OPENAI_API_KEY ou IA_PDF_API_KEY). Preencha manualmente.",
      });
    }

    // Tentar casar com empresa e funcionário no banco
    let company_id = null;
    let employee_id = null;
    let employee_cpf = null;

    if (campos.empresa_nome) {
      const { rows } = await db.query(
        `SELECT id, name, cnpj FROM companies
          WHERE LOWER(name) LIKE $1
            AND arquivada IS NOT TRUE AND excluida IS NOT TRUE
          ORDER BY name LIMIT 5`,
        [`%${campos.empresa_nome.toLowerCase()}%`]
      );
      if (rows.length === 1) {
        company_id = rows[0].id;
        campos.empresa_id = rows[0].id;
        campos.empresa_nome_completo = rows[0].name;
        campos.empresa_cnpj = rows[0].cnpj;
      } else if (rows.length > 1) {
        campos.empresas_candidatas = rows.map((r) => ({ id: r.id, name: r.name, cnpj: r.cnpj }));
      }
    }

    if (company_id && campos.funcionario_nome) {
      const { rows } = await db.query(
        `SELECT id, name, cpf FROM employees
          WHERE company_id = $1
            AND LOWER(name) LIKE $2
            AND active IS TRUE
          LIMIT 5`,
        [company_id, `%${campos.funcionario_nome.toLowerCase()}%`]
      );
      if (rows.length === 1) {
        employee_id = rows[0].id;
        employee_cpf = rows[0].cpf;
        campos.funcionario_id = rows[0].id;
        campos.funcionario_nome_completo = rows[0].name;
        campos.funcionario_cpf = rows[0].cpf;
      } else if (rows.length > 1) {
        campos.funcionarios_candidatos = rows.map((r) => ({ id: r.id, name: r.name, cpf: r.cpf }));
      }
    }

    res.json(campos);
  } catch (err) {
    console.error("[admin] documento-ia:", err.message);
    res.status(500).json({ error: `Erro ao processar com IA: ${err.message}` });
  }
});

/**
 * POST /admin/personificar/:id — admin gera token temporário de empresa para ver o portal
 * como se fosse o cliente. Útil para:
 * - Emitir advertência/suspensão em nome da empresa
 * - Conferir o que o cliente vê
 * - Diagnosticar problemas de visualização
 *
 * NÃO altera nenhum dado da empresa. Gera um JWT normal de empresa com validade curta (1h).
 * O admin pode sair a qualquer momento voltando ao painel.
 */
router.post("/personificar/:id", requireArea("empresas"), async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });

  try {
    const { rows } = await db.query(
      `SELECT id, name, cnpj, tool_access, matriz_id
         FROM companies
        WHERE id = $1 AND arquivada IS NOT TRUE AND excluida IS NOT TRUE`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Empresa não encontrada" });
    const company = rows[0];

    const { generateToken } = require("../middleware/auth");
    const { mergeToolAccess } = require("../companyTools");

    // Validade curta: é acesso privilegiado do admin ao ambiente do cliente.
    const token = generateToken(
      {
        company_id: company.id,
        company_name: company.name,
        company_cnpj: company.cnpj,
        matriz_id: company.matriz_id || null,
        personificado_por: req.admin?.id,
      },
      "1h"
    );

    // Carrega grupo se for matriz
    let empresasGrupo = [];
    if (!company.matriz_id) {
      const { rows: grupo } = await db.query(
        `SELECT id, name, cnpj, matriz_id FROM companies
          WHERE (id = $1 OR matriz_id = $1) AND arquivada IS NOT TRUE AND excluida IS NOT TRUE
          ORDER BY (matriz_id IS NULL) DESC, name`,
        [company.id]
      );
      empresasGrupo = grupo.map((g) => ({
        id: g.id, name: g.name, cnpj: g.cnpj, is_matriz: !g.matriz_id,
      }));
    }

    res.json({
      token,
      company: {
        id: company.id,
        name: company.name,
        cnpj: company.cnpj,
        tool_access: mergeToolAccess(company.tool_access),
      },
      is_matriz: !company.matriz_id,
      empresas_grupo: empresasGrupo,
      personificando: true,
      admin_nome: req.admin?.nome || req.admin?.cpf || "Admin",
    });
  } catch (err) {
    console.error("[admin] personificar:", err.message);
    res.status(500).json({ error: "Erro ao personificar" });
  }
});

module.exports = router;
