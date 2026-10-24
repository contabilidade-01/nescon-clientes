/**
 * Regras de ouro ANTES de qualquer cobrança de boleto (honorário).
 *
 * Decisão (16/10/2026, Jeandson), depois do vencimento de 10/10/2026 (sábado) em que
 * clientes que já tinham pago receberam cobrança em 15/10:
 *
 * 1. **Início de cobrança.** Vencimento em sábado, domingo ou feriado nacional (inclusive
 *    feriado em dia de semana) rola para o próximo dia bancário: é até ali que o cliente
 *    pode pagar sem atraso. Depois disso esperamos a compensação (N dias bancários, 1 por
 *    padrão) e só no dia bancário seguinte a cobrança pode sair.
 *
 *      venc. sáb 10/10/2026 → pode pagar até ter 13/10 (seg 12/10 é N. Sra. Aparecida)
 *                           → compensa até qua 14/10 → cobra a partir de qui 15/10
 *      venc. sáb (sem feriado na segunda) → paga seg → compensa ter → cobra qua
 *      venc. sex dia útil → paga sex → compensa seg → cobra ter
 *
 * 2. **Consulta ativa na Cora.** Antes de cada cobrança o boleto é consultado AGORA na
 *    Cora, e só se cobra o que a Cora confirma em aberto. É uma trava que FALHA FECHADA:
 *    Cora fora do ar, timeout, boleto sem vínculo, status desconhecido ou pagamento em
 *    processamento → não cobra. Antes era o contrário (best-effort): qualquer falha na
 *    consulta deixava a cobrança sair com o status velho do banco — e cobrar quem pagou
 *    é pior do que atrasar um dia a cobrança de quem não pagou.
 *
 * Módulo puro (sem banco). A Cora entra por injeção para ser testável sem rede.
 */
const { ehDiaBancario, proximoDiaBancario, somarDias, ddmm } = require("./diasBancarios");

function num(v, padrao) {
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

/**
 * Dias bancários de espera pela compensação depois do último dia de pagamento.
 * Compatível com a env antiga HONORARIOS_CARENCIA_DIAS_UTEIS (contava o dia da cobrança
 * junto: carência 2 = 1 dia de compensação + o dia em que a cobrança sai).
 */
const COMPENSACAO_DIAS_BANCARIOS = Math.max(
  0,
  num(
    process.env.HONORARIOS_COMPENSACAO_DIAS_UTEIS,
    process.env.HONORARIOS_CARENCIA_DIAS_UTEIS !== undefined
      ? num(process.env.HONORARIOS_CARENCIA_DIAS_UTEIS, 2) - 1
      : 1
  )
);

/** Próximo dia bancário estritamente DEPOIS de `data`. */
function diaBancarioSeguinte(data) {
  const d = somarDias(data, 1);
  return d ? proximoDiaBancario(d) : null;
}

/**
 * Calendário de cobrança de um boleto. Datas 'YYYY-MM-DD'.
 *
 *   ultimoDiaPagamento: vencimento, ou o próximo dia bancário se caiu em fim de semana/feriado
 *   fimCompensacao:     último dia de espera pela compensação
 *   inicioCobranca:     1º dia em que a cobrança pode sair
 *
 * Devolve null se a data de vencimento não for válida.
 */
function calendarioCobranca(dueDate, { compensacao = COMPENSACAO_DIAS_BANCARIOS } = {}) {
  const ultimoDiaPagamento = proximoDiaBancario(dueDate);
  if (!ultimoDiaPagamento) return null;
  let fimCompensacao = ultimoDiaPagamento;
  for (let i = 0; i < compensacao; i += 1) fimCompensacao = diaBancarioSeguinte(fimCompensacao);
  const inicioCobranca = diaBancarioSeguinte(fimCompensacao);
  if (!inicioCobranca) return null;
  return {
    vencimento: dueDate,
    ultimoDiaPagamento,
    fimCompensacao,
    inicioCobranca,
    vencimentoRolou: ultimoDiaPagamento !== dueDate,
  };
}

/**
 * Regra 1: hoje já é dia de cobrar este boleto? Só em dia bancário (feriado em dia de
 * semana não cobra) e a partir do início de cobrança.
 */
function liberadoParaCobrar(dueDate, hoje, opcoes) {
  const cal = calendarioCobranca(dueDate, opcoes);
  if (!cal) return { liberado: false, motivo: "vencimento inválido", calendario: null };
  if (!ehDiaBancario(hoje)) {
    return { liberado: false, motivo: "hoje não é dia útil (fim de semana/feriado)", calendario: cal };
  }
  if (hoje < cal.inicioCobranca) {
    const motivo = hoje <= cal.ultimoDiaPagamento
      ? `ainda no prazo de pagamento (até ${ddmm(cal.ultimoDiaPagamento)}); cobrança a partir de ${ddmm(cal.inicioCobranca)}`
      : `aguardando compensação (até ${ddmm(cal.fimCompensacao)}); cobrança a partir de ${ddmm(cal.inicioCobranca)}`;
    return { liberado: false, motivo, calendario: cal };
  }
  return { liberado: true, motivo: null, calendario: cal };
}

/** Status da Cora em que o boleto segue em aberto (e só nesses se cobra). */
const STATUS_ABERTO = new Set(["OPEN", "LATE", "OVERDUE", "PENDING", "ABERTO", "PENDENTE", "VENCIDO", "ATRASADO"]);
/** Pago, mas ainda em processamento/compensação: não está "em aberto" para cobrança. */
const STATUS_EM_PROCESSAMENTO = new Set(["IN_PAYMENT", "PROCESSING", "EM_PAGAMENTO", "EM_PROCESSAMENTO"]);

/**
 * Lê o detalhe da Cora (`GET /v2/invoices/:id`) e diz a situação do boleto:
 * 'aberto' | 'pago' | 'em_processamento' | 'cancelado' | 'indeterminado'.
 *
 * Qualquer sinal de pagamento (total_paid > 0 ou lista `payments` não vazia) conta como
 * pago mesmo que o status ainda diga aberto: cobrar quem pagou é o erro a evitar.
 */
function situacaoNaCora(detalhe, coraDep) {
  if (!detalhe || !detalhe.status) return "indeterminado";
  const status = String(detalhe.status).toUpperCase();
  if (coraDep.ehCancelado(status)) return "cancelado";
  if (coraDep.mapCoraStatusToPortal(status) === "paid") return "pago";
  if (STATUS_EM_PROCESSAMENTO.has(status)) return "em_processamento";
  if (Number(detalhe.total_paid) > 0) return "pago";
  if (Array.isArray(detalhe.payments) && detalhe.payments.length > 0) return "pago";
  if (STATUS_ABERTO.has(status)) return "aberto";
  return "indeterminado";
}

const MOTIVO_NAO_COBRAR = {
  pago: "já pago na Cora",
  em_processamento: "pagamento em processamento na Cora",
  cancelado: "cancelado na Cora",
  indeterminado: "consulta na Cora sem resposta conclusiva — não cobrado por segurança",
  sem_vinculo: "boleto sem vínculo com a Cora — não cobrado por segurança",
};

/**
 * Regra 2: consulta ativa, na hora, do boleto na Cora. Nunca lança.
 * Devolve { cobrar, situacao, status, motivo }; `cobrar` só é true com 'aberto'.
 */
async function consultaAtivaCora(externalRef, coraDep) {
  const invoiceId = String(externalRef || "").replace(/^cora_/, "").trim();
  if (!invoiceId) {
    return { cobrar: false, situacao: "sem_vinculo", status: null, motivo: MOTIVO_NAO_COBRAR.sem_vinculo };
  }
  let detalhe = null;
  try {
    detalhe = await coraDep.getInvoiceDetail(invoiceId);
  } catch (err) {
    console.error(`[cobranca] consulta Cora ${invoiceId}:`, err.message);
  }
  const situacao = situacaoNaCora(detalhe, coraDep);
  return {
    cobrar: situacao === "aberto",
    situacao,
    status: detalhe?.status || null,
    motivo: situacao === "aberto" ? null : MOTIVO_NAO_COBRAR[situacao],
  };
}

module.exports = {
  COMPENSACAO_DIAS_BANCARIOS,
  calendarioCobranca,
  liberadoParaCobrar,
  situacaoNaCora,
  consultaAtivaCora,
};
