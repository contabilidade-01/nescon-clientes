/**
 * Painel do escritório — cobrança de pendências do e-CAC (área `alertas`).
 *
 * Aqui o escritório: liga a importação e o envio (nascem desligados), sai do modo teste,
 * importa agora, vê cada cobrança e o que saiu, pausa uma empresa (em negociação,
 * parcelando, cadastro errado) e reenvia uma etapa. Tudo o que muda estado passa pelo
 * motor (`ecacCobranca.js`), nunca por UPDATE direto aqui.
 */
const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID } = require("../middleware/validate");
const ecac = require("../ecacClient");
const { lerConfig, salvarConfig } = require("../ecacConfig");
const cobranca = require("../ecacCobranca");
const envio = require("../ecacEnvio");
const regras = require("../ecacRegras");

router.use(authMiddleware);
router.use(requireArea("alertas"));

function quem(req) {
  return `admin:${req.admin?.cpf || req.admin?.id || ""}`;
}

router.get("/config", async (_req, res) => {
  try {
    const cfg = await lerConfig(db);
    let ping = null;
    if (ecac.configurado()) {
      try {
        ping = await ecac.ping();
      } catch (err) {
        ping = { erro: err.message };
      }
    }
    res.json({ ...cfg, integracao_configurada: ecac.configurado(), central_ecac: ping, estados: regras.ROTULO_ESTADO });
  } catch (err) {
    console.error("[ecac-admin] config:", err.message);
    res.status(500).json({ error: "Erro ao ler a configuração" });
  }
});

router.put("/config", async (req, res) => {
  try {
    const cfg = await salvarConfig(db, req.body || {});
    await cobranca.evento(db, null, null, "config", { por: quem(req), ...req.body });
    res.json(cfg);
  } catch (err) {
    console.error("[ecac-admin] salvar config:", err.message);
    res.status(500).json({ error: "Erro ao salvar" });
  }
});

/** Importa agora (ignora `importacao_ativa`; respeita tudo o mais). */
router.post("/importar", async (req, res) => {
  try {
    const r = await cobranca.importarEAbrir(db, { manual: true, quem: quem(req), ciclo: req.body?.ciclo || null });
    res.json(r);
  } catch (err) {
    if (err instanceof ecac.EcacNaoConfigurado) return res.status(503).json({ error: err.message });
    if (err instanceof ecac.EcacIndisponivel) return res.status(502).json({ error: err.message });
    console.error("[ecac-admin] importar:", err.message);
    res.status(500).json({ error: "Falha na importação: " + err.message });
  }
});

/** Roda um passo da máquina de estados agora. */
router.post("/processar", async (_req, res) => {
  try {
    const r = await cobranca.processarCobrancas(db, {});
    const d = await envio.drenarPendentes(db);
    res.json({ ...r, fila: d });
  } catch (err) {
    console.error("[ecac-admin] processar:", err.message);
    res.status(500).json({ error: "Falha ao processar: " + err.message });
  }
});

router.get("/cobrancas", async (req, res) => {
  const params = [];
  const filtros = [];
  if (req.query.ciclo) {
    params.push(String(req.query.ciclo).slice(0, 7));
    filtros.push(`cb.ciclo = $${params.length}`);
  }
  if (req.query.estado) {
    params.push(String(req.query.estado).slice(0, 30));
    filtros.push(`cb.estado = $${params.length}`);
  }
  if (req.query.abertas === "1") filtros.push(`cb.encerrado_em IS NULL`);
  try {
    const { rows } = await db.query(
      `SELECT cb.id, cb.ciclo, cb.estado, cb.estado_desde, cb.proxima_acao, cb.proxima_acao_em,
              cb.regeracoes, cb.emails, cb.whatsapps, cb.iniciado_em, cb.atualizado_em,
              cb.encerrado_em, cb.encerrado_motivo, cb.relatorio_id,
              c.id AS company_id, c.name, c.cnpj, c.contact_email, c.ecac_cobranca_ativa, c.ecac_pausado_motivo,
              c.alertas_ativos,
              p.qtd_atraso, p.total_atraso, p.relatorio_data,
              (SELECT count(*) FROM ecac_guias g WHERE g.cobranca_id = cb.id) AS guias,
              (SELECT max(n.clicado_em) FROM ecac_notificacoes n WHERE n.cobranca_id = cb.id) AS ultimo_clique,
              (SELECT max(n.aberto_em) FROM ecac_notificacoes n WHERE n.cobranca_id = cb.id) AS ultima_abertura,
              (SELECT count(*) FROM ecac_notificacoes n WHERE n.cobranca_id = cb.id AND n.status = 'falhou') AS falhas
         FROM ecac_cobrancas cb
         JOIN companies c ON c.id = cb.company_id
         JOIN ecac_pendencias p ON p.id = cb.pendencia_id
        ${filtros.length ? `WHERE ${filtros.join(" AND ")}` : ""}
        ORDER BY cb.encerrado_em IS NOT NULL, cb.proxima_acao_em NULLS LAST, c.name
        LIMIT 500`,
      params
    );
    res.json(rows.map((r) => ({ ...r, rotulo: regras.ROTULO_ESTADO[r.estado] || r.estado })));
  } catch (err) {
    console.error("[ecac-admin] cobranças:", err.message);
    res.status(500).json({ error: "Erro ao listar" });
  }
});

router.get("/cobrancas/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "id inválido" });
  try {
    const { rows: cbs } = await db.query(
      `SELECT cb.*, c.name, c.cnpj, c.contact_email, c.ecac_cobranca_ativa, c.ecac_pausado_motivo,
              p.debitos, p.omissoes, p.parcelamento, p.pgfn, p.relatorio_data, p.qtd_invalidos
         FROM ecac_cobrancas cb
         JOIN companies c ON c.id = cb.company_id
         JOIN ecac_pendencias p ON p.id = cb.pendencia_id
        WHERE cb.id = $1`,
      [id]
    );
    if (!cbs.length) return res.status(404).json({ error: "Cobrança não encontrada" });
    const cb = cbs[0];
    const { rows: notificacoes } = await db.query(
      `SELECT id, etapa, canal, destino, status, erro, status_entrega, status_entrega_em, aberto_em, clicado_em,
              tentativas, assunto, texto, modo_teste, criado_em, enviado_em
         FROM ecac_notificacoes WHERE cobranca_id = $1 ORDER BY criado_em`,
      [id]
    );
    const { rows: guias } = await db.query(`SELECT * FROM ecac_guias WHERE cobranca_id = $1 ORDER BY criado_em DESC`, [id]);
    const { rows: eventos } = await db.query(`SELECT * FROM ecac_eventos WHERE cobranca_id = $1 ORDER BY criado_em DESC LIMIT 100`, [id]);
    res.json({
      ...cb,
      rotulo: regras.ROTULO_ESTADO[cb.estado] || cb.estado,
      em_atraso: regras.debitosCobraveis(cb.debitos || []),
      invalidos: (cb.debitos || []).filter((d) => d && !d.valido),
      notificacoes,
      guias,
      eventos,
    });
  } catch (err) {
    console.error("[ecac-admin] cobrança:", err.message);
    res.status(500).json({ error: "Erro ao carregar" });
  }
});

router.post("/empresas/:companyId/pausar", async (req, res) => {
  const { companyId } = req.params;
  if (!validateUUID(companyId)) return res.status(400).json({ error: "company_id inválido" });
  await cobranca.pausar(db, companyId, req.body?.motivo || "", quem(req));
  res.json({ ok: true });
});

router.post("/empresas/:companyId/retomar", async (req, res) => {
  const { companyId } = req.params;
  if (!validateUUID(companyId)) return res.status(400).json({ error: "company_id inválido" });
  await cobranca.retomar(db, companyId, quem(req));
  res.json({ ok: true });
});

/** Reenvia uma etapa (apaga o registro anterior daquela etapa×canal e manda de novo). */
router.post("/cobrancas/:id/reenviar", async (req, res) => {
  const id = Number(req.params.id);
  const etapa = String(req.body?.etapa || "");
  const canal = String(req.body?.canal || "");
  if (!Number.isInteger(id) || !["notificado", "lembrete", "cobranca_1", "cobranca_2", "quitado"].includes(etapa) || !["email", "whatsapp"].includes(canal)) {
    return res.status(400).json({ error: "Informe etapa e canal válidos" });
  }
  try {
    const cfg = await lerConfig(db);
    const { rows } = await db.query(`SELECT cb.*, p.id AS pid FROM ecac_cobrancas cb JOIN ecac_pendencias p ON p.id = cb.pendencia_id WHERE cb.id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Cobrança não encontrada" });
    const cb = rows[0];
    const empresa = await envio.carregarEmpresa(db, cb.company_id);
    const { rows: ps } = await db.query(`SELECT * FROM ecac_pendencias WHERE id = $1`, [cb.pendencia_id]);
    await db.query(`DELETE FROM ecac_notificacoes WHERE cobranca_id = $1 AND etapa = $2 AND canal = $3`, [id, etapa, canal]);
    const resultados = await envio.registrarEEnviar({ db, cobranca: cb, empresa, pendencia: ps[0], etapa, canais: [canal], cfg });
    await cobranca.evento(db, cb.company_id, cb.id, "reenvio", { etapa, canal, por: quem(req), resultados });
    res.json({ ok: true, resultados });
  } catch (err) {
    console.error("[ecac-admin] reenviar:", err.message);
    res.status(500).json({ error: "Falha ao reenviar: " + err.message });
  }
});

/** Prévia do texto de uma etapa para uma cobrança (sem enviar). */
router.get("/cobrancas/:id/previa", async (req, res) => {
  const id = Number(req.params.id);
  const etapa = String(req.query.etapa || "notificado");
  try {
    const cfg = await lerConfig(db);
    const { rows } = await db.query(
      `SELECT cb.id, c.name, p.debitos, p.relatorio_data, p.parcelamento, p.pgfn
         FROM ecac_cobrancas cb JOIN companies c ON c.id = cb.company_id JOIN ecac_pendencias p ON p.id = cb.pendencia_id
        WHERE cb.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Cobrança não encontrada" });
    const r = rows[0];
    const m = regras.montarMensagem({
      etapa,
      empresa: { name: r.name },
      debitos: regras.debitosCobraveis(r.debitos || []),
      relatorio_data: r.relatorio_data,
      parcelamento: r.parcelamento,
      pgfn: r.pgfn,
      link: envio.linkRastreado("exemplo"),
      escritorio: { nome: cfg.escritorio_nome, whatsapp: cfg.escritorio_whatsapp, email: cfg.escritorio_email },
    });
    res.json(m);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
