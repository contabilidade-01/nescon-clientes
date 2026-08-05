/**
 * Catálogo de obrigações e a regra de vencimento de cada uma.
 *
 * Fonte única do "quando vence". A tela do admin, o alerta de WhatsApp e o calendário
 * do cliente têm de responder a mesma data — se cada um calculasse a sua, um dia iam
 * divergir e ninguém saberia qual está certo.
 *
 * **A data é sempre calculada, nunca gravada** — mesma regra de ouro das licenças
 * (ver licenseStatus.js). Vencimento gravado envelhece: muda um feriado, muda a lei,
 * e o banco fica com data velha que ninguém recalcula.
 *
 * ## Como ler `regra`
 *
 * - `{ tipo: "dia_fixo", dia: 20, ajuste: "anterior" | "proximo" }`
 *   Vence no dia tal do mês de PAGAMENTO. Se não for dia bancário, antecipa ou adia
 *   conforme a legislação de cada tributo — e essa diferença é real: FGTS antecipa,
 *   Simples adia. Trocar os dois manda o cliente pagar com multa.
 * - `{ tipo: "ultimo_dia_bancario" }` — último dia bancário do mês de pagamento.
 * - `{ tipo: "quinto_dia_util" }` — 5º dia útil trabalhista (sábado conta).
 *
 * ## Mês de pagamento, não competência
 *
 * `calcularVencimento` recebe o mês em que se PAGA, não a competência. A tabela do
 * escritório diz "último dia bancário do mês subsequente" porque pensa a partir da
 * competência; aqui já estamos no mês subsequente. Quem quiser a competência pega o
 * mês anterior — está em `competenciaDe()`. Manter as duas coisas separadas evita o
 * erro clássico de alertar um mês inteiro fora.
 */
const {
  proximoDiaBancario,
  diaBancarioAnterior,
  ultimoDiaBancarioDoMes,
  nEsimoDiaUtilTrabalhista,
  diasNoMes,
} = require("./diasBancarios");

/**
 * `auto`: quando o sistema marca sozinho, sem perguntar ao admin.
 *   - "das_no_portal"        — existe guia de DAS entre as entregas da empresa
 *   - "funcionario_ou_prolabore" — existe alguém na folha, celetista ou sócio
 *   - "funcionario"          — existe funcionário celetista
 * Sem `auto`, a obrigação é SUGERIDA quando aparece guia dela no portal, e quem marca
 * é o admin. Sugerir em vez de marcar é deliberado: uma guia avulsa de ICMS num mês
 * não prova que a empresa recolhe ICMS todo mês.
 *
 * `docTypes` casa com o tipo classificado pelo G-Click (ver gclick/guides.js);
 * `padrao` é a busca no título da entrega, para o que o G-Click não classifica.
 */
const OBRIGACOES = [
  {
    codigo: "SALARIO",
    nome: "Salário — limite de pagamento",
    esfera: "trabalhista",
    regra: { tipo: "quinto_dia_util" },
    // Este é o único que avisa NO dia: não é guia a pagar no banco, é o prazo legal
    // estourando. Avisar na véspera daria a impressão de que ainda dá para deixar
    // para depois.
    avisarDiasAntes: 0,
    auto: "funcionario",
    docTypes: [],
    padrao: null,
  },
  {
    codigo: "ICMS",
    nome: "ICMS Comércio",
    esfera: "estadual",
    regra: { tipo: "dia_fixo", dia: 8, ajuste: "proximo" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: ["ICMS"],
    padrao: /\bICMS\b/i,
  },
  {
    codigo: "ISS_UBERLANDIA",
    nome: "ISS Uberlândia",
    esfera: "municipal",
    regra: { tipo: "dia_fixo", dia: 15, ajuste: "anterior" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: ["ISS"],
    padrao: /\bISS(QN)?\b/i,
  },
  {
    codigo: "INSS_GPS_CI",
    nome: "INSS — GPS Contribuinte Individual",
    esfera: "federal",
    regra: { tipo: "dia_fixo", dia: 15, ajuste: "anterior" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: [],
    padrao: /contribuinte\s+individual/i,
  },
  {
    codigo: "FGTS",
    nome: "FGTS",
    esfera: "federal",
    regra: { tipo: "dia_fixo", dia: 20, ajuste: "anterior" },
    avisarDiasAntes: 1,
    auto: "funcionario",
    docTypes: ["FGTS"],
    padrao: /\bFGTS\b/i,
  },
  {
    codigo: "INSS_DCTFWEB",
    nome: "INSS (DCTF Web)",
    esfera: "federal",
    regra: { tipo: "dia_fixo", dia: 20, ajuste: "anterior" },
    avisarDiasAntes: 1,
    auto: "funcionario_ou_prolabore",
    docTypes: ["DCTF_WEB"],
    padrao: /DCTF\s*-?\s*Web/i,
  },
  {
    codigo: "INSS_GPS",
    nome: "INSS — GPS",
    esfera: "federal",
    regra: { tipo: "dia_fixo", dia: 20, ajuste: "anterior" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: ["INSS"],
    padrao: /\b(INSS|GPS)\b/i,
  },
  {
    codigo: "IRRF_SERVICOS",
    nome: "IRRF — Prestação de Serviços",
    esfera: "federal",
    regra: { tipo: "dia_fixo", dia: 20, ajuste: "anterior" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: [],
    padrao: /\bIRRF\b/i,
  },
  {
    codigo: "DAS",
    nome: "Simples Nacional (DAS)",
    esfera: "federal",
    // Único do dia 20 que ADIA em vez de antecipar. Não é descuido: é a regra do
    // Simples (LC 123, art. 21 §3º).
    regra: { tipo: "dia_fixo", dia: 20, ajuste: "proximo" },
    avisarDiasAntes: 1,
    auto: "das_no_portal",
    docTypes: ["DAS"],
    padrao: /\b(DAS|Simples\s+Nacional)\b/i,
  },
  {
    codigo: "INSS_DOMESTICO",
    nome: "INSS Doméstico (eSocial)",
    esfera: "federal",
    regra: { tipo: "dia_fixo", dia: 20, ajuste: "anterior" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: [],
    padrao: /dom[eé]stic/i,
  },
  {
    codigo: "COFINS",
    nome: "COFINS",
    esfera: "federal",
    regra: { tipo: "dia_fixo", dia: 25, ajuste: "anterior" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: [],
    padrao: /\bCOFINS\b/i,
  },
  {
    codigo: "PIS_FATURAMENTO",
    nome: "PIS — Faturamento",
    esfera: "federal",
    regra: { tipo: "dia_fixo", dia: 25, ajuste: "anterior" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: [],
    padrao: /\bPIS\b/i,
  },
  {
    codigo: "IRPJ_MENSAL",
    nome: "IRPJ Mensal",
    esfera: "federal",
    regra: { tipo: "ultimo_dia_bancario" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: [],
    padrao: /\bIRPJ\b/i,
  },
  {
    codigo: "CSLL_MENSAL",
    nome: "CSLL Mensal",
    esfera: "federal",
    regra: { tipo: "ultimo_dia_bancario" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: [],
    padrao: /\bCSLL\b/i,
  },
  {
    codigo: "IRPF_CARNE_LEAO",
    nome: "IRPF — Carnê-Leão",
    esfera: "federal",
    regra: { tipo: "ultimo_dia_bancario" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: [],
    padrao: /carn[eê]\s*-?\s*le[aã]o/i,
  },
  {
    codigo: "IRPF_QUOTAS",
    nome: "IRPF — Quotas do Imposto de Renda",
    esfera: "federal",
    regra: { tipo: "ultimo_dia_bancario" },
    avisarDiasAntes: 1,
    auto: null,
    docTypes: [],
    padrao: /quota|cota\s+do\s+IR/i,
  },
  {
    codigo: "PARCELAMENTOS",
    nome: "Parcelamentos",
    esfera: "federal",
    regra: { tipo: "ultimo_dia_bancario" },
    avisarDiasAntes: 1,
    auto: null,
    // O portal ainda não recebe guia de parcelamento (ver docs/PLANO-INDEPENDENCIA-GCLICK.md,
    // fase F3). Até lá esta obrigação só se marca à mão — não há o que detectar.
    docTypes: [],
    padrao: /parcelament/i,
  },
];

const POR_CODIGO = new Map(OBRIGACOES.map((o) => [o.codigo, o]));

function obrigacao(codigo) {
  return POR_CODIGO.get(String(codigo || "").toUpperCase()) || null;
}

function ehObrigacaoValida(codigo) {
  return POR_CODIGO.has(String(codigo || "").toUpperCase());
}

/**
 * Vencimento da obrigação no mês em que se PAGA.
 *
 * Devolve `{ data, observacao }` — `observacao` só vem quando há algo que o cliente
 * precisa saber junto da data (hoje, o salário caindo em sábado). Devolve null se o
 * código não existe, em vez de chutar uma data.
 */
function calcularVencimento(codigo, ano, mes) {
  const o = obrigacao(codigo);
  if (!o) return null;
  const a = Number(ano);
  const m = Number(mes);
  if (!Number.isInteger(a) || !Number.isInteger(m) || m < 1 || m > 12) return null;

  if (o.regra.tipo === "ultimo_dia_bancario") {
    return { data: ultimoDiaBancarioDoMes(a, m), observacao: null };
  }

  if (o.regra.tipo === "quinto_dia_util") {
    const r = nEsimoDiaUtilTrabalhista(a, m, 5);
    if (!r) return null;
    if (r.sabado) {
      // Sábado não é dia bancário: antecipar para sexta (último dia bancário antes)
      return {
        data: diaBancarioAnterior(r.data),
        observacao: "O 5º dia útil cai num sábado: limite antecipado para sexta-feira.",
      };
    }
    return { data: r.data, observacao: null };
  }

  // dia_fixo — o dia pode não existir no mês (dia 30 em fevereiro não é o caso aqui,
  // mas a guarda fica para quando alguém acrescentar uma obrigação do dia 31).
  const dia = Math.min(o.regra.dia, diasNoMes(a, m));
  const nominal = `${a}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const data = o.regra.ajuste === "proximo" ? proximoDiaBancario(nominal) : diaBancarioAnterior(nominal);
  return { data, observacao: null };
}

/** Competência de um pagamento feito em ano/mês: o mês anterior. */
function competenciaDe(ano, mes) {
  const m = Number(mes);
  const a = Number(ano);
  return m === 1 ? { ano: a - 1, mes: 12 } : { ano: a, mes: m - 1 };
}

/**
 * Todas as obrigações que vencem numa data, entre as que a empresa recebe.
 * Olha o mês da própria data e o seguinte: uma obrigação do dia 1º pode ter sido
 * antecipada do dia 3 do mês seguinte? Não — antecipação nunca atravessa o mês. Mas
 * o dia 1º SIM pode ser adiamento do último dia do mês anterior. Daí os dois meses.
 */
function obrigacoesQueVencemEm(data, codigos) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data || ""));
  if (!m) return [];
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };

  const achados = [];
  for (const codigo of codigos) {
    for (const ref of [{ ano, mes }, anterior]) {
      const v = calcularVencimento(codigo, ref.ano, ref.mes);
      if (v && v.data === data) {
        achados.push({ codigo, nome: obrigacao(codigo).nome, observacao: v.observacao });
        break;
      }
    }
  }
  return achados;
}

module.exports = {
  OBRIGACOES,
  obrigacao,
  ehObrigacaoValida,
  calcularVencimento,
  competenciaDe,
  obrigacoesQueVencemEm,
};
