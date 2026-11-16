/**
 * Baixa automática das guias do portal pelo relatório de situação fiscal do e-CAC.
 *
 * Pedido do Jean (16/11/2026): guia que está "Em atraso" em Próximos pagamentos e cuja
 * competência NÃO aparece mais no relatório de pendências puxado pela Central é marcada
 * como paga — o mesmo efeito do botão "Paguei" —, com a marca de que a baixa foi
 * automática e de qual relatório saiu. O cliente para de ver dívida que já pagou.
 *
 * A AUSÊNCIA de um débito só prova pagamento quando o relatório é bom. Por isso a regra
 * é desconfiada: na dúvida, NÃO baixa (a guia continua com o botão "Paguei").
 *
 *  1. Relatório da empresa existe, foi lido de verdade (`relatorio_situacao` preenchida:
 *     PDF que não abre vira relatório sem situação, sem débito e com data de agora — é
 *     falha de coleta, não empresa em dia), tem no máximo `max_idade_dias` e foi tirado
 *     DEPOIS do vencimento da guia.
 *  2. Relatório com parcelamento ou inscrição em PGFN: débito pode ter saído do SIEF sem
 *     ter sido pago → não baixa nada da empresa (o escritório confere).
 *  3. Débito do mesmo tipo e período de apuração no relatório → não baixa (ainda deve).
 *     Para o INSS também bloqueia IRRF e "outros": a DARF da DCTFWeb junta códigos.
 *  4. Omissão da declaração (PGDAS-D para o DAS; DCTFWeb/GFIP para o INSS) no ano/mês →
 *     não baixa: sem declaração o débito nem existe no relatório.
 *  5. FGTS não está no relatório da Receita (é FGTS Digital/Caixa). Só baixa se a opção
 *     "FGTS acompanha o INSS" estiver ligada e o INSS (DCTF Web) do mesmo mês estiver pago.
 *  6. Guia que alguém reabriu depois de uma baixa automática nunca mais é baixada sozinha.
 *
 * Tudo fica em `ecac_baixas_auto` (de qual relatório, quando, rodada) e pode ser
 * revertido por guia ou pela rodada inteira.
 *
 * As funções puras ficam no topo (testes em src/test/ecacBaixaAuto.test.ts); o que lê e
 * grava banco fica embaixo.
 */
const crypto = require("crypto");
const { getSetting, setSetting } = require("./appSettings");
const { hojeSP } = require("./diasBancarios");

const CHAVES = {
  ativa: "ecac_baixa_auto_ativa",
  maxIdadeDias: "ecac_baixa_auto_max_idade_dias",
  fgtsComInss: "ecac_baixa_auto_fgts_com_inss",
  ultimaRodada: "ecac_baixa_auto_ultima_rodada",
};

const PADRAO = Object.freeze({ ativa: true, max_idade_dias: 40, fgts_com_inss: false });

/** Tipos de guia do portal (G-Click) que a baixa automática conhece. */
const DOC_TYPES = ["DAS", "DCTF_WEB", "FGTS"];

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

// ------------------------------------------------------------------ regras puras

function soData(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : hojeSP(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : hojeSP(d);
}

function diasEntre(inicioIso, fimIso) {
  return Math.round((Date.parse(`${fimIso}T00:00:00Z`) - Date.parse(`${inicioIso}T00:00:00Z`)) / 86400000);
}

function mesAnterior(ano, mes) {
  return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
}

/**
 * Período de apuração da guia ('AAAAMM'). DAS, INSS e FGTS vencem no mês seguinte ao
 * da apuração, então o PA é o mês ANTERIOR ao do vencimento. No G-Click, `competencia`
 * é o mês de PAGAMENTO (ver gclick/sync.js): se ela não bate com o mês do vencimento, a
 * guia é ambígua e fica de fora.
 */
function periodoDaGuia(guia) {
  const venc = soData(guia && guia.due_date);
  if (!venc) return { periodo: null, motivo: "guia sem vencimento" };
  const ano = Number(venc.slice(0, 4));
  const mes = Number(venc.slice(5, 7));
  if (guia.competencia && String(guia.competencia).slice(0, 7) !== venc.slice(0, 7)) {
    return { periodo: null, motivo: "competência da guia não bate com o vencimento" };
  }
  const pa = mesAnterior(ano, mes);
  return { periodo: `${pa.ano}${String(pa.mes).padStart(2, "0")}`, motivo: null };
}

/** 'AAAAMM' → 'MM/AAAA' (como o relatório escreve). */
function periodoBR(aaaamm) {
  return aaaamm ? `${aaaamm.slice(4, 6)}/${aaaamm.slice(0, 4)}` : "";
}

/** 'MM/AAAA' ou 'DD/MM/AAAA' → 'AAAAMM' (o mesmo que o central-ecac manda em periodo_aaaamm). */
function periodoDoDebito(d) {
  if (d && /^\d{6}$/.test(String(d.periodo_aaaamm || ""))) return String(d.periodo_aaaamm);
  const t = String((d && d.periodo_apuracao) || "").trim();
  let m = /^(\d{2})\/(\d{4})$/.exec(t);
  if (m) return `${m[2]}${m[1]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}${m[2]}`;
  return null;
}

/** Este débito do relatório é a mesma dívida que a guia `docType`? */
function debitoEhDoTipo(docType, d) {
  const tipo = String((d && d.tipo) || "").toUpperCase();
  const receita = String((d && d.receita) || "").toUpperCase();
  if (tipo === "MAED" || /\bMAED\b/.test(receita)) return false; // multa de declaração, não é a guia
  if (docType === "DAS") {
    if (tipo === "SN" || tipo === "MEI") return true;
    return tipo === "OUTROS" && /SIMPLES|\bDAS\b|\bMEI\b/.test(receita);
  }
  if (docType === "DCTF_WEB") {
    if (tipo === "SN" || tipo === "MEI") return false;
    // INSS, IRRF e o que o leitor não classificou: a DARF da DCTFWeb junta vários códigos.
    return true;
  }
  return false;
}

/** Débitos do relatório que ainda seguram a guia (mesmo tipo e mesmo período). */
function debitosQueBloqueiam(docType, periodo, debitos) {
  return (Array.isArray(debitos) ? debitos : []).filter(
    (d) => debitoEhDoTipo(docType, d) && periodoDoDebito(d) === periodo
  );
}

const OMISSOES_POR_TIPO = {
  DAS: ["PGDAS-D", "PGDASD", "DASSNSIMEI"],
  DCTF_WEB: ["DCTFWEB", "GFIP"],
};

/** Omissão da declaração que gera a guia, no ano/mês do período. Sem meses = ano todo. */
function omissoesQueBloqueiam(docType, periodo, omissoes) {
  const tipos = OMISSOES_POR_TIPO[docType] || [];
  const ano = periodo.slice(0, 4);
  const mes = MESES[Number(periodo.slice(4, 6)) - 1];
  return (Array.isArray(omissoes) ? omissoes : []).filter((o) => {
    const t = String((o && o.tipo) || "").toUpperCase().replace(/\s+/g, "");
    if (!tipos.includes(t)) return false;
    if (String(o.ano) !== ano) return false;
    const meses = Array.isArray(o.meses) ? o.meses.map((x) => String(x).toUpperCase()) : [];
    return meses.length === 0 || meses.includes(mes);
  });
}

/** O relatório serve para dar baixa nesta guia? Devolve o motivo de NÃO servir, ou null. */
function motivoRelatorioNaoServe(espelho, vencimento, hoje, maxIdadeDias) {
  if (!espelho) return "empresa sem relatório do e-CAC importado";
  if (!String(espelho.relatorio_situacao || "").trim()) {
    return "relatório sem leitura confirmada (reimporte o e-CAC)";
  }
  if (!Array.isArray(espelho.debitos) || !Array.isArray(espelho.omissoes)) return "relatório incompleto";
  const dataRel = soData(espelho.relatorio_data);
  if (!dataRel) return "relatório sem data";
  if (diasEntre(dataRel, hoje) > maxIdadeDias) return `relatório velho (${dataRel})`;
  if (dataRel <= vencimento) return `relatório de ${dataRel}, anterior ao vencimento`;
  if (espelho.parcelamento || espelho.pgfn) return "relatório mostra parcelamento ou PGFN: conferir à mão";
  return null;
}

/**
 * Decide UMA guia. `pagosInss` = períodos 'AAAAMM' em que o INSS da empresa está pago
 * (para a opção do FGTS). Devolve { baixar, motivo, periodo }.
 */
function avaliarGuia(guia, espelho, { hoje, maxIdadeDias = PADRAO.max_idade_dias, fgtsComInss = false, pagosInss = new Set() } = {}) {
  const docType = String((guia && guia.doc_type) || "").toUpperCase();
  if (!DOC_TYPES.includes(docType)) return { baixar: false, motivo: "tipo de guia fora da baixa automática", periodo: null };
  if (guia.status !== "pending") return { baixar: false, motivo: "guia não está em aberto", periodo: null };
  if (guia.baixa_auto_bloqueada) return { baixar: false, motivo: "reaberta depois de uma baixa automática", periodo: null };

  const venc = soData(guia.due_date);
  if (!venc || venc >= hoje) return { baixar: false, motivo: "ainda não venceu", periodo: null };

  const { periodo, motivo } = periodoDaGuia(guia);
  if (!periodo) return { baixar: false, motivo, periodo: null };

  if (docType === "FGTS") {
    if (!fgtsComInss) return { baixar: false, motivo: "FGTS não consta no relatório da Receita", periodo };
    if (!pagosInss.has(periodo)) return { baixar: false, motivo: "INSS (DCTF Web) do mesmo mês não está pago", periodo };
    return { baixar: true, motivo: "INSS (DCTF Web) do mesmo mês está pago", periodo };
  }

  const naoServe = motivoRelatorioNaoServe(espelho, venc, hoje, maxIdadeDias);
  if (naoServe) return { baixar: false, motivo: naoServe, periodo };

  const debitos = debitosQueBloqueiam(docType, periodo, espelho.debitos);
  if (debitos.length) return { baixar: false, motivo: `consta no relatório (${periodoBR(periodo)})`, periodo };

  const omissoes = omissoesQueBloqueiam(docType, periodo, espelho.omissoes);
  if (omissoes.length) return { baixar: false, motivo: `declaração omissa no relatório (${omissoes[0].tipo})`, periodo };

  return { baixar: true, motivo: `não consta no relatório de ${soData(espelho.relatorio_data)}`, periodo };
}

// ------------------------------------------------------------------ configuração

async function lerConfig(db) {
  const [ativa, idade, fgts, ultima] = await Promise.all(Object.values(CHAVES).map((k) => getSetting(db, k)));
  const n = parseInt(String(idade ?? ""), 10);
  let ultimaObj = null;
  try {
    ultimaObj = ultima ? JSON.parse(ultima) : null;
  } catch {
    ultimaObj = null;
  }
  return {
    ativa: ativa == null ? PADRAO.ativa : ativa === "true",
    max_idade_dias: Number.isNaN(n) ? PADRAO.max_idade_dias : Math.min(90, Math.max(5, n)),
    fgts_com_inss: fgts == null ? PADRAO.fgts_com_inss : fgts === "true",
    ultima_rodada: ultimaObj,
  };
}

async function salvarConfig(db, p = {}) {
  if (typeof p.ativa === "boolean") await setSetting(db, CHAVES.ativa, p.ativa);
  if (p.max_idade_dias !== undefined) {
    const n = parseInt(String(p.max_idade_dias), 10);
    if (!Number.isNaN(n)) await setSetting(db, CHAVES.maxIdadeDias, Math.min(90, Math.max(5, n)));
  }
  if (typeof p.fgts_com_inss === "boolean") await setSetting(db, CHAVES.fgtsComInss, p.fgts_com_inss);
  return lerConfig(db);
}

// ------------------------------------------------------------------ banco

/** Guias em atraso que a regra pode olhar (o que o cliente vê em "Em atraso"). */
async function guiasEmAtraso(db, { companyIds = null, hoje }) {
  const params = [DOC_TYPES, hoje];
  let filtro = "";
  if (companyIds && companyIds.length) {
    params.push(companyIds);
    filtro = ` AND d.company_id = ANY($${params.length}::uuid[])`;
  }
  const { rows } = await db.query(
    `SELECT d.id, d.company_id, d.doc_type, d.title, d.competencia,
            to_char(d.due_date, 'YYYY-MM-DD') AS due_date, d.status,
            COALESCE(d.baixa_auto_bloqueada, false) AS baixa_auto_bloqueada,
            c.name AS company_name
       FROM deliverables d
       JOIN companies c ON c.id = d.company_id
      WHERE d.category = 'guia'
        AND upper(d.doc_type) = ANY($1)
        AND d.status = 'pending'
        AND d.due_date IS NOT NULL AND d.due_date < $2::date
        AND d.historico IS NOT TRUE
        AND d.cancelado IS NOT TRUE
        AND d.released_at IS NOT NULL
        AND d.source <> 'cora'
        AND COALESCE(c.arquivada, false) = false
        AND COALESCE(c.excluida, false) = false${filtro}
      ORDER BY c.name, d.due_date`,
    params
  );
  return rows;
}

/** Último espelho de cada empresa (um SELECT para a carteira toda). */
async function ultimosEspelhos(db, companyIds) {
  if (!companyIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (company_id) id, company_id, relatorio_id, relatorio_data, relatorio_situacao,
            debitos, omissoes, parcelamento, pgfn
       FROM ecac_pendencias
      WHERE company_id = ANY($1::uuid[])
      ORDER BY company_id, relatorio_id DESC`,
    [companyIds]
  );
  return new Map(rows.map((r) => [r.company_id, r]));
}

/** Períodos em que o INSS (DCTF Web) da empresa já está pago no portal. */
async function periodosInssPagos(db, companyIds) {
  const mapa = new Map();
  if (!companyIds.length) return mapa;
  const { rows } = await db.query(
    `SELECT company_id, competencia, to_char(due_date, 'YYYY-MM-DD') AS due_date
       FROM deliverables
      WHERE company_id = ANY($1::uuid[]) AND upper(doc_type) = 'DCTF_WEB' AND status = 'paid'
        AND cancelado IS NOT TRUE`,
    [companyIds]
  );
  for (const r of rows) {
    const { periodo } = periodoDaGuia(r);
    if (!periodo) continue;
    if (!mapa.has(r.company_id)) mapa.set(r.company_id, new Set());
    mapa.get(r.company_id).add(periodo);
  }
  return mapa;
}

async function evento(db, companyId, tipo, dados) {
  try {
    await db.query(
      `INSERT INTO ecac_eventos (company_id, tipo, dados) VALUES ($1, $2, $3::jsonb)`,
      [companyId, tipo, JSON.stringify(dados || {})]
    );
  } catch (err) {
    console.error("[ecac-baixa] evento:", err.message);
  }
}

async function baixarUma(db, guia, espelho, { rodadaId, quem, motivo, periodo }) {
  const client = typeof db.connect === "function" ? await db.connect() : db;
  try {
    if (client !== db) await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE deliverables
          SET status = 'paid', paid_at = now(), baixa_auto_em = now(),
              baixa_auto_relatorio_em = $2
        WHERE id = $1 AND status = 'pending'
        RETURNING id`,
      [guia.id, espelho ? espelho.relatorio_data : null]
    );
    if (!rows.length) {
      if (client !== db) await client.query("ROLLBACK");
      return null;
    }
    const { rows: ins } = await client.query(
      `INSERT INTO ecac_baixas_auto
         (rodada_id, deliverable_id, company_id, doc_type, competencia, periodo_apuracao, due_date,
          pendencia_id, relatorio_id, relatorio_data, motivo, quem)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        rodadaId, guia.id, guia.company_id, guia.doc_type, guia.competencia || null, periodoBR(periodo), guia.due_date,
        espelho ? espelho.id : null, espelho ? espelho.relatorio_id : null, espelho ? espelho.relatorio_data : null,
        motivo, quem,
      ]
    );
    if (client !== db) await client.query("COMMIT");
    return ins[0].id;
  } catch (err) {
    if (client !== db) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (client !== db) client.release();
  }
}

/**
 * Roda a regra. `aplicar=false` é a prévia (não grava nada). Sem `companyIds`, olha a
 * carteira toda. Devolve { rodada_id, baixadas, puladas, ... } para o painel.
 */
async function rodar(db, { companyIds = null, aplicar = true, quem = "agendador", forcar = false } = {}) {
  const cfg = await lerConfig(db);
  if (aplicar && !cfg.ativa && !forcar) return { pulado: true, motivo: "baixa automática desligada" };

  const hoje = hojeSP();
  const rodadaId = `${hoje.replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex")}`;
  const guias = await guiasEmAtraso(db, { companyIds, hoje });
  const ids = [...new Set(guias.map((g) => g.company_id))];
  const espelhos = await ultimosEspelhos(db, ids);
  const inssPagos = await periodosInssPagos(db, ids);

  const baixadas = [];
  const puladas = [];
  // FGTS por último: a opção "acompanha o INSS" olha o INSS que acabou de ser baixado.
  const ordem = [...guias.filter((g) => String(g.doc_type).toUpperCase() !== "FGTS"),
    ...guias.filter((g) => String(g.doc_type).toUpperCase() === "FGTS")];

  for (const g of ordem) {
    const espelho = espelhos.get(g.company_id) || null;
    const pagos = inssPagos.get(g.company_id) || new Set();
    const r = avaliarGuia(g, espelho, { hoje, maxIdadeDias: cfg.max_idade_dias, fgtsComInss: cfg.fgts_com_inss, pagosInss: pagos });
    const linha = {
      deliverable_id: g.id, company_id: g.company_id, company_name: g.company_name, doc_type: g.doc_type,
      title: g.title, due_date: g.due_date, periodo_apuracao: periodoBR(r.periodo), motivo: r.motivo,
      relatorio_data: espelho ? espelho.relatorio_data : null,
    };
    if (!r.baixar) {
      puladas.push(linha);
      continue;
    }
    if (aplicar) {
      try {
        const baixaId = await baixarUma(db, g, espelho, { rodadaId, quem, motivo: r.motivo, periodo: r.periodo });
        if (!baixaId) continue;
        linha.baixa_id = baixaId;
      } catch (err) {
        puladas.push({ ...linha, motivo: `erro ao gravar: ${err.message}` });
        continue;
      }
    }
    if (String(g.doc_type).toUpperCase() === "DCTF_WEB") pagos.add(r.periodo);
    inssPagos.set(g.company_id, pagos);
    baixadas.push(linha);
  }

  const resumo = {
    rodada_id: rodadaId, aplicada: aplicar, quem, em: new Date().toISOString(),
    analisadas: guias.length, qtd_baixadas: baixadas.length, qtd_puladas: puladas.length,
  };
  if (aplicar) {
    if (baixadas.length) {
      const porEmpresa = new Map();
      for (const b of baixadas) porEmpresa.set(b.company_id, (porEmpresa.get(b.company_id) || 0) + 1);
      for (const [companyId, qtd] of porEmpresa) {
        await evento(db, companyId, "baixa_automatica", { rodada_id: rodadaId, qtd, quem });
      }
      console.log(`[ecac-baixa] rodada ${rodadaId} (${quem}): ${baixadas.length} guia(s) baixada(s) de ${guias.length} em atraso.`);
    }
    if (!companyIds) await setSetting(db, CHAVES.ultimaRodada, JSON.stringify(resumo));
  }
  return { ...resumo, baixadas, puladas };
}

/** Desfaz baixas automáticas (por id da baixa ou pela rodada). A guia volta a "Em atraso". */
async function reverter(db, { baixaId = null, rodadaId = null, quem }) {
  if (!baixaId && !rodadaId) throw new Error("informe a baixa ou a rodada");
  const params = [];
  let filtro;
  if (baixaId) {
    params.push(baixaId);
    filtro = `b.id = $1`;
  } else {
    params.push(String(rodadaId));
    filtro = `b.rodada_id = $1`;
  }
  const { rows } = await db.query(
    `SELECT b.id, b.deliverable_id, b.company_id FROM ecac_baixas_auto b
      WHERE ${filtro} AND b.revertido_em IS NULL`,
    params
  );
  let revertidas = 0;
  for (const b of rows) {
    // Só volta a pendente se a guia ainda está paga PELA baixa automática: se alguém
    // marcou "Paguei" depois, a marcação manual vale.
    const { rowCount } = await db.query(
      `UPDATE deliverables
          SET status = 'pending', paid_at = NULL, baixa_auto_em = NULL, baixa_auto_relatorio_em = NULL,
              baixa_auto_bloqueada = true
        WHERE id = $1 AND status = 'paid' AND baixa_auto_em IS NOT NULL`,
      [b.deliverable_id]
    );
    await db.query(
      `UPDATE ecac_baixas_auto SET revertido_em = now(), revertido_por = $2 WHERE id = $1`,
      [b.id, quem]
    );
    if (rowCount) {
      revertidas += 1;
      await evento(db, b.company_id, "baixa_automatica_revertida", { baixa_id: b.id, deliverable_id: b.deliverable_id, quem });
    }
  }
  return { revertidas, total: rows.length };
}

async function listar(db, { limite = 200, companyId = null } = {}) {
  const params = [Math.min(1000, Math.max(1, Number(limite) || 200))];
  let filtro = "";
  if (companyId) {
    params.push(companyId);
    filtro = `WHERE b.company_id = $2`;
  }
  const { rows } = await db.query(
    `SELECT b.id, b.rodada_id, b.deliverable_id, b.company_id, c.name AS company_name, b.doc_type,
            b.competencia, b.periodo_apuracao, to_char(b.due_date, 'YYYY-MM-DD') AS due_date,
            b.relatorio_id, b.relatorio_data, b.motivo, b.quem, b.criado_em, b.revertido_em, b.revertido_por,
            d.title, d.status
       FROM ecac_baixas_auto b
       JOIN companies c ON c.id = b.company_id
       LEFT JOIN deliverables d ON d.id = b.deliverable_id
       ${filtro}
      ORDER BY b.criado_em DESC, c.name
      LIMIT $1`,
    params
  );
  return rows;
}

module.exports = {
  CHAVES,
  PADRAO,
  DOC_TYPES,
  periodoDaGuia,
  periodoDoDebito,
  debitoEhDoTipo,
  debitosQueBloqueiam,
  omissoesQueBloqueiam,
  motivoRelatorioNaoServe,
  avaliarGuia,
  lerConfig,
  salvarConfig,
  rodar,
  reverter,
  listar,
};
