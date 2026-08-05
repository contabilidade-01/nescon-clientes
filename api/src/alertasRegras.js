/**
 * Regras do alerta de vencimento: quem se marca sozinho, o que é só sugestão, e como
 * fica o texto que chega no WhatsApp do cliente.
 *
 * Funções puras, sem banco — é o miolo testável do módulo. O acesso a dados fica em
 * `alertas.js`.
 *
 * A divisão entre AUTOMÁTICA e SUGERIDA é a decisão de projeto mais importante aqui:
 *
 * - **Automática** só onde o sinal é inequívoco. Tem funcionário celetista ⇒ tem FGTS
 *   e tem prazo de salário, sem exceção. Tem alguém na folha (mesmo só o sócio) ⇒ tem
 *   INSS na DCTF Web. Tem DAS no portal ⇒ é optante pelo Simples.
 * - **Sugerida** no resto. Uma guia de ICMS num mês não prova recolhimento mensal, e
 *   marcar sozinho faria o cliente receber alerta de tributo que ele não paga — o tipo
 *   de erro que queima a confiança no canal inteiro.
 *
 * Em nenhum dos dois casos a regra passa por cima do admin: decisão gravada à mão
 * (`origem = 'manual'`) é definitiva, inclusive a negativa.
 */
const { OBRIGACOES, obrigacao } = require("./obrigacoes");
const { ddmm } = require("./diasBancarios");

/**
 * O que marcar sozinho, dado o retrato da empresa.
 *
 * Devolve os códigos com o motivo — o motivo aparece na tela, para o escritório
 * entender por que aquilo veio marcado sem ninguém ter clicado.
 */
function decidirAutomaticas({ temFuncionario = false, temProLabore = false, temDasNoPortal = false } = {}) {
  const sinais = {
    funcionario: Boolean(temFuncionario),
    funcionario_ou_prolabore: Boolean(temFuncionario || temProLabore),
    das_no_portal: Boolean(temDasNoPortal),
  };
  const motivos = {
    funcionario: "a empresa tem funcionário registrado",
    funcionario_ou_prolabore: temFuncionario
      ? "a empresa tem funcionário registrado"
      : "a empresa tem pró-labore na folha",
    das_no_portal: "há guia de DAS entre as entregas da empresa",
  };

  return OBRIGACOES.filter((o) => o.auto && sinais[o.auto]).map((o) => ({
    codigo: o.codigo,
    nome: o.nome,
    motivo: motivos[o.auto],
  }));
}

/**
 * Sugestões a partir do que já está no portal do cliente.
 *
 * `entregas` = [{ doc_type, title, competencia, due_date }] — as guias da empresa.
 * `decididas` = Set/array de códigos que o admin (ou a regra) já resolveu; esses saem
 * da lista, inclusive os recusados, senão a mesma sugestão volta todo mês.
 */
function sugerirPorEntregas(entregas = [], decididas = []) {
  const jaResolvidas = new Set(Array.from(decididas));
  const achados = new Map();

  for (const e of entregas) {
    const tipo = String(e?.doc_type || "");
    const titulo = String(e?.title || "");
    for (const o of OBRIGACOES) {
      if (jaResolvidas.has(o.codigo)) continue;
      // Sugestão automática já é marcação: não faz sentido sugerir o que se marca só.
      if (o.auto) continue;
      // Entrega JÁ CLASSIFICADA só casa pelo tipo. O padrão de texto existe para o que
      // o G-Click não classificou — usá-lo numa guia classificada gera falso positivo
      // garantido: o título da DCTF Web é literalmente "INSS (DCTF Web)", e o padrão da
      // GPS (/INSS|GPS/) casaria com ele, sugerindo GPS para toda empresa com folha.
      const casaTipo = o.docTypes.includes(tipo);
      const casaTexto = !tipo && o.padrao ? o.padrao.test(titulo) : false;
      if (!casaTipo && !casaTexto) continue;

      const atual = achados.get(o.codigo) || {
        codigo: o.codigo,
        nome: o.nome,
        esfera: o.esfera,
        ocorrencias: 0,
        ultima_competencia: null,
        exemplo: null,
      };
      atual.ocorrencias += 1;
      // Guarda a competência mais recente: é o que responde "isso ainda acontece?".
      if (e?.competencia && (!atual.ultima_competencia || e.competencia > atual.ultima_competencia)) {
        atual.ultima_competencia = e.competencia;
      }
      if (!atual.exemplo) atual.exemplo = titulo || tipo;
      achados.set(o.codigo, atual);
    }
  }

  return Array.from(achados.values()).sort((a, b) => b.ocorrencias - a.ocorrencias);
}

/** Frase curta explicando de onde veio a sugestão. Vai na tela, ao lado do botão. */
function textoDaEvidencia(s) {
  const vezes = s.ocorrencias === 1 ? "1 guia encontrada" : `${s.ocorrencias} guias encontradas`;
  const quando = s.ultima_competencia ? `, a última em ${s.ultima_competencia}` : "";
  return `${vezes} no portal${quando}.`;
}

/**
 * Junta o que vence para o cliente numa mensagem só.
 *
 * Uma mensagem por dia, nunca uma por tributo: três guias vencendo no dia 20 viram
 * três linhas, não três WhatsApps.
 *
 * `itens` = [{ codigo, nome, vencimento, observacao, temGuiaNoPortal, isFeria? }]
 * `incentivo` = texto já escolhido (ou null). Entra no fim, sem título e sem separador
 * gritante — é o cliente lendo o aviso que ele quis receber e encontrando uma frase a
 * mais no final, não um anúncio.
 */
function montarMensagemAlerta({ empresaNome = "", hoje, itens = [], portalUrl = "", incentivo = null } = {}) {
  if (!itens.length) return null;

  const ferias = itens.filter((i) => i.codigo === "FERIAS_LIMITE");
  const obrigNormais = itens.filter((i) => i.codigo !== "FERIAS_LIMITE");
  const linhas = [];

  const saudacao = empresaNome ? `Olá, ${empresaNome}!` : "Olá!";
  linhas.push(saudacao);
  linhas.push("");

  // Bloco de obrigações normais (tributos, guias)
  if (obrigNormais.length) {
    const datas = new Set(obrigNormais.map((i) => i.vencimento));
    const todasHoje = datas.size === 1 && obrigNormais[0].vencimento === hoje;

    if (todasHoje) {
      linhas.push(`*Vence hoje (${ddmm(obrigNormais[0].vencimento)}):*`);
    } else if (datas.size === 1) {
      linhas.push(`*Vence amanhã (${ddmm(obrigNormais[0].vencimento)}):*`);
    } else {
      linhas.push("*Vencimentos próximos:*");
    }

    for (const i of obrigNormais) {
      const quando = datas.size === 1 ? "" : ` — ${ddmm(i.vencimento)}`;
      linhas.push(`• ${i.nome}${quando}`);
    }
  }

  // Bloco de férias
  if (ferias.length) {
    if (obrigNormais.length) linhas.push("");
    linhas.push("*⚠️ Atenção — férias próximas do limite:*");
    for (const f of ferias) {
      // Dizer quantos dias faltam é o que transforma a data em urgência: "12/11" não
      // move ninguém em agosto; "faltam 90 dias" move.
      const faltam = f.diasRestantes ? ` (faltam ${f.diasRestantes} dias)` : "";
      linhas.push(`• ${f.nome} — limite em ${ddmm(f.vencimento)}${faltam}`);
    }
    linhas.push("");
    linhas.push("Providencie a programação para evitar passivo trabalhista.");
    // O passo a passo vai DENTRO da mensagem, não num link de descadastro.
    //
    // Um "clique aqui para não receber mais" pararia tudo com um toque, inclusive o
    // aviso do funcionário que vence daqui a três meses. Aqui a saída existe, mas
    // custa três toques e é por funcionário — quem quer parar, para; quem só está
    // com pressa, não desliga o que ainda vai precisar.
    if (portalUrl) {
      linhas.push("");
      linhas.push("_Já está resolvido? Para não receber mais este aviso:_");
      linhas.push(`_1. Entre no portal: ${portalUrl}_`);
      linhas.push("_2. Abra *Férias*_");
      linhas.push('_3. Toque em *"Já recebi este aviso"* no funcionário_');
    }
  }

  // Observação de regra (hoje: salário no sábado)
  const observacoes = obrigNormais.map((i) => i.observacao).filter(Boolean);
  if (observacoes.length) {
    linhas.push("");
    for (const o of observacoes) linhas.push(`⚠️ ${o}`);
  }

  if (obrigNormais.some((i) => i.temGuiaNoPortal) && portalUrl) {
    linhas.push("");
    linhas.push(`As guias estão no portal: ${portalUrl}`);
  }

  // Aviso sem documento: o cliente entraria no portal, não acharia nada e concluiria
  // que o portal está furado. Melhor dizer que o documento ainda vem.
  const faltando = obrigNormais.filter((i) => i.semGuia);
  if (faltando.length) {
    linhas.push("");
    linhas.push(
      faltando.length === obrigNormais.length
        ? "A guia ainda não está no portal — assim que sair, enviamos."
        : `Ainda falta a guia de: ${faltando.map((i) => i.nome).join(", ")}. Assim que sair, enviamos.`
    );
  }

  if (incentivo) {
    linhas.push("");
    linhas.push(incentivo);
  }

  return linhas.join("\n");
}

/** Nome legível de uma lista de códigos, para a tela e o log. */
function nomesDe(codigos = []) {
  return codigos.map((c) => obrigacao(c)?.nome || c);
}

module.exports = {
  decidirAutomaticas,
  sugerirPorEntregas,
  textoDaEvidencia,
  montarMensagemAlerta,
  nomesDe,
};
