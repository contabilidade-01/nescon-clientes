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
const { funcionarioRealSql, funcionarioFeriasSql, ehProLabore } = require("./payrollRoles");
const { OBRIGACOES, obrigacao, ehObrigacaoValida, obrigacoesQueVencemEm } = require("./obrigacoes");
const {
  decidirAutomaticas,
  sugerirPorEntregas,
  textoDaEvidencia,
  montarMensagemAlerta,
} = require("./alertasRegras");
const { hojeSP, somarDias, ehDiaBancario, proximoDiaBancario } = require("./diasBancarios");
const { lerConfig } = require("./alertasConfig");
const { trechoDeIncentivo } = require("./engagement");
const numeroWpp = require("./whatsappNumero");

/**
 * O telefone do cliente, em SQL, com fonte única de verdade.
 *
 * O cadastro vive no G-Click e chega pelo espelho `gclick_clients`. O campo
 * `companies.whatsapp` é só a exceção manual — cliente que pediu para receber noutro
 * número, ou empresa que ainda não veio pelo espelho.
 *
 * Antes eram dois cadastros paralelos: quando o cliente trocasse de número e só um
 * fosse atualizado, metade das mensagens parava de chegar e o sintoma pareceria
 * aleatório. Com COALESCE há um lugar certo para corrigir e um só para consultar.
 */
function whatsappSql(aliasCompany = "c") {
  return `COALESCE(NULLIF(${aliasCompany}.whatsapp, ''), g.phone)`;
}

/** JOIN que acompanha `whatsappSql`. */
const JOIN_ESPELHO = `LEFT JOIN gclick_clients g ON g.company_id = c.id`;

function portalUrl(caminho = "/") {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${caminho}` : null;
}

/**
 * Os sinais que decidem a marcação automática, numa consulta só por empresa.
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
            -- Celetista OU estagiário: os dois têm direito a férias/recesso por lei —
            -- é o mesmo filtro do cálculo de férias (funcionarioFeriasSql), só exclui
            -- pró-labore/diretor.
            EXISTS (SELECT 1 FROM employees e
                     WHERE e.company_id = c.id AND ${funcionarioFeriasSql("e")}) AS tem_direito_ferias,
            -- Guia de carga histórica não serve de prova para marcar sozinho: uma empresa
            -- que saiu do Simples em março ainda tem DAS de janeiro no arquivo, e a regra
            -- passaria a alertá-la de um tributo que ela não recolhe mais.
            EXISTS (SELECT 1 FROM deliverables d
                     WHERE d.company_id = c.id AND d.doc_type = 'DAS'
                       AND d.historico IS NOT TRUE) AS tem_das
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
    temDireitoFerias: r.tem_direito_ferias,
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
    `SELECT c.id, c.name, c.cnpj, c.alertas_ativos, c.incentivo_ativo,
            c.avisos_gerais_ativos, c.boleto_lembrete_ativo, c.boleto_cobranca_ativo,
            c.honorario_cobranca_ativo,
            c.whatsapp AS whatsapp_manual,
            ${whatsappSql("c")} AS whatsapp,
            g.phone AS whatsapp_gclick,
            c.avisos_documentos_ativos, c.avisos_alterados_em
       FROM companies c ${JOIN_ESPELHO}
      WHERE c.id = $1`,
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
  // Arquivada/excluída não aparece na lista de alertas: o contrato acabou, então não é
  // mais candidata a receber nada — e a `previsao` (o envio real) já as ignora. Sem este
  // filtro, a tela ainda as contava e mostrava, divergindo do que de fato é enviado.
  const condicoes = ["c.arquivada IS NOT TRUE", "c.excluida IS NOT TRUE"];
  const termo = String(busca || "").trim();
  if (termo) {
    params.push(`%${termo.replace(/[^\w\s]/g, "")}%`);
    condicoes.push(`(c.name ILIKE $1 OR regexp_replace(c.cnpj, '\\D', '', 'g') ILIKE $1)`);
  }
  const filtro = `WHERE ${condicoes.join(" AND ")}`;
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.cnpj, c.alertas_ativos, c.incentivo_ativo,
            c.avisos_gerais_ativos, c.boleto_lembrete_ativo, c.boleto_cobranca_ativo,
            c.whatsapp AS whatsapp_manual,
            ${whatsappSql("c")} AS whatsapp,
            g.phone AS whatsapp_gclick,
            -- Escolha do cliente. O escritório precisa VER, e não pode desfazer daqui.
            c.avisos_documentos_ativos, c.avisos_alterados_em,
            (SELECT count(*)::int FROM company_obligations o
              WHERE o.company_id = c.id AND o.ativo IS TRUE) AS marcadas,
            (SELECT count(*)::int FROM vacation_alert_acks a
              WHERE a.company_id = c.id) AS ferias_dispensadas,
            (SELECT max(s.enviado_em) FROM alert_sends s WHERE s.company_id = c.id) AS ultimo_alerta_em
       FROM companies c
       ${JOIN_ESPELHO}
       ${filtro}
      ORDER BY c.name`,
    params
  );
  return {
    total: rows.length,
    sem_marcacao: rows.filter((r) => r.marcadas === 0).length,
    sem_whatsapp: rows.filter((r) => !r.whatsapp).length,
    desligadas: rows.filter((r) => !r.alertas_ativos).length,
    // Quem PEDIU para não receber aviso de documento. É número de vontade do cliente,
    // não de configuração — por isso aparece separado das desligadas pelo escritório.
    recusaram_documentos: rows.filter((r) => !r.avisos_documentos_ativos).length,
    empresas: rows,
  };
}

/**
 * Marcos do aviso de férias: só nestes dias exatos antes do limite sai mensagem.
 *
 * A régua tem de ser por MARCO, e não por janela ("faltam 90 dias ou menos"). Com
 * janela, o mesmo funcionário entraria na lista todo santo dia — e como a chave de
 * duplicidade inclui o dia do alerta, o cliente receberia o mesmo aviso 90 vezes
 * seguidas. Quatro avisos em três meses lembram; noventa fazem bloquear o número.
 */
const MARCOS_FERIAS_DIAS = [90, 60, 30, 15];

/**
 * Antecedência do aviso de BOLETO do escritório, em dias.
 *
 * Mesma régua das guias (véspera) por um motivo prático: boleto e imposto chegam na
 * mesma mensagem do dia, e avisar em dias diferentes obrigaria o cliente a juntar duas
 * conversas para saber o que sai da conta dele amanhã.
 *
 * Não vira obrigação de catálogo (`obrigacoes.js`) de propósito: catálogo é regra fiscal
 * recorrente, com vencimento derivado do calendário. Boleto tem data própria, vinda da
 * Cora — quem manda é a linha em `deliverables`, não uma regra.
 *
 * A antecedência do lembrete e os marcos de cobrança do vencido agora vêm da TELA
 * (alertasConfig.js: `boleto_dias_antes` e `boleto_cobranca_dias`), lidos em runtime
 * dentro de `previsao`. O ambiente (ALERTAS_BOLETO_*) segue como valor inicial/padrão.
 *
 * Cobrança do boleto VENCIDO em MARCOS (ex.: 3, 10 e 30 dias), não em janela ("todo dia
 * enquanto vencido"): janela mandaria a mesma cobrança todo santo dia, e o cliente ou
 * bloqueia o número ou ignora o canal — pior do que não cobrar. Três toques cobrem o
 * esquecimento, a segunda chance e o caso que já virou cobrança de verdade; daí em diante
 * é assunto para uma pessoa, não para uma rotina.
 */

/**
 * Funcionários cujo limite de gozo cai exatamente num dos marcos.
 *
 * Lê só a **última** programação de cada empresa (mesma regra de
 * `vacationImport.ultimaProgramacao`): `vacation_periods` guarda todos os uploads, e
 * somar os antigos ressuscitaria funcionário desligado e período já corrigido.
 *
 * A data sai do banco como texto (`to_char`) de propósito: `DATE` virando `Date` do
 * JavaScript é a porta de entrada do erro de fuso que desloca o dia.
 */
async function feriasPorAvisar(db, { hoje = null } = {}) {
  const dataHoje = hoje || hojeSP();
  const marcos = MARCOS_FERIAS_DIAS.map((dias) => ({ dias, data: somarDias(dataHoje, dias) }));
  const porData = new Map(marcos.map((m) => [m.data, m.dias]));

  const { rows } = await db.query(
    `SELECT vp.company_id,
            vp.codigo,
            vp.nome,
            vp.dias_direito,
            vp.ferias_vencidas,
            to_char(vp.limite_gozo, 'YYYY-MM-DD') AS limite_gozo
       FROM vacation_periods vp
       JOIN (
         SELECT DISTINCT ON (company_id) company_id, id
           FROM vacation_uploads
          ORDER BY company_id, criado_em DESC
       ) atual ON atual.id = vp.upload_id
       JOIN companies c ON c.id = vp.company_id AND c.alertas_ativos IS TRUE
       -- Dispensa do cliente: "já recebi o aviso deste funcionário". Vale só para
       -- este período; quando surgir outro limite, o aviso volta sozinho.
       LEFT JOIN vacation_alert_acks ack
              ON ack.company_id = vp.company_id
             AND ack.codigo = vp.codigo
             AND ack.limite_gozo = vp.limite_gozo
      WHERE to_char(vp.limite_gozo, 'YYYY-MM-DD') = ANY($1::text[])
        AND ack.id IS NULL
      ORDER BY vp.company_id, vp.limite_gozo, vp.nome`,
    [marcos.map((m) => m.data)]
  );

  return rows.map((f) => ({
    company_id: f.company_id,
    // Código do FUNCIONÁRIO (identidade da dispensa, única por empresa).
    func_codigo: f.codigo,
    nome: f.nome,
    dias_direito: f.dias_direito,
    ferias_vencidas: f.ferias_vencidas,
    limite_gozo: f.limite_gozo,
    dias_restantes: porData.get(f.limite_gozo) ?? null,
    // Código da OBRIGAÇÃO (sempre FERIAS_LIMITE) — não confundir com func_codigo.
    codigo: "FERIAS_LIMITE",
  }));
}

/**
 * Projeção de férias: quais avisos cairiam nos próximos N dias.
 *
 * Reutiliza `feriasPorAvisar()` dia a dia — cada chamada resolve os marcos daquele
 * dia. O resultado é granular: um registro por funcionário por dia, sorted por dia
 * e depois empresa (para a tela agrupar num timeline).
 */
async function projecaoFerias(db, { dias = 7 } = {}) {
  const hoje = hojeSP();
  const resultado = [];

  // Coleta todos os avisos dia a dia
  for (let i = 0; i < dias; i++) {
    const data = somarDias(hoje, i);
    const avisos = await feriasPorAvisar(db, { hoje: data });
    for (const aviso of avisos) {
      resultado.push({
        dia: data,
        company_id: aviso.company_id,
        funcionario: aviso.nome,
        marco_dias: aviso.dias_restantes,
        limite_gozo: aviso.limite_gozo,
        dias_restantes: aviso.dias_restantes,
      });
    }
  }

  // Busca nomes das empresas de uma vez
  const companyIds = [...new Set(resultado.map((r) => r.company_id))];
  const nomesPorId = new Map();
  if (companyIds.length) {
    const { rows } = await db.query(
      `SELECT id, name FROM companies WHERE id = ANY($1::uuid[])`,
      [companyIds]
    );
    for (const r of rows) nomesPorId.set(r.id, r.name);
  }

  // Enriquece e formata
  const avisosFinal = resultado
    .map((r) => ({
      dia: r.dia,
      dia_formatado: ddmm(r.dia),
      company_id: r.company_id,
      empresa: nomesPorId.get(r.company_id) || null,
      funcionario: r.funcionario,
      marco_dias: r.marco_dias,
      limite_gozo: r.limite_gozo,
      dias_restantes: r.dias_restantes,
    }))
    .sort((a, b) => a.dia.localeCompare(b.dia) || (a.empresa || "").localeCompare(b.empresa || ""));

  return { periodos: dias, total: avisosFinal.length, avisos: avisosFinal };
}

/**
 * Quais boletos de uma empresa entram na mensagem do dia, e em que papel.
 *
 * Função pura (sem banco) para o gating por canal ser testável em isolamento:
 *  · `lembreteOn`  → aviso de VENCIMENTO, na véspera (`hoje + diasAntes`);
 *  · `cobrancaOn`  → aviso de VENCIDO, e só nos marcos (`hoje - d`, d ∈ cobrancaDias),
 *                     nunca todo dia.
 *
 * Um boleto pode gerar no máximo um item por dia. Canal desligado simplesmente não
 * produz aquele item — é assim que "recebe vencido mas não vencimento" (ou o inverso)
 * se resolve, sem tratar o boleto como obrigação de catálogo.
 *
 * Cada boleto pode ter seus próprios marcos: honorários usam [1, 3, 5, 10, 15, 30],
 * boletos comuns usam [3, 10, 30]. O boleto sabe qual é aplicável (is_honorario).
 */

/**
 * Dias ÚTEIS (bancários) decorridos desde o vencimento. Se o vencimento cai em fim de
 * semana/feriado, conta a partir do próximo dia útil (o 1º dia em que dava para pagar).
 * Função pura: testável sem banco. Usada pela cobrança de honorário (honorariosCobranca.js)
 * como carência de compensação.
 */
function diasUteisAposVencimento(dueDate, hoje) {
  if (!dueDate || !hoje) return 0;
  const vencEfetivo = ehDiaBancario(dueDate) ? dueDate : proximoDiaBancario(dueDate);
  if (!vencEfetivo || hoje <= vencEfetivo) return 0;
  let count = 0;
  let d = somarDias(vencEfetivo, 1);
  let guarda = 0;
  while (d && d <= hoje && guarda < 400) {
    if (ehDiaBancario(d)) count += 1;
    d = somarDias(d, 1);
    guarda += 1;
  }
  return count;
}

function itensBoletoDoDia(
  boletos,
  { hoje, diasAntes, cobrancaDias, honorariosCobrancaDias, lembreteOn, cobrancaOn }
) {
  const itens = [];
  for (const b of boletos || []) {
    const eLembrete = lembreteOn && b.due_date === somarDias(hoje, diasAntes);
    // A COBRANÇA de honorário saiu deste motor: agora tem mensagem própria em 2 fases
    // (ver honorariosCobranca.js). Aqui o honorário só gera LEMBRETE (antes do
    // vencimento). A cobrança de atraso segue valendo só para BOLETO COMUM.
    const marcos = cobrancaDias || [];
    const diasEmAtraso = (cobrancaOn && !b.is_honorario)
      ? marcos.find((d) => b.due_date === somarDias(hoje, -d))
      : undefined;
    if (!eLembrete && diasEmAtraso === undefined) continue;

    itens.push({
      // O id entra na chave para dois boletos do mesmo dia não colapsarem num só na
      // trava de duplicidade — e para um não calar o outro.
      codigo: `BOLETO:${b.id}`,
      nome: b.title || "Boleto",
      observacao: null,
      vencimento: b.due_date,
      valorCentavos: b.valor_centavos,
      isBoleto: true,
      isHonorario: b.is_honorario,
      diasEmAtraso: diasEmAtraso ?? null,
    });
  }
  return itens;
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
async function previsao(db, { data = null, simular = true, diaUtil = true } = {}) {
  const hoje = data || hojeSP();
  const permitidos = [];

  // Cadência do boleto vem da tela (alertasConfig), não mais de constante de ambiente.
  const {
    boleto_dias_antes: BOLETO_AVISAR_DIAS_ANTES,
    boleto_cobranca_dias: BOLETO_COBRANCA_DIAS_DEPOIS,
    honorarios_cobranca_dias: HONORARIOS_COBRANCA_DIAS_DEPOIS
  } = await lerConfig(db);

  const { rows: empresas } = await db.query(
    `SELECT c.id, c.name, c.cnpj, ${whatsappSql("c")} AS whatsapp, c.incentivo_ativo,
            c.avisos_gerais_ativos, c.boleto_lembrete_ativo, c.boleto_cobranca_ativo,
            c.honorario_cobranca_ativo,
            array_remove(array_agg(o.obrigacao) FILTER (WHERE o.ativo IS TRUE), NULL) AS obrigacoes
       FROM companies c
       -- LEFT JOIN, não INNER: uma empresa pode não ter NENHUMA obrigação marcada e
       -- ainda assim dever boleto ao escritório. Com INNER ela sumia da previsão e o
       -- boleto nunca era cobrado — o filtro por subchave de boleto acontece no laço.
       LEFT JOIN company_obligations o ON o.company_id = c.id
       ${JOIN_ESPELHO}
      WHERE c.alertas_ativos IS TRUE
        -- Cliente arquivado nao recebe mais nada: nem lembrete, nem cobranca.
        AND c.arquivada IS NOT TRUE
        AND c.excluida IS NOT TRUE
        AND ($1::text[] IS NULL
             OR regexp_replace(c.cnpj, '\\D', '', 'g') = ANY($1::text[]))
      GROUP BY c.id, g.phone
      ORDER BY c.name`,
    [permitidos.length ? permitidos : null]
  );

  // Quem já foi avisado hoje, numa consulta só. Antes era uma por empresa: com 60
  // clientes davam 60 idas ao banco só para descobrir que quase ninguém tinha aviso.
  const { rows: jaAvisados } = await db.query(
    `SELECT company_id FROM alert_sends WHERE dia_alerta = $1::date`,
    [hoje]
  );
  const avisadosHoje = new Set(jaAvisados.map((r) => r.company_id));

  // Idem para as guias liberadas com vencimento à frente: uma consulta para a carteira,
  // agrupada em memória. O volume é de centenas de linhas, não de milhares.
  //
  // Carga histórica NUNCA entra aqui, e filtrar por data não bastaria: o due_date é lido
  // do PRÓPRIO PDF (ver gclick/sync.js), não da competência. Guia antiga retificada,
  // parcelamento ou prazo prorrogado podem gravar data futura numa linha de competência
  // velha — ela passaria no "due_date >= hoje", viraria "próxima guia" e faria dois
  // estragos: dispararia aviso de documento de arquivo e SUPRIMIRIA o alerta verdadeiro
  // daquela obrigação, porque guia encontrada manda no catálogo.
  const { rows: guiasTodas } = await db.query(
    `SELECT company_id, doc_type, to_char(due_date, 'YYYY-MM-DD') AS due_date
       FROM deliverables
      WHERE released_at IS NOT NULL
        AND doc_type IS NOT NULL AND due_date IS NOT NULL
        AND due_date >= $1::date
        AND historico IS NOT TRUE
      ORDER BY due_date`,
    [hoje]
  );
  const guiasPorEmpresa = new Map();
  for (const g of guiasTodas) {
    if (!guiasPorEmpresa.has(g.company_id)) guiasPorEmpresa.set(g.company_id, new Map());
    const m = guiasPorEmpresa.get(g.company_id);
    // A consulta vem ordenada por vencimento: o primeiro de cada tipo é o mais próximo.
    if (!m.has(g.doc_type)) m.set(g.doc_type, g.due_date);
  }

  // Boletos do escritório ainda em aberto.
  //
  // Ficavam de fora do alerta e ninguém percebia: o boleto entra em `deliverables` com
  // doc_type 'BOLETO_CORA' e passa no filtro das guias acima, mas o laço adiante só
  // percorre as obrigações do CATÁLOGO — e boleto não está lá (nem vai estar, ver
  // BOLETO_AVISAR_DIAS_ANTES). Resultado prático: o cliente era avisado do imposto do
  // governo e não do boleto do próprio escritório, que é justamente o que o escritório
  // precisa receber.
  //
  // IMPORTANTE: A trava de 48h é APENAS para boletos Cora (não-honorários), porque
  // podem estar pagos e a Cora demora para sincronizar. Para HONORÁRIOS, NÃO há trava
  // (ou é mínima — 5min) para respeitar os marcos de cobrança (1, 3, 5, 10, 15, 30 dias).
  const { rows: boletosTodos } = await db.query(
    `SELECT id, company_id, title, valor_centavos, is_honorario,
            to_char(due_date, 'YYYY-MM-DD') AS due_date
       FROM deliverables
      WHERE category = 'boleto'
        AND status IS DISTINCT FROM 'paid'
        AND cancelado IS NOT TRUE
        AND released_at IS NOT NULL
        AND due_date IS NOT NULL
        -- Janela para trás limitada pelo ÚLTIMO marco de cobrança: sem ela, um boleto
        -- esquecido de 2024 entraria na conta todo dia sem nunca casar com um marco.
        -- Para honorários, usa o marco mais longo; para boletos comuns, o outro.
        AND due_date >= ($1::date - $2::int)
        AND historico IS NOT TRUE
        -- Trava diferenciada por tipo:
        -- - Boletos comuns Cora: 48h (para não reenviar pagos de novo)
        -- - Honorários: 5min (para respeitar marcos 1, 3, 5, 10, 15, 30 dias)
        AND (
          (is_honorario IS NOT TRUE AND (alert_sent_at IS NULL OR alert_sent_at < now() - interval '48 hours'))
          OR
          (is_honorario = true AND (alert_sent_at IS NULL OR alert_sent_at < now() - interval '5 minutes'))
        )
      ORDER BY due_date`,
    [hoje, Math.max(0, ...HONORARIOS_COBRANCA_DIAS_DEPOIS, ...BOLETO_COBRANCA_DIAS_DEPOIS, 0)]
  );
  const boletosPorEmpresa = new Map();
  for (const b of boletosTodos) {
    if (!boletosPorEmpresa.has(b.company_id)) boletosPorEmpresa.set(b.company_id, []);
    boletosPorEmpresa.get(b.company_id).push(b);
  }

  // Busca única: funcionários cujo limite de férias cai num dos marcos de hoje.
  const todasFerias = await feriasPorAvisar(db, { hoje });
  const feriasPorEmpresa = new Map();
  for (const f of todasFerias) {
    if (!feriasPorEmpresa.has(f.company_id)) feriasPorEmpresa.set(f.company_id, []);
    feriasPorEmpresa.get(f.company_id).push(f);
  }

  const saida = [];
  for (const e of empresas) {
    // Subchaves por empresa (default true; ver ensureAlertasSchema). A chave geral
    // (`alertas_ativos`) já foi aplicada no WHERE — aqui é o degrau abaixo dela.
    const geraisOn = e.avisos_gerais_ativos !== false;
    const lembreteOn = e.boleto_lembrete_ativo !== false;
    const cobrancaOn = e.boleto_cobranca_ativo !== false;
    const honorarioCobrancaOn = e.honorario_cobranca_ativo !== false;

    // Avisos gerais desligados = zera tributos/guias/férias desta empresa (mas o boleto,
    // que é canal à parte, pode continuar saindo).
    const codigos = geraisOn ? e.obrigacoes || [] : [];
    const temFeriasAlerta = codigos.includes("FERIAS_LIMITE");
    // Só busca boletos se ao menos um dos dois canais está ligado.
    const boletosDaEmpresa = lembreteOn || cobrancaOn || honorarioCobrancaOn ? boletosPorEmpresa.get(e.id) || [] : [];
    // Filtrar: se a empresa desligou cobrança de honorários, não inclui is_honorario na lista
    const boletosParaAlerta = boletosDaEmpresa.filter((b) => {
      if (b.is_honorario) return honorarioCobrancaOn;
      return true;
    });
    // Sem obrigação marcada a empresa ainda pode ter boleto a vencer — e boleto é
    // dívida com o escritório, o último aviso que se pode deixar de mandar.
    if (!codigos.length && !boletosParaAlerta.length) continue;
    // Uma mensagem por cliente por dia: quem já recebeu hoje sai fora antes de qualquer
    // outra conta.
    if (avisadosHoje.has(e.id)) continue;

    // Para cada obrigação, o dia do alerta é o vencimento menos a antecedência dela.
    // Em vez de varrer o calendário, perguntamos: o que vence em `hoje + antecedência`?
    const itens = [];

    // Adicionar férias se marcadas: um alerta por funcionário com limite próximo.
    if (temFeriasAlerta) {
      for (const f of feriasPorEmpresa.get(e.id) || []) {
        itens.push({
          codigo: "FERIAS_LIMITE",
          funcCodigo: f.func_codigo,
          nome: f.nome,
          observacao: null,
          vencimento: f.limite_gozo,
          diasRestantes: f.dias_restantes,
        });
      }
    }

    // Boletos que vencem no dia do aviso. A data é a do próprio boleto (Cora), não de
    // regra de calendário — por isso a comparação é direta, sem catálogo no meio. O
    // gating por canal (lembrete/cobrança) fica em itensBoletoDoDia, função pura.
    itens.push(
      ...itensBoletoDoDia(boletosDaEmpresa, {
        hoje,
        diasAntes: BOLETO_AVISAR_DIAS_ANTES,
        cobrancaDias: BOLETO_COBRANCA_DIAS_DEPOIS,
        honorariosCobrancaDias: HONORARIOS_COBRANCA_DIAS_DEPOIS,
        lembreteOn,
        cobrancaOn,
      })
    );

    // Guias JÁ LIBERADAS com vencimento à frente.
    //
    // É daqui que sai a data quando o documento existe. O `due_date` foi lido do
    // PRÓPRIO PDF, justamente porque o do G-Click erra (ver gclick/sync.js) — então
    // ele manda no catálogo. Se o alerta usasse sempre o catálogo, o cliente leria uma
    // data no WhatsApp e outra no portal, e concluiria que o escritório se confunde.
    const proximaGuia = guiasPorEmpresa.get(e.id) || new Map();

    const tributarias = codigos.filter((c) => c !== "FERIAS_LIMITE");
    const resolvidasPorGuia = new Set();
    for (const codigo of tributarias) {
      const o = obrigacao(codigo);
      const tipo = (o?.docTypes || []).find((t) => proximaGuia.has(t));
      if (!tipo) continue;
      const venc = proximaGuia.get(tipo);
      // A guia existe: ela decide o dia do aviso, e o catálogo não palpita por cima.
      resolvidasPorGuia.add(codigo);
      if (venc !== somarDias(hoje, o.avisarDiasAntes ?? 1)) continue;
      itens.push({ codigo, nome: o.nome, observacao: null, vencimento: venc, temGuiaNoPortal: true });
    }

    // O resto sai pelo catálogo: obrigação sem guia liberada e o salário, que nunca tem.
    const pendentes = tributarias.filter((c) => !resolvidasPorGuia.has(c));
    const antecedencias = new Set(pendentes.map((c) => obrigacao(c)?.avisarDiasAntes ?? 1));
    for (const dias of antecedencias) {
      const alvo = somarDias(hoje, dias);
      const doDia = pendentes.filter((c) => (obrigacao(c)?.avisarDiasAntes ?? 1) === dias);
      for (const v of obrigacoesQueVencemEm(alvo, doDia)) {
        // `semGuia`: a obrigação tem documento, mas ele não está no portal. O cliente
        // precisa saber disso na própria mensagem — senão vai procurar e não achar.
        const semGuia = (obrigacao(v.codigo)?.docTypes || []).length > 0;
        itens.push({ ...v, vencimento: alvo, temGuiaNoPortal: false, semGuia });
      }
    }
    if (!itens.length) continue;

    // Para férias, a chave de duplicidade inclui os nomes dos funcionários alertados,
    // de modo que o mesmo conjunto não seja alertado novamente.
    const codigosDoDia = itens.map((i) => {
      // Chave por CÓDIGO do funcionário (cai no nome só se faltar código): homônimos
      // não colapsam num item só.
      if (i.codigo === "FERIAS_LIMITE") return `FERIAS_LIMITE:${i.funcCodigo ?? i.nome}`;
      return i.codigo;
    }).sort();

    // No fim de semana, remover itens de HONORÁRIO (cobrança de dívida não sai no sábado
    // nem domingo — tributos continuam porque o vencimento não espera). Isso garante que
    // a mensagem de honorários só é composta de segunda a sexta.
    const itensFinal = diaUtil
      ? itens
      : itens.filter((i) => !i.isHonorario);

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

  return {
    data: hoje,
    total: saida.length,
    mensagens: saida,
  };
}

/**
 * Guias que vencem em breve e AINDA ESTÃO RETIDAS.
 *
 * Este é o alerta do escritório, não do cliente — e provavelmente o mais valioso dos
 * dois. Documento entra retido e só o clique da liberação torna visível; se ninguém
 * liberou até a véspera, o cliente recebe "vence amanhã" e encontra o portal vazio.
 * Aqui a lista aparece a tempo de liberar.
 */
async function guiasRetidas(db, { dias = 7, hoje = null } = {}) {
  const ref = hoje || hojeSP();
  const { rows } = await db.query(
    `SELECT d.id, d.company_id, c.name AS empresa, d.doc_type, d.title, d.competencia,
            to_char(d.due_date, 'YYYY-MM-DD') AS due_date
       FROM deliverables d
       JOIN companies c ON c.id = d.company_id
      WHERE d.released_at IS NULL
        AND d.due_date IS NOT NULL
        AND d.due_date >= $1::date
        AND d.due_date <= ($1::date + $2::int)
      ORDER BY d.due_date, c.name`,
    [ref, dias]
  );
  return {
    referencia: ref,
    dias,
    total: rows.length,
    vence_amanha: rows.filter((r) => r.due_date === somarDias(ref, 1)).length,
    itens: rows,
  };
}

/**
 * Registra que a mensagem saiu. O índice único é a trava real contra duplicidade:
 * se duas execuções correrem juntas, a segunda bate no conflito e não vira envio.
 *
 * Quando a mensagem carrega BOLETO(s), o `alert_sent_at` do `deliverable` é
 * atualizado para now(). É esse campo que a query de `previsao` consulta para
 * aplicar a trava de 48h — sem isto, o boleto pago na Cora mas ainda não
 * sincronizado seria cobrado de novo na execução seguinte.
 */
async function registrarEnvio(db, { companyId, obrigacoes, diaAlerta, texto, incentivoId = null }) {
  const { rows } = await db.query(
    `INSERT INTO alert_sends (company_id, obrigacoes, dia_alerta, texto, incentivo_message_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, dia_alerta) DO NOTHING
     RETURNING id`,
    [companyId, [...obrigacoes].sort().join(","), diaAlerta, texto, incentivoId]
  );

  // Marca os boletos desta mensagem para que a trava de 48h os ignore na próxima
  // execução. O código do item é `BOLETO:<uuid>` (ver previsao()), e o id extraído
  // é o UUID do `deliverables.id`. Outros códigos (FÉRIAS, guia fiscal) não usam este
  // flag porque o `alert_sends` com chave (empresa, dia) já cobre a duplicidade.
  const idsBoletos = obrigacoes
    .filter((c) => typeof c === "string" && c.startsWith("BOLETO:"))
    .map((c) => c.slice("BOLETO:".length))
    .filter((id) => /^[a-z0-9-]{8,}$/i.test(id));
  if (idsBoletos.length) {
    await db.query(
      `UPDATE deliverables SET alert_sent_at = now() WHERE id = ANY($1::uuid[])`,
      [idsBoletos]
    );
  }

  return rows[0] ?? null;
}

/** Registra por que um cliente NÃO foi avisado. Nunca lança: é só diagnóstico. */
async function registrarFalha(db, { companyId = null, diaAlerta, motivo, tipo = "falhou" }) {
  try {
    await db.query(
      `INSERT INTO alert_failures (company_id, dia_alerta, motivo, tipo) VALUES ($1, $2, $3, $4)`,
      [companyId, diaAlerta, String(motivo || "").slice(0, 500), tipo]
    );
  } catch (err) {
    console.error("[alertas] não consegui registrar a falha:", err.message);
  }
}

/** As falhas recentes, para o painel mostrar sem ninguém abrir log de contentor. */
async function falhasRecentes(db, { limite = 50 } = {}) {
  const { rows } = await db.query(
    `SELECT f.id, f.company_id, c.name AS empresa, f.motivo, f.tipo,
            to_char(f.dia_alerta, 'YYYY-MM-DD') AS dia_alerta, f.criado_em
       FROM alert_failures f
       LEFT JOIN companies c ON c.id = f.company_id
      ORDER BY f.criado_em DESC
      LIMIT $1`,
    [Math.min(200, Math.max(1, limite))]
  );
  return { total: rows.length, falhas: rows };
}

/**
 * Dashboard de falhas: resumo visual (últimas 48h) + histórico recente.
 *
 * Agrega por tipo (ignorado/falhou/adiado/interrompido) e inclui a lista de empresas
 * afetadas com motivo — o escritório vê de um olhar quantas precisam de atenção.
 */
async function dashboardFalhas(db) {
  // Contagem por tipo nas últimas 48h
  const { rows: porTipo } = await db.query(`
    SELECT tipo, count(*)::int AS total
      FROM alert_failures
     WHERE criado_em >= now() - interval '48 hours'
     GROUP BY tipo
     ORDER BY total DESC
  `);

  // Total de empresas distintas afetadas nas últimas 48h
  const { rows: empresasAfetadas } = await db.query(`
    SELECT count(DISTINCT company_id)::int AS total
      FROM alert_failures
     WHERE criado_em >= now() - interval '48 hours'
       AND company_id IS NOT NULL
  `);

  // Últimos envios bem-sucedidos nas últimas 24h (pra mostrar que o motor está saudável)
  const { rows: ultimosEnvios } = await db.query(`
    SELECT count(*)::int AS total
      FROM alert_sends
     WHERE enviado_em >= now() - interval '24 hours'
  `);

  // Falhas detalhadas das últimas 48h, agrupadas por empresa + motivo (dedup)
  const { rows: detalhe } = await db.query(`
    SELECT f.company_id, c.name AS empresa, f.motivo, f.tipo,
           max(f.criado_em) AS ultima_vez, count(*)::int AS vezes
      FROM alert_failures f
      LEFT JOIN companies c ON c.id = f.company_id
     WHERE f.criado_em >= now() - interval '48 hours'
     GROUP BY f.company_id, c.name, f.motivo, f.tipo
     ORDER BY ultima_vez DESC
     LIMIT 100
  `);

  return {
    periodo: "48h",
    resumo: {
      total_falhas: porTipo.reduce((s, r) => s + r.total, 0),
      por_tipo: porTipo,
      empresas_afetadas: empresasAfetadas[0]?.total ?? 0,
      envios_24h: ultimosEnvios[0]?.total ?? 0,
    },
    detalhe,
  };
}

/** Preferências por empresa: o desligamento de quem não gosta de mensagem. */
async function salvarPreferencias(
  db,
  companyId,
  {
    alertasAtivos,
    incentivoAtivo,
    avisosGeraisAtivos,
    boletoLembreteAtivo,
    boletoCobrancaAtivo,
    honorarioCobrancaAtivo,
    whatsapp,
  }
) {
  const campos = [];
  const params = [companyId];
  const flag = (valor, coluna) => {
    if (valor === undefined) return;
    params.push(Boolean(valor));
    campos.push(`${coluna} = $${params.length}`);
  };
  flag(alertasAtivos, "alertas_ativos");
  flag(incentivoAtivo, "incentivo_ativo");
  flag(avisosGeraisAtivos, "avisos_gerais_ativos");
  flag(boletoLembreteAtivo, "boleto_lembrete_ativo");
  flag(boletoCobrancaAtivo, "boleto_cobranca_ativo");
  flag(honorarioCobrancaAtivo, "honorario_cobranca_ativo");
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
     RETURNING id, whatsapp, alertas_ativos, incentivo_ativo,
               avisos_gerais_ativos, boleto_lembrete_ativo, boleto_cobranca_ativo,
               honorario_cobranca_ativo`,
    params
  );
  return rows[0] ?? null;
}

/**
 * Aplica as MESMAS subchaves a várias empresas de uma vez — o "marcar todos".
 *
 * `companyIds` vazio/ausente = carteira inteira; preenchido = só essas. Só as flags
 * passadas são tocadas (as demais ficam como estão em cada empresa). WhatsApp fica de
 * fora de propósito: número é dado por empresa, não faz sentido em lote.
 */
async function salvarPreferenciasLote(db, campos = {}, companyIds = null) {
  const sets = [];
  const params = [];
  const flag = (valor, coluna) => {
    if (valor === undefined) return;
    params.push(Boolean(valor));
    sets.push(`${coluna} = $${params.length}`);
  };
  flag(campos.alertas_ativos, "alertas_ativos");
  flag(campos.incentivo_ativo, "incentivo_ativo");
  flag(campos.avisos_gerais_ativos, "avisos_gerais_ativos");
  flag(campos.boleto_lembrete_ativo, "boleto_lembrete_ativo");
  flag(campos.boleto_cobranca_ativo, "boleto_cobranca_ativo");
  flag(campos.honorario_cobranca_ativo, "honorario_cobranca_ativo");
  if (!sets.length) return { atualizadas: 0 };

  const ids = Array.isArray(companyIds) ? companyIds.filter(Boolean) : null;
  let where = "";
  if (ids && ids.length) {
    params.push(ids);
    where = `WHERE id = ANY($${params.length}::uuid[])`;
  }
  const { rowCount } = await db.query(
    `UPDATE companies SET ${sets.join(", ")} ${where}`,
    params
  );
  return { atualizadas: rowCount };
}

/** Limpar decisão manual — voltar a deixar sistema auto-decidir. */
async function limparDecisaoManual(db, companyId, codigo) {
  if (!ehObrigacaoValida(codigo)) return null;
  const { rowCount } = await db.query(
    `DELETE FROM company_obligations WHERE company_id = $1 AND obrigacao = $2`,
    [companyId, String(codigo).toUpperCase()]
  );
  return { deletado: rowCount > 0 };
}

module.exports = {
  retratoDasEmpresas,
  aplicarAutomaticas,
  detalheDaEmpresa,
  decidir,
  panorama,
  previsao,
  itensBoletoDoDia,
  diasUteisAposVencimento,
  registrarEnvio,
  salvarPreferencias,
  salvarPreferenciasLote,
  feriasPorAvisar,
  projecaoFerias,
  guiasRetidas,
  registrarFalha,
  falhasRecentes,
  dashboardFalhas,
  limparDecisaoManual,
  MARCOS_FERIAS_DIAS,
  ehProLabore,
  whatsappSql,
  JOIN_ESPELHO,
};
