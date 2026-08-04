const router = require("express").Router();
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID, validateEmailFormat, validateString, validateCNPJ } = require("../middleware/validate");
const { mergeToolAccess } = require("../companyTools");
const { listCompanies, insertCompanyRow, PG_UNDEFINED_COLUMN } = require("../toolAccessDb");
const { importEmployeesForCompany } = require("../employeeImport");
const { parseExtratoEmployees } = require("../extratoEmployees");
const { resolveUploadPath, uploadPdf, removeUploadFile } = require("../uploads");
const { LGPD_CONSENT_VERSION } = require("../lgpd");
const sync = require("../gclick/sync");
const clientSync = require("../gclick/clientSync");
const extratoAuto = require("../extratoAuto");
const { parseVacationPdf } = require("../vacationParser");
const {
  conferirEmpresa,
  salvarProgramacao,
  ultimaProgramacao,
} = require("../vacationImport");
const { setSetting } = require("../appSettings");
const gclickClient = require("../gclick/client");
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
      db.query("SELECT COUNT(*)::int AS n FROM companies"),
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

/** Senha inicial = CNPJ só dígitos (igual aos seeds). */
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
    const passwordHash = await bcrypt.hash(cnpjDigits, 10);
    const created = await insertCompanyRow(db, {
      name: name.trim(),
      cnpjDigits,
      passwordHash,
      emailNorm,
      phoneNorm,
    });
    res.status(201).json({
      company: { ...created, tool_access: mergeToolAccess(created.tool_access) },
      message: "Empresa criada. Login: CNPJ com ou sem máscara. Senha inicial: só os 14 dígitos do CNPJ.",
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

module.exports = router;
