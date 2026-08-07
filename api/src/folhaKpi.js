/**
 * Gravação e leitura do histórico de folha — o que alimenta o painel gerencial.
 *
 * Grava o retrato de cada competência a partir do Extrato Mensal e responde as consultas
 * do painel com filtro de período. Nada é recalculado do PDF na leitura: o retrato já
 * está no banco (ver o porquê em `ensurePayrollHistorySchema.js`).
 */
const fs = require("fs");
const { resolveUploadPath } = require("./uploads");
const { extrairFinanceiro, conferirFinanceiro, diagnosticar } = require("./extratoFinanceiro");
const { extrairDoTexto } = require("./extratoEmployees");
const { projetar } = require("./decimoTerceiro");
const { funcionarioRealSql } = require("./payrollRoles");

/** Lê o texto de um PDF de entrega. Devolve null se o arquivo sumiu do volume. */
async function textoDoExtrato(filePath) {
  const full = resolveUploadPath(filePath);
  if (!full || !fs.existsSync(full)) return null;
  let parser;
  try {
    const { PDFParse } = require("pdf-parse");
    parser = new PDFParse({ data: fs.readFileSync(full) });
    const { text } = await parser.getText();
    return text || null;
  } catch (err) {
    console.error("[folhaKpi] falha ao ler PDF:", err.message);
    return null;
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch { /* já liberado */ }
    }
  }
}

/**
 * Lê um extrato e grava o retrato da competência.
 *
 * `ON CONFLICT` atualiza: reimportar ou retificar corrige o mês em vez de duplicar.
 */
async function gravarSnapshot(db, { companyId, competencia, deliverableId, filePath }) {
  const texto = await textoDoExtrato(filePath);
  if (!texto) return { ok: false, erro: "PDF não encontrado no volume" };

  // Contagem de funcionários pelo CORPO do extrato — parser já validado contra PDF real
  // (15/15 no QUEIJEIRO 3). Vira o fallback do quadro quando o rodapé não entrega.
  let funcionariosNoCorpo = null;
  try {
    funcionariosNoCorpo = extrairDoTexto(texto).funcionarios.length || null;
  } catch {
    funcionariosNoCorpo = null;
  }

  const f = extrairFinanceiro(texto, { funcionariosNoCorpo });
  const conf = conferirFinanceiro(f);

  // Quando não fecha, guarda POR QUE — e uma amostra do que o PDF realmente é. Sem isso
  // o painel dizia "não achei o total" e ninguém tinha como descobrir se o problema era
  // o leitor, um PDF digitalizado ou um documento que nem é extrato.
  const diag = conf.ok ? null : diagnosticar(texto);

  if (!conf.ok) {
    console.warn(
      `[folhaKpi] ${competencia} não fechou:`,
      conf.problemas.join(" | "),
      "| totais:", JSON.stringify(f.totais),
      "| situacoes:", JSON.stringify(f.situacoes)
    );
  }

  await db.query(
    `INSERT INTO payroll_snapshots
       (company_id, competencia, deliverable_id,
        proventos, descontos, liquido, inss, fgts, base_fgts, irrf,
        empregados, admitidos, demitidos, trabalhando, em_ferias,
        afastamento_valor, afastamento_dias, afastamento_funcionarios,
        faltas_dias, faltas_dias_dsr, conferido, problemas, causa, diagnostico, origem_quadro)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     ON CONFLICT (company_id, competencia) DO UPDATE SET
       deliverable_id = EXCLUDED.deliverable_id,
       proventos = EXCLUDED.proventos, descontos = EXCLUDED.descontos,
       liquido = EXCLUDED.liquido, inss = EXCLUDED.inss, fgts = EXCLUDED.fgts,
       base_fgts = EXCLUDED.base_fgts, irrf = EXCLUDED.irrf,
       empregados = EXCLUDED.empregados, admitidos = EXCLUDED.admitidos,
       demitidos = EXCLUDED.demitidos, trabalhando = EXCLUDED.trabalhando,
       em_ferias = EXCLUDED.em_ferias,
       afastamento_valor = EXCLUDED.afastamento_valor,
       afastamento_dias = EXCLUDED.afastamento_dias,
       afastamento_funcionarios = EXCLUDED.afastamento_funcionarios,
       faltas_dias = EXCLUDED.faltas_dias, faltas_dias_dsr = EXCLUDED.faltas_dias_dsr,
       conferido = EXCLUDED.conferido, problemas = EXCLUDED.problemas,
       causa = EXCLUDED.causa, diagnostico = EXCLUDED.diagnostico,
       origem_quadro = EXCLUDED.origem_quadro,
       atualizado_em = now()`,
    [
      companyId, competencia, deliverableId,
      f.totais.proventos, f.totais.descontos, f.totais.liquido, f.totais.inss,
      f.totais.fgts, f.totais.base_fgts, f.totais.irrf,
      f.situacoes.empregados, f.situacoes.admitidos, f.situacoes.demitidos,
      f.situacoes.trabalhando, f.situacoes.em_ferias,
      f.afastamento.valor, f.afastamento.dias, f.afastamento.ocorrencias,
      f.faltas.dias, f.faltas.dias_dsr,
      conf.ok,
      conf.problemas.length ? conf.problemas.join(" ") : null,
      diag?.causa ?? null,
      diag ? `${diag.explicacao}

O PDF veio assim: ${diag.amostra}` : null,
      f.origem_quadro,
    ]
  );

  return { ok: conf.ok, problemas: conf.problemas, causa: diag?.causa ?? null, competencia };
}

/**
 * Reprocessa os extratos que já estão no portal.
 *
 * Necessário porque o `extratoAuto` só relê quando o arquivo muda — sem isto, os PDFs
 * trazidos pela carga histórica ficariam no disco sem nunca virar linha no relatório.
 */
async function reprocessarExtratos(db, { companyId = null, desde = null } = {}) {
  const params = [];
  const filtros = ["d.doc_type = 'EXTRATO_FOLHA'", "d.competencia IS NOT NULL"];
  if (companyId) {
    params.push(companyId);
    filtros.push(`d.company_id = $${params.length}`);
  }
  if (desde) {
    params.push(desde);
    filtros.push(`d.competencia >= $${params.length}`);
  }

  const { rows } = await db.query(
    `SELECT d.id, d.company_id, d.competencia, d.file_path
       FROM deliverables d
      WHERE ${filtros.join(" AND ")}
      ORDER BY d.competencia`,
    params
  );

  let gravados = 0;
  let comProblema = 0;
  const erros = [];
  for (const d of rows) {
    try {
      const r = await gravarSnapshot(db, {
        companyId: d.company_id,
        competencia: d.competencia,
        deliverableId: d.id,
        filePath: d.file_path,
      });
      if (r.erro) erros.push({ competencia: d.competencia, erro: r.erro });
      else {
        gravados += 1;
        if (!r.ok) comProblema += 1;
      }
    } catch (err) {
      erros.push({ competencia: d.competencia, erro: err.message });
    }
  }
  return { extratos: rows.length, gravados, com_problema: comProblema, erros: erros.slice(0, 20) };
}

/**
 * Série do painel: uma linha por competência no período.
 * Sem empresa, soma a carteira inteira — é a visão do escritório.
 */
async function serie(db, { companyId = null, de = null, ate = null } = {}) {
  const params = [];
  const filtros = [];
  if (companyId) {
    params.push(companyId);
    filtros.push(`company_id = $${params.length}`);
  }
  if (de) {
    params.push(de);
    filtros.push(`competencia >= $${params.length}`);
  }
  if (ate) {
    params.push(ate);
    filtros.push(`competencia <= $${params.length}`);
  }
  const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

  const { rows } = await db.query(
    `SELECT competencia,
            SUM(proventos)::numeric(14,2) AS folha_bruta,
            SUM(inss)::numeric(14,2) AS inss,
            SUM(fgts)::numeric(14,2) AS fgts,
            SUM(afastamento_valor)::numeric(14,2) AS afastamento_valor,
            SUM(afastamento_dias)::numeric(8,2) AS afastamento_dias,
            SUM(faltas_dias)::numeric(8,2) AS faltas_dias,
            SUM(empregados)::int AS empregados,
            SUM(admitidos)::int AS admitidos,
            SUM(demitidos)::int AS demitidos,
            COUNT(*)::int AS empresas,
            COUNT(*) FILTER (WHERE conferido IS FALSE)::int AS nao_conferidos
       FROM payroll_snapshots
       ${where}
      GROUP BY competencia
      ORDER BY competencia`,
    params
  );

  return rows.map((r) => ({
    ...r,
    // Turnover do período, com a mesma fórmula do mês: (adm + dem) / 2 / quadro.
    turnover:
      r.empregados > 0
        ? Number((((r.admitidos + r.demitidos) / 2 / r.empregados) * 100).toFixed(2))
        : null,
  }));
}

/**
 * Projeção do 13º a partir do quadro atual.
 *
 * A fonte de verdade de QUEM é CLT é a **Programação de Férias**: sócio com pró-labore
 * NÃO aparece nela — só quem tem direito a férias (celetista). Isso resolve o problema
 * de cargo NULL no employees: se o nome não está na programação, não entra no 13º.
 *
 * Quando a empresa não tem programação de férias importada, cai de volta para employees
 * filtrado por cargo (funcionarioRealSql), que é o melhor que dá para fazer sem a lista.
 */
async function projecaoDecimoTerceiro(db, { companyId = null, ano = new Date().getFullYear() } = {}) {
  if (!companyId) {
    // Sem empresa, usa employees filtrado (visão geral do escritório)
    const { rows } = await db.query(
      `SELECT e.name AS nome, e.salario_base, e.company_id,
              to_char(e.admissao, 'YYYY-MM-DD') AS admissao
         FROM employees e
        WHERE ${funcionarioRealSql("e")}
        ORDER BY e.name`
    );
    return projetar({ funcionarios: rows, ano });
  }

  // Programação de Férias = lista de quem é CLT (sócio não aparece)
  const { rows: vps } = await db.query(
    `SELECT DISTINCT ON (nome) nome,
            to_char(admissao, 'YYYY-MM-DD') AS admissao
       FROM vacation_periods
      WHERE company_id = $1
      ORDER BY nome, admissao`,
    [companyId]
  );

  // Se não tem programação de férias, cai para employees filtrado
  if (!vps.length) {
    const { rows } = await db.query(
      `SELECT e.name AS nome, e.salario_base, e.company_id,
              to_char(e.admissao, 'YYYY-MM-DD') AS admissao
         FROM employees e
        WHERE ${funcionarioRealSql("e")} AND e.company_id = $1
        ORDER BY e.name`,
      [companyId]
    );
    return projetar({ funcionarios: rows, ano });
  }

  // Buscar salários individuais da tabela employees para cruzar
  const { rows: emps } = await db.query(
    `SELECT name, salario_base FROM employees WHERE company_id = $1 AND salario_base > 0`,
    [companyId]
  );
  const salarioPorNome = new Map();
  for (const e of emps) {
    const chave = String(e.name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
    if (chave && e.salario_base > 0) salarioPorNome.set(chave, Number(e.salario_base));
  }

  // Média da folha excluindo pró-labore: proventos / nº de CLT (programação de férias)
  let mediaFolha = null;
  const { rows: snap } = await db.query(
    `SELECT proventos FROM payroll_snapshots
      WHERE company_id = $1 AND proventos > 0
      ORDER BY competencia DESC LIMIT 1`,
    [companyId]
  );
  if (snap.length) {
    mediaFolha = Number(snap[0].proventos) / vps.length;
    if (!Number.isFinite(mediaFolha) || mediaFolha <= 0) mediaFolha = null;
  }

  // Montar a lista: nome e admissão da programação, salário do employees ou média
  const funcionarios = vps.map((vp) => {
    const chave = String(vp.nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
    const salario = salarioPorNome.get(chave) || mediaFolha || null;
    return {
      nome: vp.nome,
      salario_base: salario,
      admissao: vp.admissao,
      company_id: companyId,
    };
  });

  return projetar({ funcionarios, ano });
}

module.exports = { gravarSnapshot, reprocessarExtratos, serie, projecaoDecimoTerceiro };
