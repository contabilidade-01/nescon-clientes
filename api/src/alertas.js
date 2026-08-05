/**
 * Alertas de vencimento: o que cada empresa recebe e o que sai num dia.
 *
 * Aqui é só banco — a decisão está em `alertasRegras.js` e a data em `obrigacoes.js`.
 *
 * O módulo NÃO envia nada. Ele responde "quem deve ser avisado hoje e com que texto";
 * quem entrega a mensagem é outro passo, de propósito: enquanto o canal de WhatsApp
 * ainda vive no sistema de guias, o portal já pode montar, revisar e registrar o aviso
 * sem depender dele.
 */
const { funcionarioRealSql, ehProLabore } = require("./payrollRoles");
const { OBRIGACOES, obrigacao, ehObrigacaoValida, obrigacoesQueVencemEm } = require("./obrigacoes");
const {
  decidirAutomaticas,
  sugerirPorEntregas,
  textoDaEvidencia,
  montarMensagemAlerta,
} = require("./alertasRegras");
const { hojeSP, somarDias } = require("./diasBancarios");
const { trechoDeIncentivo } = require("./engagement");
const numeroWpp = require("./whatsappNumero");

function portalUrl(caminho = "/") {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${caminho}` : null;
}

/**
 * Os três sinais que decidem a marcação automática, numa consulta só por empresa.
 * `cargo` nulo conta como funcionário — mesma tolerância do payrollRoles.js: errar
 * marcando um alerta a mais é barato; errar para menos deixa o cliente sem aviso.
 */
async function retratoDasEmpresas(db, companyId = null) {
  const params = [];
  let filtro = "";
  if (companyId) {
    params.push(companyId);
    filtro = "WHERE c.id = $1";
  }
  const { rows } = await db.query(
    `SELECT c.id,
            EXISTS (SELECT 1 FROM employees e
                     WHERE e.company_id = c.id AND ${funcionarioRealSql("e")}) AS tem_funcionario,
            EXISTS (SELECT 1 FROM employees e
                     WHERE e.company_id = c.id AND e.active IS TRUE) AS tem_alguem_na_folha,
            EXISTS (SELECT 1 FROM deliverables d
                     WHERE d.company_id = c.id AND d.doc_type = 'DAS') AS tem_das
       FROM companies c
       ${filtro}`,
    params
  );
  return rows.map((r) => ({
    companyId: r.id,
    temFuncionario: r.tem_funcionario,
    // Pró-labore = tem gente na folha, mas nenhum celetista.
    temProLabore: r.tem_alguem_na_folha && !r.tem_funcionario,
    temDasNoPortal: r.tem_das,
  }));
}

/**
 * Aplica as marcações automáticas.
 *
 * `ON CONFLICT DO NOTHING` é o ponto central: se já existe linha para (empresa,
 * obrigação) — marcada OU desmarcada pelo admin — a regra não encosta. A decisão
 * humana é sempre a última palavra, inclusive o "não".
 */
async function aplicarAutomaticas(db, companyId = null) {
  const retratos = await retratoDasEmpresas(db, companyId);
  let criadas = 0;
  for (const r of retratos) {
    for (const a of decidirAutomaticas(r)) {
      const { rowCount } = await db.query(
        `INSERT INTO company_obligations (company_id, obrigacao, ativo, origem, observacao)
         VALUES ($1, $2, true, 'auto', $3)
         ON CONFLICT (company_id, obrigacao) DO NOTHING`,
        [r.companyId, a.codigo, a.motivo]
      );
      criadas += rowCount;
    }
  }
  return { empresas: retratos.length, marcacoes_criadas: criadas };
}

/** Obrigações marcadas + recusadas + sugestões de uma empresa. É a tela de detalhe. */
async function detalheDaEmpresa(db, companyId) {
  const { rows: empresa } = await db.query(
    `SELECT id, name, cnpj, whatsapp, alertas_ativos, incentivo_ativo
       FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!empresa.length) return null;

  const { rows: decisoes } = await db.query(
    `SELECT obrigacao, ativo, origem, observacao, atualizado_em
       FROM company_obligations WHERE company_id = $1`,
    [companyId]
  );

  const { rows: entregas } = await db.query(
    `SELECT doc_type, title, competencia
       FROM deliverables
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT 500`,
    [companyId]
  );

  const decididas = decisoes.map((d) => d.obrigacao);
  const sugestoes = sugerirPorEntregas(entregas, decididas).map((s) => ({
    ...s,
    evidencia: textoDaEvidencia(s),
  }));

  const porCodigo = new Map(decisoes.map((d) => [d.obrigacao, d]));
  const catalogo = OBRIGACOES.map((o) => {
    const d = porCodigo.get(o.codigo);
    return {
      codigo: o.codigo,
      nome: o.nome,
      esfera: o.esfera,
      avisar_dias_antes: o.avisarDiasAntes,
      marcada: d ? d.ativo : false,
      decidida: Boolean(d),
      origem: d?.origem ?? null,
      observacao: d?.observacao ?? null,
      sugerida: sugestoes.some((s) => s.codigo === o.codigo),
    };
  });

  return { empresa: empresa[0], obrigacoes: catalogo, sugestoes };
}

/** Marca/desmarca. Sempre vira 'manual': quem clicou foi gente. */
async function decidir(db, companyId, codigo, ativo, observacao = null) {
  if (!ehObrigacaoValida(codigo)) return null;
  const { rows } = await db.query(
    `INSERT INTO company_obligations (company_id, obrigacao, ativo, origem, observacao)
     VALUES ($1, $2, $3, 'manual', $4)
     ON CONFLICT (company_id, obrigacao)
     DO UPDATE SET ativo = EXCLUDED.ativo, origem = 'manual',
                   observacao = EXCLUDED.observacao, atualizado_em = now()
     RETURNING obrigacao, ativo, origem`,
    [companyId, String(codigo).toUpperCase(), Boolean(ativo), observacao]
  );
  return rows[0];
}

/** Panorama do painel: uma linha por empresa, com busca por nome/CNPJ. */
async function panorama(db, { busca = "" } = {}) {
  const params = [];
  let filtro = "";
  const termo = String(busca || "").trim();
  if (termo) {
    params.push(`%${termo.replace(/[^\w\s]/g, "")}%`);
    filtro = `WHERE (c.name ILIKE $1 OR regexp_replace(c.cnpj, '\\D', '', 'g') ILIKE $1)`;
  }
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.cnpj, c.whatsapp, c.alertas_ativos, c.incentivo_ativo,
            (SELECT count(*)::int FROM company_obligations o
              WHERE o.company_id = c.id AND o.ativo IS TRUE) AS marcadas,
            (SELECT max(s.enviado_em) FROM alert_sends s WHERE s.company_id = c.id) AS ultimo_alerta_em
       FROM companies c
       ${filtro}
      ORDER BY c.name`,
    params
  );
  return {
    total: rows.length,
    sem_marcacao: rows.filter((r) => r.marcadas === 0).length,
    sem_whatsapp: rows.filter((r) => !r.whatsapp).length,
    desligadas: rows.filter((r) => !r.alertas_ativos).length,
    empresas: rows,
  };
}

/**
 * O que sai num dia: uma mensagem por empresa, já com o texto montado.
 *
 * Roda para uma data de REFERÊNCIA (padrão: hoje). Uma obrigação entra se o alerta
 * dela cai neste dia — guias avisam na véspera (`avisarDiasAntes = 1`), o prazo do
 * salário avisa no próprio dia (`0`).
 *
 * `jaEnviados` evita repetir. Com `simular = true` nada é gravado e o incentivo não
 * é consumido — é o modo da tela de pré-visualização.
 */
async function previsao(db, { data = null, simular = true } = {}) {
  const hoje = data || hojeSP();

  const { rows: empresas } = await db.query(
    `SELECT c.id, c.name, c.cnpj, c.whatsapp, c.incentivo_ativo,
            array_remove(array_agg(o.obrigacao) FILTER (WHERE o.ativo IS TRUE), NULL) AS obrigacoes
       FROM companies c
       JOIN company_obligations o ON o.company_id = c.id
      WHERE c.alertas_ativos IS TRUE
      GROUP BY c.id
      ORDER BY c.name`
  );

  const saida = [];
  for (const e of empresas) {
    const codigos = e.obrigacoes || [];
    if (!codigos.length) continue;

    // Para cada obrigação, o dia do alerta é o vencimento menos a antecedência dela.
    // Em vez de varrer o calendário, perguntamos: o que vence em `hoje + antecedência`?
    const itens = [];
    const antecedencias = new Set(codigos.map((c) => obrigacao(c)?.avisarDiasAntes ?? 1));
    for (const dias of antecedencias) {
      const alvo = somarDias(hoje, dias);
      const doDia = codigos.filter((c) => (obrigacao(c)?.avisarDiasAntes ?? 1) === dias);
      for (const v of obrigacoesQueVencemEm(alvo, doDia)) {
        itens.push({ ...v, vencimento: alvo });
      }
    }
    if (!itens.length) continue;

    const codigosDoDia = itens.map((i) => i.codigo).sort();
    const { rows: repetido } = await db.query(
      `SELECT 1 FROM alert_sends
        WHERE company_id = $1 AND dia_alerta = $2 AND obrigacoes = $3 LIMIT 1`,
      [e.id, hoje, codigosDoDia.join(",")]
    );
    if (repetido.length) continue;

    // Marca quais têm guia no portal: sem guia, não adianta mandar o cliente lá.
    const { rows: comGuia } = await db.query(
      `SELECT DISTINCT doc_type FROM deliverables
        WHERE company_id = $1 AND released_at IS NOT NULL AND doc_type IS NOT NULL`,
      [e.id]
    );
    const tipos = new Set(comGuia.map((r) => r.doc_type));
    const itensFinal = itens.map((i) => ({
      ...i,
      temGuiaNoPortal: (obrigacao(i.codigo)?.docTypes || []).some((t) => tipos.has(t)),
    }));

    const incentivo = e.incentivo_ativo
      ? await trechoDeIncentivo(db, { companyId: e.id, portalUrl: portalUrl("/"), simular })
      : null;

    const texto = montarMensagemAlerta({
      empresaNome: e.name,
      hoje,
      itens: itensFinal,
      portalUrl: portalUrl("/"),
      incentivo: incentivo?.texto ?? null,
    });

    saida.push({
      company_id: e.id,
      empresa: e.name,
      cnpj: e.cnpj,
      whatsapp: e.whatsapp,
      dia_alerta: hoje,
      // O mais próximo, quando a mensagem junta vencimentos de dias diferentes.
      vencimento: itensFinal.map((i) => i.vencimento).sort()[0],
      obrigacoes: codigosDoDia,
      incentivo_id: incentivo?.id ?? null,
      texto,
    });
  }

  return { data: hoje, total: saida.length, mensagens: saida };
}

/**
 * Registra que a mensagem saiu. O índice único é a trava real contra duplicidade:
 * se duas execuções correrem juntas, a segunda bate no conflito e não vira envio.
 */
async function registrarEnvio(db, { companyId, obrigacoes, diaAlerta, texto, incentivoId = null }) {
  const { rows } = await db.query(
    `INSERT INTO alert_sends (company_id, obrigacoes, dia_alerta, texto, incentivo_message_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, dia_alerta, obrigacoes) DO NOTHING
     RETURNING id`,
    [companyId, [...obrigacoes].sort().join(","), diaAlerta, texto, incentivoId]
  );
  return rows[0] ?? null;
}

/** Preferências por empresa: o desligamento de quem não gosta de mensagem. */
async function salvarPreferencias(db, companyId, { alertasAtivos, incentivoAtivo, whatsapp }) {
  const campos = [];
  const params = [companyId];
  if (alertasAtivos !== undefined) {
    params.push(Boolean(alertasAtivos));
    campos.push(`alertas_ativos = $${params.length}`);
  }
  if (incentivoAtivo !== undefined) {
    params.push(Boolean(incentivoAtivo));
    campos.push(`incentivo_ativo = $${params.length}`);
  }
  if (whatsapp !== undefined) {
    // Grava já normalizado (com o 55). Assim o número no banco é o número que a uazapi
    // recebe — sem conversão espalhada por quem for enviar.
    const limpo = String(whatsapp || "").trim();
    if (limpo) {
      const v = numeroWpp.validar(limpo);
      if (!v.ok) return { erro: v.motivo };
      params.push(v.numero);
    } else {
      params.push(null);
    }
    campos.push(`whatsapp = $${params.length}`);
  }
  if (!campos.length) return null;
  const { rows } = await db.query(
    `UPDATE companies SET ${campos.join(", ")} WHERE id = $1
     RETURNING id, whatsapp, alertas_ativos, incentivo_ativo`,
    params
  );
  return rows[0] ?? null;
}

module.exports = {
  retratoDasEmpresas,
  aplicarAutomaticas,
  detalheDaEmpresa,
  decidir,
  panorama,
  previsao,
  registrarEnvio,
  salvarPreferencias,
  ehProLabore,
};
