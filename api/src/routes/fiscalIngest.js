/**
 * Integração servidor-a-servidor com o sistema de guias (GCLICK).
 *
 * O portal busca os documentos sozinho na API do G-Click (ver src/gclick/sync.js).
 * O sistema de guias não envia mais arquivo nenhum: ele apenas LIBERA os documentos
 * de um cliente — no mesmo clique em que dispara o aviso por WhatsApp.
 *
 * Autenticação de serviço por X-Ingest-Key (quem chama é outro servidor, não um browser).
 */
const router = require("express").Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { PORTAL_ONLY_TOOL_ACCESS } = require("../companyTools");
const { validateString, validateUUID } = require("../middleware/validate");
const { accessSummary } = require("../deliverableAccess");
const sync = require("../gclick/sync");
const { chaveDocumento } = require("../gclick/guides");

/** Comparação em tempo constante — evita descobrir a chave por tempo de resposta. */
function keyMatches(provided, expected) {
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireIngestKey(req, res, next) {
  const expected = process.env.INGEST_API_KEY;
  // Sem chave configurada a rota fica desligada, em vez de aberta.
  if (!expected) {
    return res.status(503).json({ error: "Integração desativada: INGEST_API_KEY não configurada." });
  }
  if (!keyMatches(req.headers["x-ingest-key"], expected)) {
    return res.status(401).json({ error: "Chave de integração inválida" });
  }
  next();
}

function portalUrl(caminho = "") {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${caminho}` : null;
}

/**
 * Libera para o cliente os documentos indicados e devolve quantos ficaram visíveis.
 *
 * Puxa do G-Click antes de liberar (`sincronizar` com o CNPJ), para não depender do
 * agendamento ter rodado: o aviso no WhatsApp nunca sai apontando para um portal vazio.
 *
 * Corpo: { cnpj, itens: [{ tarefa_id, atividade_nome }], competencia? }
 * Sem `itens`, libera tudo o que estiver retido para aquele CNPJ.
 */
router.post("/release", requireIngestKey, async (req, res) => {
  try {
    const cnpj = String(req.body?.cnpj || "").replace(/\D/g, "");
    if (cnpj.length !== 14) return res.status(400).json({ error: "CNPJ inválido" });

    const itens = Array.isArray(req.body?.itens) ? req.body.itens : null;
    if (itens && itens.length > 500) {
      return res.status(400).json({ error: "máximo de 500 itens por chamada" });
    }

    // Traz o que houver de novo dessa empresa antes de liberar (evita corrida).
    let sincronizou = null;
    if (req.body?.sync !== false) {
      sincronizou = await sync.sincronizar({ cnpj, meses: Number(req.body?.meses || 2) });
    }

    const { rows: empresa } = await db.query("SELECT id, name FROM companies WHERE cnpj = $1", [cnpj]);
    if (!empresa.length) {
      return res.status(404).json({
        error: `Nenhuma empresa no portal com o CNPJ ${cnpj}.`,
        sincronizou,
      });
    }
    const companyId = empresa[0].id;

    let result;
    if (itens && itens.length) {
      const chaves = itens
        .map((i) => chaveDocumento(i?.tarefa_id, i?.atividade_nome))
        .filter((c) => c && !c.startsWith("undefined"));
      if (!chaves.length) return res.status(400).json({ error: "itens sem tarefa_id/atividade_nome" });
      result = await db.query(
        `UPDATE deliverables SET released_at = now()
         WHERE company_id = $1 AND released_at IS NULL AND external_ref = ANY($2)
         RETURNING id, title, doc_type, competencia`,
        [companyId, chaves]
      );
    } else {
      result = await db.query(
        `UPDATE deliverables SET released_at = now()
         WHERE company_id = $1 AND released_at IS NULL
         RETURNING id, title, doc_type, competencia`,
        [companyId]
      );
    }

    const { rows: totais } = await db.query(
      `SELECT count(*) FILTER (WHERE released_at IS NOT NULL) AS liberados,
              count(*) FILTER (WHERE released_at IS NULL)     AS retidos
       FROM deliverables WHERE company_id = $1`,
      [companyId]
    );

    res.json({
      liberados_agora: result.rows.length,
      documentos: result.rows,
      total_liberados: Number(totais[0].liberados),
      total_retidos: Number(totais[0].retidos),
      empresa: empresa[0].name,
      portal_url: portalUrl("/"),
      sincronizou,
    });
  } catch (err) {
    console.error("[release]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Dispara a sincronização com o G-Click (o sistema de guias ou o admin pode chamar). */
router.post("/sync", requireIngestKey, async (req, res) => {
  try {
    if (sync.estaRodando()) {
      return res.status(409).json({ error: "Já existe uma sincronização em andamento" });
    }
    const meses = Number(req.body?.meses || process.env.GCLICK_SYNC_MESES || 6);
    // Roda em segundo plano: a carga inicial pode levar minutos.
    if (req.body?.aguardar === false) {
      sync.sincronizar({ meses }).catch((e) => console.error("[sync]", e.message));
      return res.status(202).json({ message: "Sincronização iniciada em segundo plano." });
    }
    const out = await sync.sincronizar({ meses });
    res.status(out.ok ? 200 : 400).json(out);
  } catch (err) {
    console.error("[sync]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/sync/status", requireIngestKey, (_req, res) => {
  res.json({ rodando: sync.estaRodando(), ultima: sync.ultimaExecucao() });
});

/**
 * Cria no portal as empresas que faltam, a partir da lista de clientes do sistema de
 * guias. NUNCA sobrescreve empresa existente — razão social, e-mail e permissões
 * ajustados no painel do portal mandam.
 */
router.post("/sync-companies", requireIngestKey, async (req, res) => {
  try {
    const lista = req.body?.companies;
    if (!Array.isArray(lista)) {
      return res.status(400).json({ error: "companies deve ser uma lista" });
    }
    if (lista.length > 1000) {
      return res.status(400).json({ error: "máximo de 1000 empresas por chamada" });
    }

    const criadas = [];
    const existentes = [];
    const erros = [];

    for (const item of lista) {
      const cnpj = String(item?.cnpj || "").replace(/\D/g, "");
      const nome = String(item?.name || "").trim();
      try {
        if (cnpj.length !== 14) {
          erros.push({ cnpj: item?.cnpj ?? null, motivo: "CNPJ inválido" });
          continue;
        }
        if (!validateString(nome, 1, 200)) {
          erros.push({ cnpj, motivo: "Razão social vazia" });
          continue;
        }

        const achou = await db.query("SELECT id, name FROM companies WHERE cnpj = $1", [cnpj]);
        if (achou.rows.length) {
          existentes.push({ cnpj, name: achou.rows[0].name });
          continue;
        }

        const email = item?.email ? String(item.email).trim().toLowerCase() : null;
        const phone = item?.phone ? String(item.phone).replace(/\D/g, "") : null;
        // Senha inicial = CNPJ (público), por isso nasce exigindo troca no 1º acesso.
        const { rows } = await db.query(
          `INSERT INTO companies
             (name, cnpj, password_hash, contact_email, phone, tool_access, must_change_password)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,true)
           ON CONFLICT (cnpj) DO NOTHING
           RETURNING id, name, cnpj`,
          [nome, cnpj, await bcrypt.hash(cnpj, 10), email, phone || null,
           JSON.stringify(PORTAL_ONLY_TOOL_ACCESS)]
        );
        if (rows.length) criadas.push(rows[0]);
        else existentes.push({ cnpj, name: nome });
      } catch (e) {
        console.error("[sync-companies]", cnpj, e.message);
        erros.push({ cnpj, motivo: "Falha ao criar" });
      }
    }

    res.json({
      criadas: criadas.length,
      existentes: existentes.length,
      erros: erros.length,
      detalhe: { criadas, existentes, erros },
    });
  } catch (err) {
    console.error("[sync-companies]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Aberturas/downloads de várias entregas numa chamada — o sistema de guias usa isto
 * para manter a tela de auditoria dele como painel único, sem duplicar o rastreio.
 */
router.post("/access-stats", requireIngestKey, async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids deve ser uma lista" });
    if (ids.length > 500) return res.status(400).json({ error: "máximo de 500 ids por chamada" });
    const valid = ids.filter((id) => validateUUID(id));
    res.json(await accessSummary(valid));
  } catch (err) {
    console.error("[access-stats]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
