/**
 * Regras da cobrança de pendências do e-CAC — funções PURAS (sem banco, sem relógio).
 *
 * Aqui mora o que precisa ser testável sem subir nada: a leitura do que o central-ecac
 * devolve, a máquina de estados e o texto das mensagens. Quem lê/grava banco e envia é
 * `ecacCobranca.js`; quem fala com o central-ecac é `ecacClient.js`.
 *
 * Máquina de estados de UMA cobrança (empresa × ciclo mensal):
 *
 *   aberta ──notificar──▶ notificado ──N dias úteis──▶ lembrete ──N dias──▶ cobranca_1 ──M dias──▶ cobranca_2 ──M dias──▶ escalado
 *      │                      │                          │                       │                     │
 *      │              cliente gerou guia ─────────────────┴───────────────────────┴─────────────────────┘
 *      │                      ▼
 *      │            aguardando_regeracao ──relatório novo──▶ quitado (agradece)  |  cobranca_1 (ainda deve)
 *      │
 *      └── relatório novo sem atraso (em qualquer estado) ──▶ quitado
 *
 * Três princípios, vindos da revisão do plano:
 *  1. Só notifica o que é `valido` E `em_atraso` — e só se o relatório é do ciclo
 *     (`relatorio_recente`). Fantasma do leitor de PDF e relatório velho não viram cobrança.
 *  2. Regerar relatório é chamada paga: só depois de o cliente recalcular a guia, e no
 *     máximo `max_regeracoes` por ciclo. Quem não recalculou recebe LEMBRETE, não regeração.
 *  3. Teto de mensagens por canal por ciclo. Cobrança não vira spam.
 */
const { ehFeriadoNacional, somarDias } = require("./diasBancarios");

const ESTADOS_TERMINAIS = new Set(["quitado", "escalado", "encerrado"]);
const ESTADOS = [
  "aberta", "notificado", "lembrete", "aguardando_regeracao", "cobranca_1", "cobranca_2",
  "respondeu", "escalado", "quitado", "encerrado",
];

const CFG_PADRAO = Object.freeze({
  dias_lembrete: 5,     // dias úteis após o aviso sem recálculo → lembrete
  dias_regeracao: 5,    // dias úteis após o recálculo → regerar relatório
  dias_cobranca: 3,     // dias úteis entre cobrança 1 (e-mail) e 2 (WhatsApp), e até escalar
  max_regeracoes: 2,    // por ciclo (cada uma é consulta paga)
  max_msgs_canal: 4,    // por canal por ciclo
});

const ROTULO_TIPO = {
  SN: "DAS — Simples Nacional",
  MEI: "DAS — MEI",
  INSS: "INSS / Contribuição previdenciária (DCTFWeb)",
  MAED: "Multa por atraso de declaração (MAED)",
  IRRF: "IRRF",
  OUTROS: "Tributo federal",
};

function soDigitos(v) {
  return String(v || "").replace(/\D/g, "");
}

/** CNPJ com 14 dígitos ou null — chave de junção entre os dois sistemas. */
function cnpjChave(v) {
  const d = soDigitos(v);
  return d.length === 14 ? d : null;
}

function ehDiaUtil(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  const dow = new Date(t).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !ehFeriadoNacional(iso);
}

/** Dias úteis em (inicio, fim]. Negativo/igual → 0. */
function diasUteisEntre(inicio, fim) {
  if (!inicio || !fim || fim <= inicio) return 0;
  let n = 0;
  let d = inicio;
  while (d < fim) {
    d = somarDias(d, 1);
    if (ehDiaUtil(d)) n += 1;
  }
  return n;
}

/** `quantidade` dias úteis depois de `iso` (o próprio dia não conta). */
function somarDiasUteis(iso, quantidade) {
  let d = iso;
  let restam = Math.max(0, Number(quantidade) || 0);
  while (restam > 0) {
    d = somarDias(d, 1);
    if (ehDiaUtil(d)) restam -= 1;
  }
  return d;
}

/** Próximo dia útil a partir de `iso` (inclusive). */
function proximoDiaUtil(iso) {
  let d = iso;
  for (let i = 0; i < 31 && !ehDiaUtil(d); i += 1) d = somarDias(d, 1);
  return d;
}

// ------------------------------------------------------------ leitura das pendências

/**
 * Tipos que o central-ecac traz mas NUNCA vão para o cliente — nem na mensagem, nem na
 * tela "Impostos em aberto", nem na emissão de guia pelo portal.
 *
 * MAED (multa por atraso na entrega de declaração) é tratada pelo escritório: quase
 * sempre a declaração atrasada é responsabilidade nossa, e cobrar a multa do cliente
 * por régua automática seria o pior jeito de ele descobrir isso. (Jean, 02/10/2026)
 *
 * Também casa pela descrição da receita, para o caso de a multa vir classificada como
 * OUTROS.
 */
const TIPOS_FORA_DO_CLIENTE = new Set(["MAED"]);

function vaiParaCliente(d) {
  if (!d || !d.valido) return false;
  if (TIPOS_FORA_DO_CLIENTE.has(String(d.tipo || "").toUpperCase())) return false;
  if (/\bMAED\b/i.test(String(d.receita || ""))) return false;
  return true;
}

/** Só o que pode ir para o cliente: válido e em atraso, do mais antigo ao mais novo. */
function debitosCobraveis(debitos) {
  return (Array.isArray(debitos) ? debitos : [])
    .filter((d) => vaiParaCliente(d) && d.em_atraso)
    .sort((a, b) => String(a.data_vencimento || "").localeCompare(String(b.data_vencimento || "")));
}

function debitosAVencer(debitos) {
  return (Array.isArray(debitos) ? debitos : [])
    .filter((d) => vaiParaCliente(d) && !d.em_atraso)
    .sort((a, b) => String(a.data_vencimento || "").localeCompare(String(b.data_vencimento || "")));
}

function totalCobravel(debitos) {
  return Math.round(debitosCobraveis(debitos).reduce((s, d) => s + (Number(d.saldo_devedor_total) || 0), 0) * 100) / 100;
}

/**
 * Uma empresa do JSON do central-ecac → linha do espelho. `null` quando não há relatório.
 * NÃO decide se abre cobrança — isso é `deveAbrirCobranca`.
 */
function espelhoDaEmpresa(e) {
  if (!e || !e.relatorio) return null;
  const debitos = Array.isArray(e.debitos) ? e.debitos : [];
  return {
    cnpj: cnpjChave(e.cnpj),
    relatorio_id: Number(e.relatorio.id),
    relatorio_data: e.relatorio.data_hora || null,
    relatorio_recente: Boolean(e.relatorio_recente),
    debitos,
    omissoes: Array.isArray(e.omissoes) ? e.omissoes : [],
    parcelamento: e.parcelamento || null,
    pgfn: e.pgfn || null,
    qtd_atraso: debitosCobraveis(debitos).length,
    total_atraso: totalCobravel(debitos),
    qtd_a_vencer: debitosAVencer(debitos).length,
    qtd_invalidos: debitos.filter((d) => d && !d.valido).length,
  };
}

/** Abre cobrança só com relatório DO CICLO e ao menos um débito cobrável. */
function deveAbrirCobranca(espelho) {
  return Boolean(espelho && espelho.relatorio_recente && espelho.qtd_atraso > 0);
}

// ------------------------------------------------------------------ máquina de estados

function podeCanal(cobranca, canal, cfg) {
  const usados = canal === "email" ? Number(cobranca.emails || 0) : Number(cobranca.whatsapps || 0);
  return usados < cfg.max_msgs_canal;
}

function comCanais(cobranca, canais, cfg) {
  return canais.filter((c) => podeCanal(cobranca, c, cfg));
}

/**
 * Decide o próximo passo de uma cobrança. Entrada:
 *   cobranca        { estado, estado_desde 'YYYY-MM-DD', relatorio_id, regeracoes, emails,
 *                     whatsapps, regeracao_pedida_em 'YYYY-MM-DD'|null, proxima_acao_em }
 *   pendenciaAtual  espelho mais novo da empresa { relatorio_id, qtd_atraso } (ou null)
 *   recalculou      true se o cliente gerou guia DEPOIS de `estado_desde`
 *   engajou         true se o cliente clicou no link ou entrou no portal neste ciclo —
 *                   o lembrete vai só por e-mail (WhatsApp fica para quem não deu sinal)
 *   hoje            'YYYY-MM-DD'
 *   cfg             CFG_PADRAO (parcial permitido)
 *
 * Saída: { acao, etapa?, canais?, estado, proxima_acao_em?, motivo }
 *   acao ∈ nada | enviar | agendar_regeracao | consultar | escalar | aguardar
 */
function decidir({ cobranca, pendenciaAtual = null, recalculou = false, engajou = false, hoje, cfg: cfgParcial = {} }) {
  const cfg = { ...CFG_PADRAO, ...(cfgParcial || {}) };
  const estado = cobranca.estado || "aberta";
  const desde = cobranca.estado_desde || hoje;
  const canaisLembrete = engajou ? ["email"] : ["email", "whatsapp"];

  if (ESTADOS_TERMINAIS.has(estado)) {
    return { acao: "nada", estado, motivo: "cobrança encerrada" };
  }
  // O cliente respondeu no WhatsApp: gente atende, o automático cala até o escritório
  // retomar. Relatório novo sem débito ainda encerra (regra 1, abaixo).
  if (estado === "respondeu" && !(pendenciaAtual && Number(pendenciaAtual.relatorio_id) > Number(cobranca.relatorio_id) && Number(pendenciaAtual.qtd_atraso) === 0)) {
    return { acao: "nada", estado, motivo: "cliente respondeu — em atendimento humano" };
  }

  // 1) Relatório novo (lote mensal ou regeração pedida): decide pelo que a Receita diz.
  if (pendenciaAtual && Number(pendenciaAtual.relatorio_id) > Number(cobranca.relatorio_id)) {
    if (Number(pendenciaAtual.qtd_atraso) === 0) {
      return {
        acao: "enviar", etapa: "quitado", canais: comCanais(cobranca, ["email"], cfg),
        estado: "quitado", motivo: "relatório novo sem débito em atraso",
      };
    }
    if (estado === "cobranca_1" || estado === "cobranca_2") {
      // já estava cobrando: adota o relatório novo e segue o ritmo normal
      return { acao: "adotar_relatorio", estado, motivo: "relatório novo ainda com débito" };
    }
    return {
      acao: "enviar", etapa: "cobranca_1", canais: comCanais(cobranca, ["email"], cfg),
      estado: "cobranca_1", motivo: "relatório novo ainda com débito em atraso",
    };
  }

  // 2) Primeiro aviso.
  if (estado === "aberta") {
    return {
      acao: "enviar", etapa: "notificado", canais: comCanais(cobranca, ["email", "whatsapp"], cfg),
      estado: "notificado", motivo: "primeiro aviso do ciclo",
    };
  }

  // 3) Cliente recalculou a guia → confere o pagamento dias depois (regeração paga).
  if (recalculou && estado !== "aguardando_regeracao") {
    if (Number(cobranca.regeracoes || 0) >= cfg.max_regeracoes) {
      return {
        acao: "aguardar", estado, proxima_acao_em: somarDiasUteis(hoje, cfg.dias_cobranca),
        motivo: "recalculou, mas o limite de regerações do ciclo já foi usado — o lote mensal confere",
      };
    }
    return {
      acao: "agendar_regeracao", estado: "aguardando_regeracao",
      dias_uteis: cfg.dias_regeracao,
      proxima_acao_em: somarDiasUteis(hoje, cfg.dias_regeracao + 1),
      motivo: "cliente gerou guia atualizada",
    };
  }

  // 4) Esperando o relatório regerado.
  if (estado === "aguardando_regeracao") {
    const pedida = cobranca.regeracao_pedida_em || desde;
    const passados = diasUteisEntre(pedida, hoje);
    if (passados < cfg.dias_regeracao + 1) {
      return { acao: "aguardar", estado, proxima_acao_em: somarDiasUteis(pedida, cfg.dias_regeracao + 1), motivo: "regeração ainda não vence" };
    }
    if (passados <= cfg.dias_regeracao + 5) {
      return { acao: "consultar", estado, proxima_acao_em: somarDiasUteis(hoje, 1), motivo: "buscar relatório regerado" };
    }
    // a regeração não veio (fila travada por teto/procuração): não fica preso — lembra
    return {
      acao: "enviar", etapa: "lembrete", canais: comCanais(cobranca, canaisLembrete, cfg),
      estado: "lembrete", motivo: "relatório regerado não chegou; segue com lembrete",
    };
  }

  // 5) Ritmo normal sem recálculo.
  const passados = diasUteisEntre(desde, hoje);
  if (estado === "notificado") {
    if (passados >= cfg.dias_lembrete) {
      return {
        acao: "enviar", etapa: "lembrete", canais: comCanais(cobranca, canaisLembrete, cfg),
        estado: "lembrete", motivo: `${passados} dia(s) útil(eis) sem recálculo${engajou ? " (clicou/entrou no portal: só e-mail)" : ""}`,
      };
    }
    return { acao: "aguardar", estado, proxima_acao_em: somarDiasUteis(desde, cfg.dias_lembrete), motivo: "aguardando o cliente" };
  }
  if (estado === "lembrete") {
    if (passados >= cfg.dias_lembrete) {
      return {
        acao: "enviar", etapa: "cobranca_1", canais: comCanais(cobranca, ["email"], cfg),
        estado: "cobranca_1", motivo: `${passados} dia(s) útil(eis) após o lembrete`,
      };
    }
    return { acao: "aguardar", estado, proxima_acao_em: somarDiasUteis(desde, cfg.dias_lembrete), motivo: "aguardando o cliente" };
  }
  if (estado === "cobranca_1") {
    if (passados >= cfg.dias_cobranca) {
      return {
        acao: "enviar", etapa: "cobranca_2", canais: comCanais(cobranca, ["whatsapp"], cfg),
        estado: "cobranca_2", motivo: `${passados} dia(s) útil(eis) após a cobrança por e-mail`,
      };
    }
    return { acao: "aguardar", estado, proxima_acao_em: somarDiasUteis(desde, cfg.dias_cobranca), motivo: "aguardando o cliente" };
  }
  if (estado === "cobranca_2") {
    if (passados >= cfg.dias_cobranca) {
      return { acao: "escalar", estado: "escalado", motivo: "duas cobranças sem retorno — vai para o escritório" };
    }
    return { acao: "aguardar", estado, proxima_acao_em: somarDiasUteis(desde, cfg.dias_cobranca), motivo: "aguardando o cliente" };
  }

  return { acao: "aguardar", estado, proxima_acao_em: somarDiasUteis(hoje, 1), motivo: "estado sem regra" };
}

// --------------------------------------------------------------------- mensagens

function brl(v) {
  const n = Number(v) || 0;
  return `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function dataBR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "");
}

function rotuloTipo(d) {
  const t = String(d.tipo || "OUTROS").toUpperCase();
  if (t === "OUTROS" && d.receita) return d.receita;
  return ROTULO_TIPO[t] || d.receita || t;
}

function escaparHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function linhaTexto(d) {
  return `• ${rotuloTipo(d)} — competência ${d.periodo_apuracao} — venceu em ${dataBR(d.data_vencimento)} — ${brl(d.saldo_devedor_total)}`;
}

function tabelaHtml(debitos) {
  const linhas = debitos
    .map(
      (d) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${escaparHtml(rotuloTipo(d))}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${escaparHtml(d.periodo_apuracao)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${dataBR(d.data_vencimento)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${brl(d.valor_original)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right"><b>${brl(d.saldo_devedor_total)}</b></td>
      </tr>`
    )
    .join("");
  return `<table style="border-collapse:collapse;width:100%;font-size:14px">
    <thead><tr style="background:#f4f6f8">
      <th align="left" style="padding:6px 8px">Tributo</th>
      <th align="left" style="padding:6px 8px">Competência</th>
      <th align="left" style="padding:6px 8px">Vencimento</th>
      <th align="right" style="padding:6px 8px">Valor original</th>
      <th align="right" style="padding:6px 8px">Saldo no relatório</th>
    </tr></thead><tbody>${linhas}</tbody></table>`;
}

function resumoCurto(debitos, max = 4) {
  const itens = debitos.slice(0, max).map((d) => `${rotuloTipo(d)} ${d.periodo_apuracao} (${brl(d.saldo_devedor_total)})`);
  const resto = debitos.length > max ? ` e mais ${debitos.length - max} item(ns)` : "";
  return itens.join("; ") + resto;
}

/**
 * Texto de cada etapa. Tom: trabalhamos PARA o cliente, não para a Receita.
 * `ctx`: { etapa, empresa: {name}, debitos (já filtrados), relatorio_data, parcelamento,
 *          pgfn, link, pixel, escritorio: {nome, whatsapp, email} }
 * Devolve { assunto, texto, html, whatsapp }.
 */
function montarMensagem(ctx) {
  const nome = ctx.empresa?.name || "cliente";
  const esc = ctx.escritorio || {};
  const escNome = esc.nome || "Contabilidade";
  const contato = [esc.whatsapp ? `WhatsApp ${esc.whatsapp}` : null, esc.email ? `e-mail ${esc.email}` : null]
    .filter(Boolean)
    .join(" ou ");
  const debitos = debitosCobraveis(ctx.debitos);
  const total = totalCobravel(debitos);
  const n = debitos.length;
  const plural = n > 1;
  const link = ctx.link || null;
  const pixel = ctx.pixel ? `<img src="${escaparHtml(ctx.pixel)}" width="1" height="1" alt="" style="display:none">` : "";
  const rodapeExtras = [];
  if (ctx.parcelamento) rodapeExtras.push(`Consta também um parcelamento em andamento (${ctx.parcelamento}). Se houver parcela em atraso, fale com a gente.`);
  if (ctx.pgfn) rodapeExtras.push(`Há inscrição na Dívida Ativa (PGFN): ${ctx.pgfn}. Esse caso a gente trata junto com você — nos chame.`);

  const botao = link
    ? `<p style="margin:18px 0"><a href="${escaparHtml(link)}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Ver e gerar a guia atualizada</a></p>`
    : "";
  const avisoValores =
    "Os valores acima são os do relatório da Receita na data indicada. Ao gerar a guia, o sistema atualiza multa e juros até a data que você escolher para pagar.";
  const jaPagou = "Se já pagou, desconsidere: o pagamento leva alguns dias para aparecer na Receita.";
  const assinatura = `<p>Abraço,<br><b>${escaparHtml(escNome)}</b>${contato ? `<br><span style="color:#555">${escaparHtml(contato)}</span>` : ""}</p>`;

  const etapa = ctx.etapa;
  let assunto;
  let corpoHtml;
  let corpoTexto;
  let whatsapp;

  if (etapa === "notificado") {
    assunto = `${nome}: ${n} guia${plural ? "s" : ""} em aberto na Receita Federal`;
    corpoHtml = `<p>Olá, ${escaparHtml(nome)}.</p>
      <p>Nosso trabalho é manter a sua empresa em dia com o Fisco — e por isso avisamos: o relatório da Receita Federal de <b>${dataBR(ctx.relatorio_data)}</b> mostra <b>${n} guia${plural ? "s" : ""} em aberto</b>, somando <b>${brl(total)}</b>.</p>
      ${tabelaHtml(debitos)}
      <p style="color:#555;font-size:13px">${avisoValores}</p>
      ${botao}
      <p>${jaPagou} Se preferir parcelar ou tiver qualquer dúvida, é só responder este e-mail${contato ? ` ou falar pelo ${escaparHtml(contato)}` : ""}.</p>
      ${rodapeExtras.map((t) => `<p style="color:#555;font-size:13px">${escaparHtml(t)}</p>`).join("")}
      ${assinatura}${pixel}`;
    corpoTexto = [
      `Olá, ${nome}.`,
      "",
      `Nosso trabalho é manter a sua empresa em dia com o Fisco — e por isso avisamos: o relatório da Receita Federal de ${dataBR(ctx.relatorio_data)} mostra ${n} guia${plural ? "s" : ""} em aberto, somando ${brl(total)}.`,
      "",
      ...debitos.map(linhaTexto),
      "",
      avisoValores,
      link ? `Ver e gerar a guia atualizada: ${link}` : null,
      "",
      `${jaPagou} Se preferir parcelar ou tiver dúvida, fale com a gente${contato ? ` (${contato})` : ""}.`,
      ...rodapeExtras,
      "",
      escNome,
    ].filter((l) => l !== null).join("\n");
    whatsapp = [
      `${nome}, aqui é a ${escNome}. 👋`,
      `Consta em aberto na Receita Federal: ${resumoCurto(debitos)} — total ${brl(total)}.`,
      link ? `Gere a guia atualizada aqui: ${link}` : null,
      "Se já pagou, pode ignorar. Dúvidas ou parcelamento, é só responder.",
    ].filter(Boolean).join("\n");
  } else if (etapa === "lembrete") {
    assunto = `Lembrete: ${n} guia${plural ? "s" : ""} em aberto — ${nome}`;
    corpoHtml = `<p>Olá, ${escaparHtml(nome)}.</p>
      <p>Só passando para lembrar que ${plural ? "seguem" : "segue"} em aberto na Receita Federal:</p>
      ${tabelaHtml(debitos)}
      <p>É rápido gerar a guia atualizada pelo portal — juros e multa param de crescer no dia do pagamento.</p>
      ${botao}
      <p>${jaPagou} Qualquer dúvida, estamos por aqui.</p>
      ${assinatura}${pixel}`;
    corpoTexto = [
      `Olá, ${nome}.`,
      "",
      `Só passando para lembrar que ${plural ? "seguem" : "segue"} em aberto na Receita Federal:`,
      ...debitos.map(linhaTexto),
      "",
      "É rápido gerar a guia atualizada pelo portal.",
      link ? link : null,
      jaPagou,
      "",
      escNome,
    ].filter((l) => l !== null).join("\n");
    whatsapp = [
      `Oi, ${nome}! Lembrete da ${escNome}: ${resumoCurto(debitos)} ${plural ? "seguem" : "segue"} em aberto na Receita (${brl(total)}).`,
      link ? `Guia atualizada em 1 minuto: ${link}` : null,
      "Se já pagou, ignore. Estamos por aqui. 🙂",
    ].filter(Boolean).join("\n");
  } else if (etapa === "cobranca_1") {
    assunto = `Ainda em aberto na Receita — ${nome}`;
    corpoHtml = `<p>Olá, ${escaparHtml(nome)}.</p>
      <p>Conferimos novamente na Receita Federal e ${plural ? "estas guias continuam" : "esta guia continua"} em aberto:</p>
      ${tabelaHtml(debitos)}
      <p>Juros e multa continuam correndo. Se quiser, geramos a guia com a data que for melhor para você, ou conversamos sobre parcelamento — o importante é não deixar virar dívida ativa.</p>
      ${botao}
      <p>${jaPagou}</p>
      ${assinatura}${pixel}`;
    corpoTexto = [
      `Olá, ${nome}.`,
      "",
      `Conferimos novamente na Receita Federal e ${plural ? "estas guias continuam" : "esta guia continua"} em aberto:`,
      ...debitos.map(linhaTexto),
      "",
      "Juros e multa continuam correndo. Podemos gerar a guia com a data que for melhor para você, ou conversar sobre parcelamento.",
      link ? link : null,
      jaPagou,
      "",
      escNome,
    ].filter((l) => l !== null).join("\n");
    whatsapp = null;
  } else if (etapa === "cobranca_2") {
    assunto = null;
    corpoHtml = null;
    corpoTexto = null;
    whatsapp = [
      `${nome}, é a ${escNome}. Conferimos de novo na Receita e ${plural ? "seguem" : "segue"} em aberto: ${resumoCurto(debitos)} — total ${brl(total)}.`,
      "Não queremos que isso vire dívida ativa. Podemos gerar a guia para a data que você preferir, ou ver um parcelamento.",
      link ? `Guia: ${link}` : null,
      "Me responde por aqui que a gente resolve junto. 🤝",
    ].filter(Boolean).join("\n");
  } else if (etapa === "quitado") {
    assunto = `Tudo certo na Receita — ${nome}`;
    corpoHtml = `<p>Olá, ${escaparHtml(nome)}.</p>
      <p>Boa notícia: o relatório mais recente da Receita Federal já não mostra guia em aberto para a sua empresa. Obrigado por manter tudo em dia — é assim que a gente evita multa e dor de cabeça.</p>
      ${assinatura}${pixel}`;
    corpoTexto = [
      `Olá, ${nome}.`,
      "",
      "Boa notícia: o relatório mais recente da Receita Federal já não mostra guia em aberto para a sua empresa. Obrigado por manter tudo em dia.",
      "",
      escNome,
    ].join("\n");
    whatsapp = null;
  } else {
    throw new Error(`etapa desconhecida: ${etapa}`);
  }

  return { assunto, texto: corpoTexto, html: corpoHtml, whatsapp };
}

/** Assunto/estado legível para o painel. */
const ROTULO_ESTADO = {
  aberta: "A notificar",
  notificado: "Avisado",
  lembrete: "Lembrete enviado",
  aguardando_regeracao: "Recalculou — conferindo pagamento",
  cobranca_1: "Cobrança 1 (e-mail)",
  cobranca_2: "Cobrança 2 (WhatsApp)",
  respondeu: "Cliente respondeu — atendimento humano",
  escalado: "Escalado ao escritório",
  quitado: "Quitado",
  encerrado: "Encerrado",
};

module.exports = {
  ESTADOS,
  ESTADOS_TERMINAIS,
  CFG_PADRAO,
  ROTULO_ESTADO,
  ROTULO_TIPO,
  cnpjChave,
  soDigitos,
  ehDiaUtil,
  diasUteisEntre,
  somarDiasUteis,
  proximoDiaUtil,
  TIPOS_FORA_DO_CLIENTE,
  vaiParaCliente,
  debitosCobraveis,
  debitosAVencer,
  totalCobravel,
  espelhoDaEmpresa,
  deveAbrirCobranca,
  decidir,
  montarMensagem,
  brl,
  dataBR,
  rotuloTipo,
};
