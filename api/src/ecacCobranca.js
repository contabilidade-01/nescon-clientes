/**
 * Cobrança de pendências do e-CAC — o motor (banco + relógio) da máquina de estados
 * definida em `ecacRegras.js`.
 *
 * O que roda sozinho (agendador, a cada 30 min):
 *   1. importação mensal do espelho (no dia configurado, uma vez por ciclo) e abertura
 *      das cobranças de quem tem débito em atraso em relatório DO CICLO;
 *   2. fila de mensagens pendentes (fora da janela / falha transitória);
 *   3. um passo da máquina de estados para cada cobrança aberta.
 *
 * Tudo com trava dupla: `importacao_ativa` para buscar, `envio_ativo` para mandar. Os
 * dois nascem desligados; `modo_teste` nasce ligado (mensagens vão para o escritório).
 */
const ecac = require("./ecacClient");
const pend = require("./ecacPendencias");
const envio = require("./ecacEnvio");
const { lerConfig, registrarImportacao } = require("./ecacConfig");
const regras = require("./ecacRegras");
const { hojeSP } = require("./diasBancarios");

function cicloDe(iso) {
  return String(iso).slice(0, 7);
}

/** 'AAAA-MM-DD' do dia 1 do ciclo: relatório anterior a isso é do mês passado. */
function inicioDoCiclo(ciclo) {
  return `${ciclo}-01`;
}

async function evento(db, companyId, cobrancaId, tipo, dados) {
  try {
    await db.query(
      `INSERT INTO ecac_eventos (company_id, cobranca_id, tipo, dados) VALUES ($1, $2, $3, $4::jsonb)`,
      [companyId, cobrancaId, tipo, JSON.stringify(dados || {})]
    );
  } catch (err) {
    console.error("[ecac] evento:", err.message);
  }
}

// ------------------------------------------------------------------ importação

/**
 * Importa a carteira e abre as cobranças do ciclo. `manual` ignora `importacao_ativa`.
 * Idempotente: rodar duas vezes no mesmo ciclo não abre cobrança duplicada
 * (UNIQUE company_id × ciclo) nem reenvia (UNIQUE cobrança × etapa × canal).
 */
async function importarEAbrir(db, { ciclo = null, desde = null, manual = false, quem = "agendador" } = {}) {
  const cfg = await lerConfig(db);
  if (!ecac.configurado()) throw new ecac.EcacNaoConfigurado("ECAC_API_URL/ECAC_INTEGRACAO_TOKEN não configurados.");
  if (!manual && !cfg.importacao_ativa) return { pulado: true, motivo: "importação desligada" };

  const hoje = hojeSP();
  const cicloAlvo = ciclo || cicloDe(hoje);
  const desdeAlvo = desde || inicioDoCiclo(cicloAlvo);

  const resumo = await pend.importarCarteira(db, { desde: desdeAlvo });
  let abertas = 0;
  let encerradas = 0;

  for (const e of resumo.empresas) {
    if (!regras.deveAbrirCobranca(e.espelho)) continue;

    // ciclo anterior ainda aberto → encerra (o novo aviso traz os dados atuais)
    const { rowCount } = await db.query(
      `UPDATE ecac_cobrancas
          SET estado = 'encerrado', encerrado_em = now(), encerrado_motivo = 'novo ciclo', atualizado_em = now()
        WHERE company_id = $1 AND ciclo <> $2 AND encerrado_em IS NULL`,
      [e.companyId, cicloAlvo]
    );
    encerradas += rowCount;

    const { rows } = await db.query(
      `INSERT INTO ecac_cobrancas (company_id, pendencia_id, relatorio_id, ciclo, estado, proxima_acao, proxima_acao_em)
       VALUES ($1, $2, $3, $4, 'aberta', 'notificar', CURRENT_DATE)
       ON CONFLICT (company_id, ciclo) DO NOTHING
       RETURNING id`,
      [e.companyId, e.pendenciaId, e.espelho.relatorio_id, cicloAlvo]
    );
    if (rows.length) {
      abertas += 1;
      await evento(db, e.companyId, rows[0].id, "cobranca_aberta", {
        ciclo: cicloAlvo, relatorio_id: e.espelho.relatorio_id, qtd_atraso: e.espelho.qtd_atraso, total_atraso: e.espelho.total_atraso,
      });
    }
  }

  const saida = {
    ciclo: cicloAlvo, quem, abertas, encerradas,
    total_ecac: resumo.total_ecac, casadas: resumo.casadas, novas: resumo.novas, com_atraso: resumo.com_atraso,
    sem_cadastro: resumo.sem_cadastro, sem_relatorio: resumo.sem_relatorio,
    relatorios_velhos: resumo.relatorios_velhos, inativas_no_ecac: resumo.inativas_no_ecac, erros: resumo.erros,
    em: new Date().toISOString(),
  };
  await registrarImportacao(db, cicloAlvo, saida);
  await evento(db, null, null, "importacao", { ...saida, empresas: undefined });
  console.log(`[ecac] importação ${cicloAlvo} (${quem}): ${resumo.casadas} casadas, ${abertas} cobrança(s) aberta(s), ${resumo.sem_cadastro.length} sem cadastro.`);
  return saida;
}

// -------------------------------------------------------------- máquina de estados

async function cobrancasAbertas(db) {
  const { rows } = await db.query(
    `SELECT cb.*, to_char(cb.estado_desde, 'YYYY-MM-DD') AS estado_desde_iso,
            to_char(cb.regeracao_pedida_em, 'YYYY-MM-DD') AS regeracao_pedida_iso,
            to_char(cb.proxima_acao_em, 'YYYY-MM-DD') AS proxima_acao_iso
       FROM ecac_cobrancas cb
      WHERE cb.encerrado_em IS NULL AND cb.estado NOT IN ('quitado', 'escalado', 'encerrado')
      ORDER BY cb.id`
  );
  return rows;
}

async function pendenciaPorId(db, id) {
  const { rows } = await db.query(`SELECT * FROM ecac_pendencias WHERE id = $1`, [id]);
  return rows[0] || null;
}

/** O cliente gerou guia DEPOIS de `desdeIso` (data do estado atual)? */
async function recalculouDesde(db, companyId, desdeIso) {
  const { rows } = await db.query(
    `SELECT 1 FROM ecac_guias WHERE company_id = $1 AND criado_em >= ($2::date) LIMIT 1`,
    [companyId, desdeIso]
  );
  return rows.length > 0;
}

async function mudarEstado(db, cobranca, novoEstado, extras = {}) {
  const sets = ["estado = $2", "estado_desde = CURRENT_DATE", "atualizado_em = now()"];
  const params = [cobranca.id, novoEstado];
  let i = 3;
  for (const [col, val] of Object.entries(extras)) {
    sets.push(`${col} = $${i}`);
    params.push(val);
    i += 1;
  }
  if (regras.ESTADOS_TERMINAIS.has(novoEstado)) {
    sets.push("encerrado_em = now()");
  }
  await db.query(`UPDATE ecac_cobrancas SET ${sets.join(", ")} WHERE id = $1`, params);
  await evento(db, cobranca.company_id, cobranca.id, "estado", { de: cobranca.estado, para: novoEstado, ...extras });
}

/** Um passo para UMA cobrança. Devolve o que fez (para o painel/log). */
async function passo(db, cobranca, cfg, hoje) {
  const empresa = await envio.carregarEmpresa(db, cobranca.company_id);
  const bloqueio = envio.motivoBloqueio(empresa);
  const pendenciaAtual = await pend.ultimaPendencia(db, cobranca.company_id);
  const recalculou = await recalculouDesde(db, cobranca.company_id, cobranca.estado_desde_iso);

  const decisao = regras.decidir({
    cobranca: {
      estado: cobranca.estado,
      estado_desde: cobranca.estado_desde_iso,
      relatorio_id: cobranca.relatorio_id,
      regeracoes: cobranca.regeracoes,
      emails: cobranca.emails,
      whatsapps: cobranca.whatsapps,
      regeracao_pedida_em: cobranca.regeracao_pedida_iso,
      proxima_acao_em: cobranca.proxima_acao_iso,
    },
    pendenciaAtual: pendenciaAtual ? { relatorio_id: pendenciaAtual.relatorio_id, qtd_atraso: pendenciaAtual.qtd_atraso } : null,
    recalculou,
    hoje,
    cfg,
  });

  const registrarProxima = (acao, quando) =>
    db.query(`UPDATE ecac_cobrancas SET proxima_acao = $2, proxima_acao_em = $3, atualizado_em = now() WHERE id = $1`, [
      cobranca.id, acao, quando || null,
    ]);

  switch (decisao.acao) {
    case "nada":
      return { id: cobranca.id, acao: "nada" };

    case "aguardar":
      await registrarProxima(cobranca.estado, decisao.proxima_acao_em);
      return { id: cobranca.id, acao: "aguardar", motivo: decisao.motivo };

    case "adotar_relatorio": {
      await db.query(
        `UPDATE ecac_cobrancas SET pendencia_id = $2, relatorio_id = $3, atualizado_em = now() WHERE id = $1`,
        [cobranca.id, pendenciaAtual.id, pendenciaAtual.relatorio_id]
      );
      return { id: cobranca.id, acao: "adotar_relatorio" };
    }

    case "consultar": {
      // relatório regerado ainda não chegou: busca só esta empresa (custo zero lá)
      try {
        const r = await pend.importarEmpresa(db, cobranca.company_id, empresa.cnpj);
        await registrarProxima("consultar", decisao.proxima_acao_em);
        return { id: cobranca.id, acao: "consultar", novo: Boolean(r && r.novo) };
      } catch (err) {
        await registrarProxima("consultar", decisao.proxima_acao_em);
        return { id: cobranca.id, acao: "consultar", erro: err.message };
      }
    }

    case "agendar_regeracao": {
      if (bloqueio) {
        await registrarProxima(cobranca.estado, regras.somarDiasUteis(hoje, 1));
        return { id: cobranca.id, acao: "aguardar", motivo: bloqueio };
      }
      try {
        const r = await ecac.reprocessar({ cnpj: empresa.cnpj, diasUteis: decisao.dias_uteis, motivo: "recalculo_guia" });
        await mudarEstado(db, cobranca, "aguardando_regeracao", {
          regeracoes: Number(cobranca.regeracoes || 0) + 1,
          regeracao_pedida_em: hoje,
          ultimo_recalculo_em: new Date(),
          proxima_acao: "consultar",
          proxima_acao_em: decisao.proxima_acao_em,
        });
        await evento(db, cobranca.company_id, cobranca.id, "regeracao_pedida", { resposta: r && r.item ? r.item : r });
        return { id: cobranca.id, acao: "agendar_regeracao", ok: true };
      } catch (err) {
        // recusa de negócio (limite mensal lá) → não fica preso: segue o ritmo de lembrete
        if (err instanceof ecac.EcacRecusou) {
          await mudarEstado(db, cobranca, cobranca.estado === "aberta" ? "notificado" : cobranca.estado, {
            ultimo_recalculo_em: new Date(), regeracoes: Number(cfg.max_regeracoes),
          });
          await evento(db, cobranca.company_id, cobranca.id, "erro", { onde: "reprocessar", erro: err.message });
          return { id: cobranca.id, acao: "agendar_regeracao", ok: false, motivo: err.message };
        }
        await registrarProxima(cobranca.estado, regras.somarDiasUteis(hoje, 1));
        return { id: cobranca.id, acao: "agendar_regeracao", ok: false, motivo: err.message };
      }
    }

    case "escalar": {
      await mudarEstado(db, cobranca, "escalado", { encerrado_motivo: decisao.motivo });
      const pendencia = await pendenciaPorId(db, cobranca.pendencia_id);
      const debitos = regras.debitosCobraveis(pendencia?.debitos || []);
      const texto = [
        `Cobrança do e-CAC sem retorno: ${empresa?.name || cobranca.company_id}`,
        `Total em atraso: ${regras.brl(regras.totalCobravel(debitos))} (${debitos.length} guia(s)).`,
        ...debitos.slice(0, 6).map((d) => `- ${regras.rotuloTipo(d)} ${d.periodo_apuracao} venc. ${regras.dataBR(d.data_vencimento)} ${regras.brl(d.saldo_devedor_total)}`),
        "Foram enviados aviso, lembrete e duas cobranças. Precisa de contato humano.",
      ].join("\n");
      const canais = await envio.avisarEscritorio(db, cfg, { assunto: `[e-CAC] Escalada: ${empresa?.name || ""}`, texto });
      await evento(db, cobranca.company_id, cobranca.id, "escalado", { canais });
      return { id: cobranca.id, acao: "escalar", canais };
    }

    case "enviar": {
      const etapa = decisao.etapa;
      const canais = decisao.canais || [];
      const pendencia = await pendenciaPorId(db, cobranca.pendencia_id);

      // Relatório novo com o débito: a cobrança passa a apontar para ele (é ele que
      // aparece na mensagem e no portal).
      const extras = {};
      if (pendenciaAtual && Number(pendenciaAtual.relatorio_id) > Number(cobranca.relatorio_id)) {
        extras.pendencia_id = pendenciaAtual.id;
        extras.relatorio_id = pendenciaAtual.relatorio_id;
      }
      const pendenciaParaTexto = extras.pendencia_id ? pendenciaAtual : pendencia;

      if (!cfg.envio_ativo) {
        // envio desligado: registra a decisão e não manda nada. Estado só avança quando
        // o desfecho não depende de mensagem (quitado): a cobrança fecha sem agradecer.
        if (decisao.estado === "quitado") {
          await mudarEstado(db, cobranca, "quitado", { ...extras, encerrado_motivo: `${decisao.motivo} (envio desligado)` });
          return { id: cobranca.id, acao: "encerrar", etapa, pulado: "envio desligado" };
        }
        await registrarProxima(`${etapa} (envio desligado)`, regras.somarDiasUteis(hoje, 1));
        return { id: cobranca.id, acao: "enviar", etapa, pulado: "envio desligado" };
      }
      if (bloqueio && !cfg.modo_teste) {
        await registrarProxima(`${etapa} (pausada)`, regras.somarDiasUteis(hoje, 1));
        return { id: cobranca.id, acao: "enviar", etapa, pulado: bloqueio };
      }

      const resultados = canais.length
        ? await envio.registrarEEnviar({ db, cobranca, empresa, pendencia: pendenciaParaTexto, etapa, canais, cfg })
        : [];
      const emails = resultados.filter((r) => r.canal === "email" && r.status !== "ignorado" && r.status !== "duplicado").length;
      const whatsapps = resultados.filter((r) => r.canal === "whatsapp" && r.status !== "ignorado" && r.status !== "duplicado").length;
      await mudarEstado(db, cobranca, decisao.estado, {
        ...extras,
        emails: Number(cobranca.emails || 0) + emails,
        whatsapps: Number(cobranca.whatsapps || 0) + whatsapps,
        proxima_acao: decisao.estado,
        proxima_acao_em: regras.somarDiasUteis(hoje, decisao.estado === "quitado" ? 0 : cfg.dias_lembrete),
        ...(decisao.estado === "quitado" ? { encerrado_motivo: decisao.motivo } : {}),
      });
      await evento(db, cobranca.company_id, cobranca.id, "mensagem", { etapa, resultados });
      return { id: cobranca.id, acao: "enviar", etapa, resultados };
    }

    default:
      return { id: cobranca.id, acao: decisao.acao };
  }
}

/** Um passo para todas as cobranças abertas. */
async function processarCobrancas(db, { hoje = null } = {}) {
  const cfg = await lerConfig(db);
  const dia = hoje || hojeSP();
  const abertas = await cobrancasAbertas(db);
  const feitos = [];
  for (const cb of abertas) {
    try {
      feitos.push(await passo(db, cb, cfg, dia));
    } catch (err) {
      console.error(`[ecac] cobrança ${cb.id}:`, err.message);
      await evento(db, cb.company_id, cb.id, "erro", { onde: "passo", erro: err.message });
      feitos.push({ id: cb.id, acao: "erro", motivo: err.message });
    }
  }
  return { total: abertas.length, feitos };
}

// ------------------------------------------------------------------- eventos externos

/** Guia gerada pelo portal (cliente ou escritório): grava e liga à cobrança aberta. */
async function registrarGuiaGerada(db, { companyId, emissao, reuso, solicitadoPor }) {
  const { rows: cbs } = await db.query(
    `SELECT id FROM ecac_cobrancas WHERE company_id = $1 AND encerrado_em IS NULL ORDER BY id DESC LIMIT 1`,
    [companyId]
  );
  const cobrancaId = cbs[0]?.id || null;
  const { rows } = await db.query(
    `INSERT INTO ecac_guias
       (company_id, cobranca_id, emissao_id, tipo, periodo_apuracao, data_consolidacao, numero_documento,
        vencimento, valor_total, reuso, solicitado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      companyId, cobrancaId, emissao.id, emissao.tipo, emissao.periodo_apuracao, emissao.data_consolidacao || null,
      emissao.numero_documento || null, emissao.vencimento || null, emissao.valor_total ?? null, Boolean(reuso), solicitadoPor || null,
    ]
  );
  await evento(db, companyId, cobrancaId, "guia_gerada", {
    emissao_id: emissao.id, tipo: emissao.tipo, periodo_apuracao: emissao.periodo_apuracao, reuso: Boolean(reuso), solicitado_por: solicitadoPor,
  });
  return rows[0];
}

async function registrarClique(db, token) {
  const { rows } = await db.query(
    `UPDATE ecac_notificacoes SET clicado_em = COALESCE(clicado_em, now()) WHERE token = $1
     RETURNING company_id, cobranca_id, etapa, canal`,
    [token]
  );
  if (rows.length) await evento(db, rows[0].company_id, rows[0].cobranca_id, "link_clicado", { etapa: rows[0].etapa, canal: rows[0].canal });
  return rows.length > 0;
}

async function registrarAbertura(db, token) {
  const { rows } = await db.query(
    `UPDATE ecac_notificacoes SET aberto_em = COALESCE(aberto_em, now()) WHERE token = $1 AND aberto_em IS NULL
     RETURNING company_id, cobranca_id, etapa`,
    [token]
  );
  if (rows.length) await evento(db, rows[0].company_id, rows[0].cobranca_id, "email_aberto", { etapa: rows[0].etapa, sinal: "pixel (fraco)" });
  return rows.length > 0;
}

/** Status de entrega vindo do webhook da uazapi (enviado → entregue → lido). */
async function registrarStatusMensagem(db, { mensagemId, status }) {
  if (!mensagemId || !status) return false;
  const ordem = { enviado: 1, entregue: 2, lido: 3 };
  const novo = String(status).toLowerCase();
  if (!ordem[novo]) return false;
  const { rowCount } = await db.query(
    `UPDATE ecac_notificacoes
        SET status_entrega = $2, status_entrega_em = now()
      WHERE mensagem_id = $1
        AND COALESCE((CASE status_entrega WHEN 'enviado' THEN 1 WHEN 'entregue' THEN 2 WHEN 'lido' THEN 3 END), 0) < $3`,
    [String(mensagemId).slice(0, 120), novo, ordem[novo]]
  );
  return rowCount > 0;
}

async function pausar(db, companyId, motivo, quem) {
  await db.query(
    `UPDATE companies SET ecac_cobranca_ativa = false, ecac_pausado_motivo = $2, ecac_pausado_em = now() WHERE id = $1`,
    [companyId, String(motivo || "").slice(0, 300) || null]
  );
  await evento(db, companyId, null, "pausada", { motivo, quem });
}

async function retomar(db, companyId, quem) {
  await db.query(
    `UPDATE companies SET ecac_cobranca_ativa = true, ecac_pausado_motivo = NULL, ecac_pausado_em = NULL WHERE id = $1`,
    [companyId]
  );
  await evento(db, companyId, null, "retomada", { quem });
}

// -------------------------------------------------------------------- agendador

let importacaoEmAndamento = false;

function iniciarAgendadorEcac(db) {
  console.log("[ecac] agendador de pé; importação e envio ligam/desligam na tela (Impostos e-CAC).");
  const tique = async () => {
    try {
      const cfg = await lerConfig(db);
      if (!ecac.configurado()) return;

      // 1) importação mensal: a partir do dia configurado, uma vez por ciclo, em dia útil
      //    e dentro da janela (o lote de lá roda de madrugada no dia 25; aqui vem depois)
      const hoje = hojeSP();
      const ciclo = cicloDe(hoje);
      const diaDoMes = Number(hoje.slice(8, 10));
      if (cfg.importacao_ativa && !importacaoEmAndamento && cfg.ultimo_ciclo_importado !== ciclo && diaDoMes >= cfg.dia_importacao && envio.podeEnviarAgora()) {
        importacaoEmAndamento = true;
        try {
          await importarEAbrir(db, { ciclo, quem: "agendador" });
        } finally {
          importacaoEmAndamento = false;
        }
      }

      // 2) mensagens que ficaram pendentes (fora da janela / falha transitória)
      const d = await envio.drenarPendentes(db);
      if (d.enviadas) console.log(`[ecac] fila: ${d.enviadas} mensagem(ns) enviada(s).`);

      // 3) máquina de estados — as ações têm data; rodar toda meia hora não repete nada
      const r = await processarCobrancas(db, { hoje });
      const relevantes = r.feitos.filter((f) => !["nada", "aguardar"].includes(f.acao));
      if (relevantes.length) console.log(`[ecac] cobranças: ${JSON.stringify(relevantes).slice(0, 800)}`);
    } catch (err) {
      console.error("[ecac] ciclo:", err.message);
    }
  };
  setInterval(tique, 30 * 60 * 1000);
  setTimeout(tique, 90 * 1000).unref();
}

module.exports = {
  cicloDe,
  importarEAbrir,
  processarCobrancas,
  registrarGuiaGerada,
  registrarClique,
  registrarAbertura,
  registrarStatusMensagem,
  pausar,
  retomar,
  iniciarAgendadorEcac,
  evento,
};
