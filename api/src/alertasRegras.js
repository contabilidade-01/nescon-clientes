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
      const casaTipo = o.docTypes.includes(tipo);
      const casaTexto = o.padrao ? o.padrao.test(titulo) : false;
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
 * `itens` = [{ codigo, nome, vencimento, observacao, temGuiaNoPortal }]
 * `incentivo` = texto já escolhido (ou null). Entra no fim, sem título e sem separador
 * gritante — é o cliente lendo o aviso que ele quis receber e encontrando uma frase a
 * mais no final, não um anúncio.
 */
function montarMensagemAlerta({ empresaNome = "", hoje, itens = [], portalUrl = "", incentivo = null } = {}) {
  if (!itens.length) return null;

  const datas = new Set(itens.map((i) => i.vencimento));
  const todasHoje = datas.size === 1 && itens[0].vencimento === hoje;
  const linhas = [];

  const saudacao = empresaNome ? `Olá, ${empresaNome}!` : "Olá!";
  linhas.push(saudacao);
  linhas.push("");

  if (todasHoje) {
    linhas.push(`*Vence hoje (${ddmm(itens[0].vencimento)}):*`);
  } else if (datas.size === 1) {
    linhas.push(`*Vence amanhã (${ddmm(itens[0].vencimento)}):*`);
  } else {
    linhas.push("*Vencimentos próximos:*");
  }

  for (const i of itens) {
    const quando = datas.size === 1 ? "" : ` — ${ddmm(i.vencimento)}`;
    linhas.push(`• ${i.nome}${quando}`);
  }

  // Observação de regra (hoje: salário no sábado) vem logo abaixo da lista, porque
  // muda o que o cliente tem de fazer.
  const observacoes = itens.map((i) => i.observacao).filter(Boolean);
  if (observacoes.length) {
    linhas.push("");
    for (const o of observacoes) linhas.push(`⚠️ ${o}`);
  }

  if (itens.some((i) => i.temGuiaNoPortal) && portalUrl) {
    linhas.push("");
    linhas.push(`As guias estão no portal: ${portalUrl}`);
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
