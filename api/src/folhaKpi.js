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
const { extrairDoTexto, cpfValido } = require("./extratoEmployees");
const { projetar } = require("./decimoTerceiro");
const { funcionarioRealSql, ehProLabore, ehEstagiario } = require("./payrollRoles");

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
 * Sincroniza `employees.vinculo/cargo/salario_base/eh_contribuinte` com o que o
 * extrato realmente diz, casando por CPF.
 *
 * Por que isto precisa existir: a leitura automática do extrato (`gravarSnapshot`,
 * abaixo) sempre gravou só TOTAIS agregados em `payroll_snapshots` — nunca tocava a
 * tabela `employees`, que é quem decide QUEM entra no 13º/férias
 * (`funcionarioRealSql`, em payrollRoles.js, lê `employees.vinculo`). Sem isto,
 * endurecer o parser (ver extratoEmployees.js) só arrumava a MÉDIA da empresa — a
 * pessoa continuava cadastrada na tabela com o vínculo antigo (ou nenhum), e o
 * filtro do 13º nunca via a correção. `employees` só era atualizada por upload
 * manual de planilha (employeeImport.js) ou edição avulsa — processos que ninguém
 * repete todo mês, então o cadastro ia ficando para trás da folha real.
 *
 * Casamento por CPF, o mesmo critério de `employeeImport.js`. Cria quem ainda não
 * existe; atualiza quem existe — a folha nova é a fonte de verdade sobre
 * vínculo/salário, mesma filosofia do import manual ("ATUALIZA o que a folha nova
 * traz de fresco"). `eh_contribuinte` só vira `true`, nunca volta a `false` por
 * aqui: uma vez identificado como pró-labore num extrato, continua protegido
 * mesmo que um mês futuro leia mal a linha dele.
 */
async function sincronizarEmployeesDoExtrato(db, companyId, funcionarios) {
  for (const f of funcionarios || []) {
    if (!f.cpf || !cpfValido(f.cpf)) continue;
    const nome = String(f.name || "").trim().toUpperCase();
    if (!nome) continue;
    const salario = f.salarioBase && f.salarioBase > 0 ? f.salarioBase : null;

    const { rows: existentes } = await db.query(
      "SELECT id FROM employees WHERE company_id = $1 AND cpf = $2 LIMIT 1",
      [companyId, f.cpf]
    );
    if (existentes.length) {
      await db.query(
        `UPDATE employees
            SET vinculo = COALESCE($3, vinculo),
                cargo = COALESCE($4, cargo),
                salario_base = COALESCE($5, salario_base),
                eh_contribuinte = CASE WHEN $6 THEN true ELSE eh_contribuinte END
          WHERE company_id = $1 AND cpf = $2`,
        [companyId, f.cpf, f.vinculo || null, f.cargo || null, salario, Boolean(f.ehContribuinte)]
      );
    } else {
      await db.query(
        `INSERT INTO employees
           (company_id, name, cpf, active, salario_base, cargo, vinculo, eh_contribuinte)
         VALUES ($1, $2, $3, true, $4, $5, $6, $7)`,
        [companyId, nome, f.cpf, salario, f.cargo || null, f.vinculo || null, Boolean(f.ehContribuinte)]
      );
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

  // Funcionários pelo CORPO do extrato — parser já validado contra PDF real (15/15 no
  // QUEIJEIRO 3). A CONTAGEM vira fallback do quadro quando o rodapé não entrega; a
  // LISTA (com vinculo/salarioBase por pessoa) alimenta a base do 13º/férias logo abaixo.
  let funcionariosNoCorpo = null;
  let funcionariosDetalhe = [];
  try {
    funcionariosDetalhe = extrairDoTexto(texto).funcionarios || [];
    funcionariosNoCorpo = funcionariosDetalhe.length || null;
  } catch {
    funcionariosNoCorpo = null;
  }

  const f = extrairFinanceiro(texto, { funcionariosNoCorpo });

  // Base de salário só dos celetistas — preferida a partir da SOMA dos blocos por
  // funcionário, não da linha solta "Salário contribuição empregados" da página 2.
  //
  // Essa linha muda de redação entre layouts do relatório (visto em produção: dezenas
  // de extratos com FGTS > 0 no rodapé — ou seja, HÁ celetista contribuindo — mas com
  // esse campo vindo null, porque o rótulo da página 2 não bateu com o texto real).
  // O bloco por funcionário já foi endurecido contra o mesmo tipo de layout fora de
  // ordem (ver extratoEmployees.js) e valida vínculo contra vocabulário fechado — é o
  // sinal mais confiável que temos hoje. Só sobrescreve quando houver pelo menos um
  // salário válido; sem isso, mantém o que a página 2 achou (pode ser o único sinal
  // disponível quando o corpo não trouxe o campo "Salário:" de ninguém).
  const elegiveisCorpo = funcionariosDetalhe.filter(
    (e) =>
      e.salarioBase &&
      e.salarioBase > 0 &&
      !e.ehContribuinte &&
      !ehProLabore(null, e.vinculo) &&
      !ehEstagiario(e.vinculo)
  );
  if (elegiveisCorpo.length) {
    const soma = elegiveisCorpo.reduce((s, e) => s + e.salarioBase, 0);
    f.totais.salario_contrib_empregados = Number(soma.toFixed(2));
  }

  // Leva o vínculo/salário de cada pessoa até `employees` — é lá, não aqui, que o
  // filtro do 13º/férias decide quem é elegível (ver sincronizarEmployeesDoExtrato
  // acima). Nunca deixa a leitura do extrato inteira falhar por causa disto: dado de
  // cadastro é secundário ao snapshot financeiro, que é o que fecha a conferência.
  try {
    await sincronizarEmployeesDoExtrato(db, companyId, funcionariosDetalhe);
  } catch (err) {
    console.warn(`[folhaKpi] ${competencia}: falha ao sincronizar employees:`, err.message);
  }

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
        faltas_dias, faltas_dias_dsr, conferido, problemas, causa, diagnostico, origem_quadro,
        salario_contrib_empregados)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
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
       salario_contrib_empregados = EXCLUDED.salario_contrib_empregados,
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
      f.totais.salario_contrib_empregados,
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
 * Usa `employees` filtrado por `funcionarioRealSql` (exclui pró-labore quando cargo
 * está preenchido). Quando `salario_base` está vazio, estima pela média da folha
 * (proventos / empregados do snapshot). Quando `employees` está vazio, estima pelo
 * snapshot: cria N linhas sintéticas onde N = `empregados` do snapshot.
 *
 * Não usa vacation_periods como fonte — ela pode ter menos nomes que o quadro real
 * (nem todo período está registrado ao mesmo tempo).
 */
async function projecaoDecimoTerceiro(db, { companyId = null, ano = new Date().getFullYear() } = {}) {
  const params = [];
  let filtro = "";
  if (companyId) {
    params.push(companyId);
    filtro = `AND e.company_id = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT e.name AS nome, e.salario_base, e.company_id,
            to_char(e.admissao, 'YYYY-MM-DD') AS admissao
       FROM employees e
      WHERE ${funcionarioRealSql("e")} ${filtro}
      ORDER BY e.name`,
    params
  );

  // Fallback: quem não tem salario_base individual, usa média da folha da empresa
  const semSalario = rows.filter((r) => !r.salario_base || Number(r.salario_base) <= 0);
  if (semSalario.length > 0) {
    const empresasIds = [...new Set(semSalario.map((r) => r.company_id))];
    for (const cid of empresasIds) {
      const media = await mediaSalarialDaEmpresa(db, cid);
      if (media) {
        for (const r of rows) {
          if (r.company_id === cid && (!r.salario_base || Number(r.salario_base) <= 0)) {
            r.salario_base = media;
          }
        }
      }
    }
  }

  // Se employees está vazio mas há snapshot, criar linhas genéricas baseadas no quadro
  if (!rows.length && companyId) {
    const { rows: snap } = await db.query(
      `SELECT proventos, empregados, salario_contrib_empregados FROM payroll_snapshots
        WHERE company_id = $1 AND proventos > 0
        ORDER BY competencia DESC LIMIT 1`,
      [companyId]
    );
    if (snap.length) {
      const empregados = Number(snap[0].empregados) || 0;
      // Mesma correção da média: o Total Geral inclui o pró-labore do diretor.
      const baseCLT = Number(snap[0].salario_contrib_empregados);
      const proventos =
        Number.isFinite(baseCLT) && baseCLT > 0 ? baseCLT : Number(snap[0].proventos);
      // Usar o quadro do snapshot como número de CLT
      const n = empregados > 0 ? empregados : 1;
      const media = proventos / n;
      if (Number.isFinite(media) && media > 0) {
        for (let i = 0; i < n; i++) {
          rows.push({
            nome: `Funcionário ${i + 1}`,
            salario_base: media,
            admissao: null,
            company_id: companyId,
          });
        }
      }
    }
  }

  return projetar({ funcionarios: rows, ano });
}

/**
 * Média salarial de CLT da empresa. Usa `empregados` do snapshot como divisor
 * (que no Domínio já exclui diretores/pró-labore do quadro de situações).
 * Se `empregados` é nulo, usa COUNT de employees ativos como fallback.
 */
async function mediaSalarialDaEmpresa(db, companyId) {
  const { rows: snap } = await db.query(
    `SELECT proventos, empregados, salario_contrib_empregados FROM payroll_snapshots
      WHERE company_id = $1 AND proventos > 0
      ORDER BY competencia DESC LIMIT 1`,
    [companyId]
  );
  if (!snap.length) return null;
  // `proventos` é o Total Geral e SOMA o pró-labore do diretor. Usá-lo como base da
  // média entregava ao empregado CLT o salário do sócio: no ALZIRÃO (07/2026) daria
  // 3.242,00 para um empregado que ganha 1.621,00 — 13º e férias projetados no dobro.
  // `salario_contrib_empregados` é a linha do extrato que já exclui os contribuintes.
  // Sem ela (extrato antigo, ainda não reprocessado), cai no Total Geral como antes.
  const base = Number(snap[0].salario_contrib_empregados);
  const proventos = Number.isFinite(base) && base > 0 ? base : Number(snap[0].proventos);
  const empregados = Number(snap[0].empregados);
  if (empregados > 0) {
    const media = proventos / empregados;
    if (Number.isFinite(media) && media > 0) return media;
  }
  // empregados NULL: usar COUNT de employees ativos (melhor esforço)
  const { rows: qtd } = await db.query(
    `SELECT COUNT(*)::int AS total FROM employees e
      WHERE e.company_id = $1 AND ${funcionarioRealSql("e")}`,
    [companyId]
  );
  const total = qtd[0]?.total || 0;
  if (total > 0) {
    const media = proventos / total;
    if (Number.isFinite(media) && media > 0) return media;
  }
  return null;
}

module.exports = {
  gravarSnapshot,
  reprocessarExtratos,
  serie,
  projecaoDecimoTerceiro,
  // Exportada para as férias usarem a MESMA média do 13º. Havia uma cópia em
  // routes/vacations.js, e foi a cópia que ficou para trás quando a base passou a
  // excluir o pró-labore: o 13º corrigiu, as férias continuaram no dobro.
  mediaSalarialDaEmpresa,
};
