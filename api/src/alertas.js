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
  let filtro = "";
  const termo = String(busca || "").trim();
  if (termo) {
    params.push(`%${termo.replace(/[^\w\s]/g, "")}%`);
    filtro = `WHERE (c.name ILIKE $1 OR regexp_replace(c.cnpj, '\\D', '', 'g') ILIKE $1)`;
  }
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.cnpj, c.alertas_ativos, c.incentivo_ativo,
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
 */
const BOLETO_AVISAR_DIAS_ANTES = Number(process.env.ALERTAS_BOLETO_DIAS_ANTES ?? 1);

/**
 * Cobrança do boleto VENCIDO: marcos, em dias APÓS o vencimento.
 *
 * Sem isto o aviso só saía na véspera e o boleto que vencia ficava em silêncio para
 * sempre — ou seja, justamente o que precisa de cobrança era o único que nunca era
 * cobrado, e a régua dependia de alguém lembrar de olhar a tela.
 *
 * Marcos, e não janela ("todo dia enquanto estiver vencido"), pela mesma razão do aviso
 * de férias: janela mandaria a mesma cobrança todo santo dia, e o cliente ou bloqueia o
 * número ou passa a ignorar o canal — que é pior do que não cobrar.
 *
 * Três toques (3, 10 e 30 dias) cobrem o esquecimento, a segunda chance e o caso que já
 * virou conversa de cobrança de verdade; daí em diante é assunto para uma pessoa, não
 * para uma rotina.
 */
const BOLETO_COBRANCA_DIAS_DEPOIS = (process.env.ALERTAS_BOLETO_COBRANCA_DIAS || "3,10,30")
  .split(",")
  .map((d) => Number(d.trim()))
  .filter((d) => Number.isFinite(d) && d > 0);

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
             AND ack.funcionario = vp.nome
             AND ack.limite_gozo = vp.limite_gozo
      WHERE to_char(vp.limite_gozo, 'YYYY-MM-DD') = ANY($1::text[])
        AND ack.id IS NULL
      ORDER BY vp.company_id, vp.limite_gozo, vp.nome`,
    [marcos.map((m) => m.data)]
  );

  return rows.map((f) => ({
    company_id: f.company_id,
    nome: f.nome,
    dias_direito: f.dias_direito,
    ferias_vencidas: f.ferias_vencidas,
    limite_gozo: f.limite_gozo,
    dias_restantes: porData.get(f.limite_gozo) ?? null,
    codigo: "FERIAS_LIMITE",
  }));
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
    `SELECT c.id, c.name, c.cnpj, ${whatsappSql("c")} AS whatsapp, c.incentivo_ativo,
            array_remove(array_agg(o.obrigacao) FILTER (WHERE o.ativo IS TRUE), NULL) AS obrigacoes
       FROM companies c
       JOIN company_obligations o ON o.company_id = c.id
       ${JOIN_ESPELHO}
      WHERE c.alertas_ativos IS TRUE
        -- Cliente arquivado nao recebe mais nada: nem lembrete, nem cobranca.
        AND c.arquivada IS NOT TRUE
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
  const { rows: boletosTodos } = await db.query(
    `SELECT id, company_id, title, valor_centavos,
            to_char(due_date, 'YYYY-MM-DD') AS due_date
       FROM deliverables
      WHERE category = 'boleto'
        AND status IS DISTINCT FROM 'paid'
        AND cancelado IS NOT TRUE
        AND released_at IS NOT NULL
        AND due_date IS NOT NULL
        -- Janela para trás limitada pelo ÚLTIMO marco de cobrança: sem ela, um boleto
        -- esquecido de 2024 entraria na conta todo dia sem nunca casar com um marco.
        AND due_date >= ($1::date - $2::int)
        AND historico IS NOT TRUE
      ORDER BY due_date`,
    [hoje, Math.max(0, ...BOLETO_COBRANCA_DIAS_DEPOIS, 0)]
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
    const codigos = e.obrigacoes || [];
    const temFeriasAlerta = codigos.includes("FERIAS_LIMITE");
    const boletosDaEmpresa = boletosPorEmpresa.get(e.id) || [];
    // Sem obrigação marcada a empresa ainda pode ter boleto a vencer — e boleto é
    // dívida com o escritório, o último aviso que se pode deixar de mandar.
    if (!codigos.length && !boletosDaEmpresa.length) continue;
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
          nome: f.nome,
          observacao: null,
          vencimento: f.limite_gozo,
          diasRestantes: f.dias_restantes,
        });
      }
    }

    // Boletos que vencem no dia do aviso. A data é a do próprio boleto (Cora), não de
    // regra de calendário — por isso a comparação é direta, sem catálogo no meio.
    for (const b of boletosDaEmpresa) {
      // Dois momentos, um item só:
      //  · véspera  → lembrete ("vence amanhã");
      //  · vencido  → cobrança, e só nos marcos (3/10/30 dias), nunca todo dia.
      const eLembrete = b.due_date === somarDias(hoje, BOLETO_AVISAR_DIAS_ANTES);
      const diasEmAtraso = BOLETO_COBRANCA_DIAS_DEPOIS.find(
        (d) => b.due_date === somarDias(hoje, -d)
      );
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
        diasEmAtraso: diasEmAtraso ?? null,
      });
    }

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
      if (i.codigo === "FERIAS_LIMITE") return `FERIAS_LIMITE:${i.nome}`;
      return i.codigo;
    }).sort();

    const itensFinal = itens;

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
 */
async function registrarEnvio(db, { companyId, obrigacoes, diaAlerta, texto, incentivoId = null }) {
  const { rows } = await db.query(
    `INSERT INTO alert_sends (company_id, obrigacoes, dia_alerta, texto, incentivo_message_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, dia_alerta) DO NOTHING
     RETURNING id`,
    [companyId, [...obrigacoes].sort().join(","), diaAlerta, texto, incentivoId]
  );
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
  feriasPorAvisar,
  guiasRetidas,
  registrarFalha,
  falhasRecentes,
  MARCOS_FERIAS_DIAS,
  ehProLabore,
};
