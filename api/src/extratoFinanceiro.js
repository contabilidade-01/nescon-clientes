/**
 * Leitura dos NÚMEROS do Extrato Mensal — o que alimenta o relatório gerencial.
 *
 * O `extratoEmployees.js` já lê quem está na folha (nome, CPF, código, cargo, salário).
 * Aqui saem os valores: totais da folha, encargos, afastamento e a movimentação de
 * pessoal. São coisas separadas de propósito — cadastro e dinheiro têm ciclos de vida
 * diferentes, e misturar faria uma mudança no relatório arriscar o quadro de pessoal.
 *
 * ## O formato do PDF é uma armadilha
 *
 * Usamos `pdf-parse`, que entrega o texto na ordem em que ele está no arquivo — e o
 * extrato é diagramado em DUAS COLUNAS. O resultado é que os rótulos vêm primeiro e os
 * valores depois, **na ordem inversa**:
 *
 *     "No. Empregados: Demitido: 1  13"    ->  Demitido = 1, Empregados = 13
 *     "Trabalhando: Férias: 0  12"         ->  Férias = 0,  Trabalhando = 12
 *     "Doença: Admissões: 1  0"            ->  Admissões = 1, Doença = 0
 *
 * Ler na ordem escrita trocaria **admissões por demissões** e o turnover sairia
 * espelhado — errado de um jeito que ninguém percebe olhando o gráfico. Por isso
 * `parDeColunas()` existe e tem teste próprio.
 *
 * É também o motivo do aviso de não copiar as regex do app do Lovable: lá o extrator é
 * o `unpdf`, que remonta as linhas por coordenada e não sofre disso.
 */

/** "1.234,56" -> 1234.56 · "0" -> 0 · vazio/ausente -> null (nunca zero por engano). */
function valor(txt) {
  if (txt === null || txt === undefined) return null;
  const s = String(txt).trim();
  if (!s) return null;
  const limpo = s.replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`-?[\d.]+,\d{2}|-?\d+`;

/**
 * Lê o par "RotuloA: RotuloB: valorB valorA" de uma linha de duas colunas.
 * Devolve `{ [a]: valorA, [b]: valorB }` com os nomes já na posição certa.
 */
function parDeColunas(linha, rotuloA, rotuloB) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${esc(rotuloA)}\\s*:\\s*${esc(rotuloB)}\\s*:\\s*(${NUM})\\s+(${NUM})`,
    "i"
  );
  const m = re.exec(linha);
  if (!m) return null;
  // Primeiro número = coluna da DIREITA (rótulo B). Segundo = coluna da esquerda (A).
  return { [rotuloA]: valor(m[2]), [rotuloB]: valor(m[1]) };
}

/** Procura o par em todas as linhas do texto. */
function acharPar(texto, a, b) {
  for (const linha of texto.split("\n")) {
    const r = parDeColunas(linha, a, b);
    if (r) return r;
  }
  return null;
}

/**
 * Totais da folha, do rodapé do extrato.
 *
 * Os rótulos e os valores também se separam aqui:
 *   "Total Geral Proventos: Total Geral Descontos:"
 *   "32.813,12 21.186,73"
 * — e nesta a ordem é a natural (proventos, descontos), porque os dois valores caem na
 * mesma linha seguinte. Confirmado contra o extrato real do Queijeiro (junho/2026).
 */
function extrairTotais(texto) {
  const plano = texto.replace(/[ \t]+/g, " ");
  const totais = {
    proventos: null,
    descontos: null,
    liquido: null,
    inss: null,
    fgts: null,
    base_fgts: null,
    irrf: null,
  };

  const mGeral = new RegExp(
    `Total Geral Proventos:\\s*Total Geral Descontos:\\s*\\n?\\s*(${NUM})\\s+(${NUM})`,
    "i"
  ).exec(plano);
  if (mGeral) {
    totais.proventos = valor(mGeral[1]);
    totais.descontos = valor(mGeral[2]);
  }

  const mLiq = new RegExp(`L[ií]quido Geral:\\s*(${NUM})`, "i").exec(plano);
  if (mLiq) totais.liquido = valor(mLiq[1]);

  const mInss = new RegExp(`Total INSS:\\s*(${NUM})`, "i").exec(plano);
  if (mInss) totais.inss = valor(mInss[1]);

  const mBase = new RegExp(`Base total:\\s*(${NUM})`, "i").exec(plano);
  if (mBase) totais.base_fgts = valor(mBase[1]);

  // O FGTS total não vem somado no rodapé: é a soma dos "Valor FGTS:" por funcionário.
  const fgts = [...plano.matchAll(new RegExp(`Valor FGTS:\\s*(${NUM})`, "gi"))]
    .map((m) => valor(m[1]))
    .filter((v) => v !== null);
  if (fgts.length) totais.fgts = Number(fgts.reduce((a, b) => a + b, 0).toFixed(2));

  const mIrrf = new RegExp(`Valor Total do IRRF:\\s*(?:Valor Total do IRRF:)?\\s*(${NUM})`, "i").exec(plano);
  if (mIrrf) totais.irrf = valor(mIrrf[1]);

  return totais;
}

/**
 * Movimentação de pessoal do rodapé ("Situações") — a base do turnover.
 *
 * Vem pronta do extrato, então não é preciso inferir desligamento de rubrica de
 * rescisão nem deduzir admissão comparando meses. Menos inferência, menos erro.
 */
function extrairSituacoes(texto) {
  const empregados = acharPar(texto, "No. Empregados", "Demitido");
  const trabalhando = acharPar(texto, "Trabalhando", "Férias");
  const admissoes = acharPar(texto, "Doença", "Admissões");
  const afastados = acharPar(texto, "Afastado direitos integrais", "Mandato sindical");

  return {
    empregados: empregados?.["No. Empregados"] ?? null,
    demitidos: empregados?.Demitido ?? null,
    admitidos: admissoes?.["Admissões"] ?? null,
    trabalhando: trabalhando?.Trabalhando ?? null,
    em_ferias: trabalhando?.["Férias"] ?? null,
    afastados: afastados?.["Afastado direitos integrais"] ?? null,
  };
}

/**
 * Uma rubrica de PROVENTO, com valor e quantidade.
 *
 * A linha de rubrica também é de duas colunas — provento à esquerda, desconto à direita:
 *
 *   8781 DIAS NORMAIS 870 94,70 D → P → 1.929,14 → 29,00 OUTROS DESCONTOS 94,70
 *   └ rubrica          └ desconto      └ valor    └ qtd  └ descrição do desconto
 *
 * O que interessa vem logo depois do marcador `P`: **valor e depois quantidade**. Pegar
 * os dois últimos números da linha (o caminho óbvio) devolve a coluna de DESCONTOS —
 * foi o que produziu "607 dias de afastamento" na primeira tentativa, número absurdo o
 * bastante para denunciar o erro. Nem todo erro avisa assim; daí o teste com valores
 * conferidos à mão.
 *
 * `\bP\s` não casa com o "P/" de "P/DOENCA", porque ali o P é seguido de barra.
 */
function extrairRubrica(texto, codigo, descricaoParcial = "") {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^${codigo}\\s+${esc(descricaoParcial)}[\\s\\S]*?\\bP\\s+(${NUM})\\s+(${NUM})`,
    "i"
  );
  const ocorrencias = [];
  for (const linha of texto.split("\n")) {
    const m = re.exec(linha.trim());
    if (!m) continue;
    ocorrencias.push({ valor: valor(m[1]), quantidade: valor(m[2]) });
  }
  const soma = (campo) => ocorrencias.reduce((a, o) => a + (o[campo] || 0), 0);
  return {
    ocorrencias: ocorrencias.length,
    valor: ocorrencias.length ? Number(soma("valor").toFixed(2)) : null,
    quantidade: ocorrencias.length ? Number(soma("quantidade").toFixed(2)) : null,
  };
}

/**
 * Afastamento por doença pago pela EMPRESA — os primeiros 15 dias.
 *
 * Rubrica `8870 DIAS AFAST. P/DOENCA C/DIR.INTEGRAIS`, uma por funcionário afastado.
 * É custo direto do empregador: do 16º dia em diante quem paga é o INSS, e a rubrica
 * passa a ser outra. Por isso este número responde exatamente "quanto a empresa gastou
 * com atestado no mês".
 */
function extrairAfastamentos(texto) {
  const r = extrairRubrica(texto, "8870", "DIAS AFAST");
  return { ocorrencias: r.ocorrencias, valor: r.valor, dias: r.quantidade };
}

/**
 * Uma rubrica de DESCONTO. Formato diferente do provento, e foi assim que as faltas
 * saíram zeradas na primeira tentativa — zero silencioso, o pior tipo de erro num
 * relatório, porque parece um mês sem faltas.
 *
 * A coluna da direita é:  `<código> <valor> D … <descrição> <quantidade>`
 *
 *   250 REFLEXO EXTRAS DSR 8794 266,09 D → P → 29,57 → 0,00 DIAS FALTAS DSR 4,00
 *   8792 266,09 D → DIAS FALTAS 4,00
 *
 * O valor vem logo após o código, marcado com `D`; a quantidade fecha a linha, depois
 * da descrição.
 */
function extrairDesconto(texto, codigo, descricao) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reValor = new RegExp(`(?:^|\\s)${codigo}\\s+(${NUM})\\s+D\\b`);
  // `(?!\\S)` impede "DIAS FALTAS" de casar dentro de "DIAS FALTAS DSR".
  const reQtd = new RegExp(`${esc(descricao)}(?!\\S)\\s+(${NUM})\\s*$`, "i");

  const ocorrencias = [];
  for (const bruta of texto.split("\n")) {
    const linha = bruta.trim();
    const mq = reQtd.exec(linha);
    if (!mq) continue;
    const mv = reValor.exec(linha);
    ocorrencias.push({ valor: mv ? valor(mv[1]) : null, quantidade: valor(mq[1]) });
  }
  const soma = (c) => ocorrencias.reduce((a, o) => a + (o[c] || 0), 0);
  return {
    ocorrencias: ocorrencias.length,
    valor: ocorrencias.length ? Number(soma("valor").toFixed(2)) : null,
    quantidade: ocorrencias.length ? Number(soma("quantidade").toFixed(2)) : null,
  };
}

/**
 * Faltas do mês, com o DSR **separado**.
 *
 * Somar os dois num número só inflaria o absenteísmo: o DSR perdido é *consequência* da
 * falta, não um dia a mais de ausência. Quem monta o indicador decide o que usar — mas
 * decide vendo os dois.
 */
function extrairFaltas(texto) {
  const faltas = extrairDesconto(texto, "8792", "DIAS FALTAS");
  const dsr = extrairDesconto(texto, "8794", "DIAS FALTAS DSR");
  return {
    ocorrencias: faltas.ocorrencias,
    dias: faltas.quantidade,
    dias_dsr: dsr.quantidade,
    valor_descontado:
      faltas.valor === null && dsr.valor === null
        ? null
        : Number(((faltas.valor || 0) + (dsr.valor || 0)).toFixed(2)),
  };
}

/**
 * Turnover do mês, na fórmula clássica: (admissões + demissões) / 2 ÷ quadro médio.
 *
 * Devolve `null` — não zero — quando falta o quadro. Zero afirmaria "não houve rotação",
 * e não saber é outra coisa: num relatório gerencial, um zero inventado vira decisão
 * errada.
 */
function calcularTurnover({ admitidos, demitidos, empregados }) {
  if (!empregados || empregados <= 0) return null;
  const a = Number(admitidos ?? 0);
  const d = Number(demitidos ?? 0);
  return Number((((a + d) / 2 / empregados) * 100).toFixed(2));
}

/** Tudo de uma vez, a partir do texto do PDF. */
function extrairFinanceiro(texto) {
  const totais = extrairTotais(texto);
  const situacoes = extrairSituacoes(texto);
  const afastamento = extrairAfastamentos(texto);
  const faltas = extrairFaltas(texto);
  return {
    totais,
    situacoes,
    afastamento,
    faltas,
    turnover: calcularTurnover(situacoes),
  };
}

/**
 * Confere o que foi lido. O relatório gerencial só vale se os números fecharem, então
 * um extrato que não fecha vira aviso — não linha silenciosamente errada no gráfico.
 */
function conferirFinanceiro({ totais, situacoes }) {
  const problemas = [];
  if (totais.proventos === null) problemas.push("Não achei o total de proventos.");
  if (totais.descontos === null) problemas.push("Não achei o total de descontos.");
  if (totais.liquido === null) problemas.push("Não achei o líquido geral.");
  if (
    totais.proventos !== null &&
    totais.descontos !== null &&
    totais.liquido !== null &&
    Math.abs(totais.proventos - totais.descontos - totais.liquido) > 0.05
  ) {
    problemas.push(
      `Proventos − descontos (${(totais.proventos - totais.descontos).toFixed(2)}) ` +
        `não bate com o líquido (${totais.liquido.toFixed(2)}).`
    );
  }
  if (situacoes.empregados === null) problemas.push("Não achei o número de empregados.");
  return { ok: problemas.length === 0, problemas };
}

module.exports = {
  valor,
  parDeColunas,
  extrairTotais,
  extrairSituacoes,
  extrairRubrica,
  extrairDesconto,
  extrairAfastamentos,
  extrairFaltas,
  calcularTurnover,
  extrairFinanceiro,
  conferirFinanceiro,
};
