/**
 * Simulador de regime para empresas do Simples Nacional depois da reforma: compara, ano a
 * ano, o Simples puro (IBS/CBS dentro do DAS), o híbrido (Simples com IBS/CBS por fora,
 * no regime regular) e a saída para o Lucro Presumido.
 *
 * Régua da comparação: o comprador paga o mesmo nos três cenários.
 *  - Quem compra e toma crédito (empresa do regime regular) mantém o mesmo custo LÍQUIDO:
 *    no Simples puro ele paga R e recupera o IBS/CBS que veio no DAS; no híbrido a empresa
 *    cobra uma base menor e destaca o IBS/CBS por fora, que ele recupera inteiro.
 *  - Quem não toma crédito (consumidor, empresa do Simples, governo) paga o mesmo valor
 *    BRUTO: no híbrido a base é o preço dividido por (1 + alíquota).
 * Assim o resultado mostra quanto SOBRA para a empresa em cada regime, sem mexer no
 * preço que o mercado sente. Compras, folha e demais custos são os mesmos nos três; só
 * entram os créditos que cada regime deixa aproveitar.
 */
import { ANEXOS, FATOR_R_MINIMO, SUBLIMITE_ICMS_ISS, TETO_SIMPLES, aliquotaEfetiva, faixaDe, partilhaEfetiva, type Anexo } from "./simples";
import { ANOS_SIMULADOS, INSS_PATRONAL, PRESUMIDO, REFERENCIA_ESTIMADA, regrasDoAno } from "./regras";

export type Atividade = "comercio" | "industria" | "servico";
export type Cenario = "puro" | "hibrido" | "presumido";

export const CENARIOS: Record<Cenario, { nome: string; curto: string; explicacao: string }> = {
  puro: {
    nome: "Simples puro",
    curto: "IBS/CBS dentro do DAS",
    explicacao: "Paga tudo no DAS. O comprador só toma de crédito o IBS/CBS que veio no DAS.",
  },
  hibrido: {
    nome: "Simples híbrido",
    curto: "IBS/CBS por fora",
    explicacao: "Continua no Simples, mas IBS e CBS saem do DAS e são apurados à parte, com crédito integral nas compras e para o comprador.",
  },
  presumido: {
    nome: "Lucro Presumido",
    curto: "Fora do Simples",
    explicacao: "Sai do Simples: IBS/CBS no regime regular, IRPJ e CSLL presumidos, INSS patronal sobre a folha e ICMS/ISS até 2032.",
  },
};

export interface DadosRegime {
  atividade: Atividade;
  /** Só serviço: anexo da atividade (III, IV ou V). V com fator R >= 28% vira III. */
  anexoServico: "III" | "IV" | "V";
  /** Serviço sujeito ao fator R (Anexo V que pode ir ao III). */
  sujeitoFatorR: boolean;
  /** Redução de IBS/CBS das próprias vendas (0, 30, 60 ou 100). */
  reducao: number;
  /** Faturamento médio por mês, em R$ (preço cheio, como sai hoje na nota). */
  receitaMensal: number;
  /** Quem compra, em % da receita (soma 100). */
  vendas: { regular: number; simples: number; consumidor: number; governo: number; exportacao: number };
  /** % das vendas de mercadoria com ICMS por substituição tributária (ICMS fora da conta do DAS). */
  pctIcmsSt: number;
  /** Compras e despesas por mês, em R$, pelo valor total da nota. */
  comprasRegular: number;
  comprasSimples: number;
  /** Salários por mês (sem pró-labore), em R$. */
  folhaSalarios: number;
  proLabore: number;
  /** Fora do Simples: ICMS ou ISS efetivo, em % da receita, já descontados os créditos de ICMS. */
  icmsIssForaSimples: number;
  /** Alíquotas de referência; padrão = estimativa (regras.ts). */
  cbsReferencia: number;
  ibsReferencia: number;
}

export function dadosPadrao(): DadosRegime {
  return {
    atividade: "comercio",
    anexoServico: "III",
    sujeitoFatorR: false,
    reducao: 0,
    receitaMensal: 0,
    vendas: { regular: 0, simples: 0, consumidor: 100, governo: 0, exportacao: 0 },
    pctIcmsSt: 0,
    comprasRegular: 0,
    comprasSimples: 0,
    folhaSalarios: 0,
    proLabore: 0,
    icmsIssForaSimples: 0,
    cbsReferencia: REFERENCIA_ESTIMADA.cbs,
    ibsReferencia: REFERENCIA_ESTIMADA.ibs,
  };
}

/** Anexo em que a empresa cai hoje, aplicando o fator R quando for o caso. */
export function anexoDe(d: DadosRegime): { anexo: Anexo; fatorR: number | null } {
  if (d.atividade === "comercio") return { anexo: "I", fatorR: null };
  if (d.atividade === "industria") return { anexo: "II", fatorR: null };
  const receita = d.receitaMensal * 12;
  const fatorR = receita > 0 ? ((d.folhaSalarios + d.proLabore) * 12) / receita : 0;
  if (d.sujeitoFatorR) return { anexo: fatorR >= FATOR_R_MINIMO ? "III" : "V", fatorR };
  return { anexo: d.anexoServico, fatorR: null };
}

export interface ResultadoCenario {
  cenario: Cenario;
  /** Quanto fica com a empresa no ano depois dos tributos, em R$. A régua da comparação. */
  sobra: number;
  /** Receita sem IBS/CBS por fora (a base que a empresa cobra). */
  receita: number;
  das: number;
  /** IBS/CBS a recolher por fora: débito menos crédito (negativo = saldo credor). */
  ibsCbs: number;
  creditosCompras: number;
  /** IRPJ + CSLL (só fora do Simples). */
  irpjCsll: number;
  /** INSS patronal fora do DAS. */
  inss: number;
  /** ICMS/ISS fora do DAS (só fora do Simples). */
  icmsIss: number;
  /** Total pago ao fisco (sem o IBS/CBS que o comprador recupera). */
  tributos: number;
  /** Crédito que os compradores do regime regular tomam por ano. */
  creditoAoComprador: number;
}

export interface ResultadoAno {
  ano: number;
  cenarios: Record<Cenario, ResultadoCenario>;
  melhor: Cenario;
}

interface Contexto {
  d: DadosRegime;
  anexo: Anexo;
  ano: number;
}

const soma = (v: DadosRegime["vendas"]) => v.regular + v.simples + v.consumidor + v.governo + v.exportacao;

/** Fatias da receita em fração (normalizadas para somar 1). */
function fatias(d: DadosRegime) {
  const t = soma(d.vendas) || 1;
  return {
    regular: d.vendas.regular / t,
    semCredito: (d.vendas.simples + d.vendas.consumidor + d.vendas.governo) / t,
    exportacao: d.vendas.exportacao / t,
  };
}

/** Fração do DAS que é IBS/CBS no ano, e a que é ICMS/ISS. */
function pesosDoDas(anexo: Anexo, rbt12: number, ano: number) {
  const pt = partilhaEfetiva(anexo, rbt12);
  const r = regrasDoAno(ano);
  const cbs = ano >= 2027 ? pt.pis + pt.cofins : 0;
  const ibs = pt.local * r.ibsNoDas;
  const icmsIss = pt.local - ibs;
  return { cbs, ibs, icmsIss, partilha: pt };
}

/**
 * DAS do ano sobre uma receita doméstica e de exportação. Exportação não paga PIS/Cofins
 * (CBS), ICMS/ISS nem IBS dentro do DAS (LC 123, art. 18, § 4º-A, IV e § 14); a parte com
 * ICMS-ST não paga a parcela de ICMS. `semIbsCbs` tira a parcela de IBS/CBS (híbrido).
 */
function das(c: Contexto, rbt12: number, domestica: number, exportacao: number, semIbsCbs: boolean): number {
  const ef = aliquotaEfetiva(c.anexo, rbt12);
  const w = pesosDoDas(c.anexo, rbt12, c.ano);
  const acimaDoSublimite = rbt12 > SUBLIMITE_ICMS_ISS;
  const tirarIbsCbs = semIbsCbs ? w.cbs + w.ibs : 0;
  const ehMercadoria = c.anexo === "I" || c.anexo === "II";
  const st = ehMercadoria ? c.d.pctIcmsSt / 100 : 0;
  // Acima do sublimite a partilha já vem com ICMS/ISS zerado (6ª faixa) ou é cobrado fora.
  const tirarLocal = acimaDoSublimite ? 0 : w.icmsIss;
  const fatorDom = 1 - tirarIbsCbs - st * tirarLocal;
  const fatorExp = 1 - w.cbs - w.ibs - tirarLocal;
  return ef * (domestica * fatorDom + exportacao * Math.max(0, fatorExp));
}

/** Crédito que o comprador toma de cada R$ 1 comprado de quem está no Simples puro. */
export function creditoDoSimples(anexo: Anexo, rbt12: number, ano: number): number {
  const w = pesosDoDas(anexo, rbt12, ano);
  return aliquotaEfetiva(anexo, rbt12) * (w.cbs + w.ibs);
}

/** Crédito médio de uma compra de fornecedor do Simples (comércio típico: Anexo I, 3ª faixa). */
function creditoFornecedorSimples(ano: number): number {
  return creditoDoSimples("I", 540_000, ano);
}

function aliquotasDoAno(d: DadosRegime, ano: number) {
  const r = regrasDoAno(ano, { cbs: d.cbsReferencia, ibs: d.ibsReferencia });
  const cheia = (r.cbs + r.ibs) / 100;
  return { r, saida: cheia * (1 - d.reducao / 100), entrada: cheia };
}

function creditosDeCompras(d: DadosRegime, ano: number): number {
  const { entrada } = aliquotasDoAno(d, ano);
  // Nota do regime regular: o valor pago já tem o IBS/CBS por fora somado.
  const doRegular = d.comprasRegular * 12 * (entrada / (1 + entrada));
  const doSimples = d.comprasSimples * 12 * creditoFornecedorSimples(ano);
  return doRegular + doSimples;
}

/**
 * Bases que a empresa cobra no regime regular (híbrido e presumido) mantendo o preço que
 * o comprador sente (ver o topo do arquivo).
 */
function basesRegulares(d: DadosRegime, anexo: Anexo, ano: number) {
  const R = d.receitaMensal * 12;
  const f = fatias(d);
  const { saida } = aliquotasDoAno(d, ano);
  const k = creditoDoSimples(anexo, R, ano);
  const regular = R * f.regular * (1 - k);
  const semCredito = (R * f.semCredito) / (1 + saida);
  const exportacao = R * f.exportacao;
  return { regular, semCredito, exportacao, domestica: regular + semCredito, total: regular + semCredito + exportacao, saida };
}

function simularPuro(c: Contexto): ResultadoCenario {
  const { d, anexo, ano } = c;
  const R = d.receitaMensal * 12;
  const f = fatias(d);
  const valorDas = das(c, R, R * (1 - f.exportacao), R * f.exportacao, false);
  const inss = anexo === "IV" ? d.folhaSalarios * 12 * INSS_PATRONAL.salariosAnexoIV + d.proLabore * 12 * INSS_PATRONAL.proLabore : 0;
  const tributos = valorDas + inss;
  return {
    cenario: "puro",
    sobra: R - tributos,
    receita: R,
    das: valorDas,
    ibsCbs: 0,
    creditosCompras: 0,
    irpjCsll: 0,
    inss,
    icmsIss: 0,
    tributos,
    creditoAoComprador: R * f.regular * creditoDoSimples(anexo, R, ano),
  };
}

function simularHibrido(c: Contexto): ResultadoCenario {
  const { d, anexo, ano } = c;
  const b = basesRegulares(d, anexo, ano);
  // RBT12 do híbrido: a receita sem o IBS/CBS por fora.
  const valorDas = das(c, b.total, b.domestica, b.exportacao, true);
  const debito = b.domestica * b.saida;
  const creditos = creditosDeCompras(d, ano);
  const inss = anexo === "IV" ? d.folhaSalarios * 12 * INSS_PATRONAL.salariosAnexoIV + d.proLabore * 12 * INSS_PATRONAL.proLabore : 0;
  const ibsCbs = debito - creditos;
  // O débito é cobrado do comprador na nota; o que pesa para a empresa é DAS + INSS − créditos.
  return {
    cenario: "hibrido",
    sobra: b.total + creditos - valorDas - inss,
    receita: b.total,
    das: valorDas,
    ibsCbs,
    creditosCompras: creditos,
    irpjCsll: 0,
    inss,
    icmsIss: 0,
    tributos: valorDas + inss - creditos,
    creditoAoComprador: b.regular * b.saida,
  };
}

function simularPresumido(c: Contexto): ResultadoCenario {
  const { d, anexo, ano } = c;
  const b = basesRegulares(d, anexo, ano);
  const { r } = aliquotasDoAno(d, ano);
  const tipo = d.atividade;
  const baseIrpj = b.total * PRESUMIDO.presuncaoIrpj[tipo];
  const irpj = baseIrpj * PRESUMIDO.irpj + Math.max(0, baseIrpj - PRESUMIDO.limiteAdicionalAno) * PRESUMIDO.adicionalIrpj;
  const csll = b.total * PRESUMIDO.presuncaoCsll[tipo] * PRESUMIDO.csll;
  const icmsIss = b.domestica * (d.icmsIssForaSimples / 100) * r.icmsIssRestante;
  const inss = d.folhaSalarios * 12 * INSS_PATRONAL.salariosForaDoSimples + d.proLabore * 12 * INSS_PATRONAL.proLabore;
  const creditos = creditosDeCompras(d, ano);
  const tributos = irpj + csll + icmsIss + inss - creditos;
  return {
    cenario: "presumido",
    sobra: b.total - tributos,
    receita: b.total,
    das: 0,
    ibsCbs: b.domestica * b.saida - creditos,
    creditosCompras: creditos,
    irpjCsll: irpj + csll,
    inss,
    icmsIss,
    tributos,
    creditoAoComprador: b.regular * b.saida,
  };
}

export function simularAno(d: DadosRegime, ano: number): ResultadoAno {
  const { anexo } = anexoDe(d);
  const c = { d, anexo, ano };
  const cenarios = { puro: simularPuro(c), hibrido: simularHibrido(c), presumido: simularPresumido(c) };
  const melhor = (Object.keys(cenarios) as Cenario[]).reduce((a, b) => (cenarios[b].sobra > cenarios[a].sobra ? b : a), "puro" as Cenario);
  return { ano, cenarios, melhor };
}

export function simular(d: DadosRegime): ResultadoAno[] {
  return ANOS_SIMULADOS.map((ano) => simularAno(d, ano));
}

/**
 * A partir de que % de vendas a empresas do regime regular o híbrido passa a sobrar mais
 * que o puro, no ano. As demais fatias encolhem na proporção. null = não passa nem com 100%;
 * 0 = já compensa sem nenhuma.
 */
export function pontoDeVirada(d: DadosRegime, ano: number): number | null {
  const outros = soma(d.vendas) - d.vendas.regular;
  for (let pct = 0; pct <= 100; pct++) {
    const escala = outros > 0 ? (100 - pct) / outros : 0;
    const v = d.vendas;
    const teste: DadosRegime = {
      ...d,
      vendas: {
        regular: pct,
        simples: v.simples * escala,
        consumidor: outros > 0 ? v.consumidor * escala : 100 - pct,
        governo: v.governo * escala,
        exportacao: v.exportacao * escala,
      },
    };
    const r = simularAno(teste, ano).cenarios;
    if (r.hibrido.sobra >= r.puro.sobra) return pct;
  }
  return null;
}

export type Pendencia = { campo: string; texto: string; bloqueia: boolean };

/** O que falta ou não fecha nos dados. `bloqueia` = sem isto não dá para simular. */
export function pendencias(d: DadosRegime): Pendencia[] {
  const out: Pendencia[] = [];
  const R = d.receitaMensal * 12;
  if (d.receitaMensal <= 0) out.push({ campo: "receitaMensal", texto: "Informe o faturamento médio por mês.", bloqueia: true });
  const s = soma(d.vendas);
  if (Math.abs(s - 100) > 0.5) out.push({ campo: "vendas", texto: `As fatias de quem compra somam ${s.toFixed(0)}%; precisam somar 100%.`, bloqueia: true });
  if (R > TETO_SIMPLES) out.push({ campo: "receitaMensal", texto: "Faturamento acima de R$ 4,8 milhões por ano: a empresa sai do Simples, só o Lucro Presumido vale.", bloqueia: false });
  else if (R > SUBLIMITE_ICMS_ISS) out.push({ campo: "receitaMensal", texto: "Acima de R$ 3,6 milhões por ano o ICMS/ISS já é pago fora do DAS; o simulador ainda não soma esse valor no Simples.", bloqueia: false });
  if (d.comprasRegular + d.comprasSimples <= 0) out.push({ campo: "compras", texto: "Sem compras informadas, o híbrido e o Presumido aparecem sem créditos.", bloqueia: false });
  if (d.icmsIssForaSimples <= 0) out.push({ campo: "icmsIssForaSimples", texto: "Informe o ICMS ou ISS que pagaria fora do Simples; sem ele o Lucro Presumido sai barato demais até 2032.", bloqueia: false });
  if (d.atividade === "servico" && d.sujeitoFatorR && d.folhaSalarios + d.proLabore <= 0) out.push({ campo: "folha", texto: "Sem folha informada, o fator R fica zero e a empresa cai no Anexo V.", bloqueia: false });
  if (d.cbsReferencia === REFERENCIA_ESTIMADA.cbs && d.ibsReferencia === REFERENCIA_ESTIMADA.ibs) {
    out.push({ campo: "aliquotas", texto: "Alíquotas de IBS/CBS estimadas (8,8% + 17,7%); a CBS de 2027 sai até 15/12/2026.", bloqueia: false });
  }
  return out;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Recomendação para o ano da opção, com os motivos em frases. */
export function recomendacao(d: DadosRegime, anos: ResultadoAno[], anoDecisao = 2027) {
  const alvo = anos.find((a) => a.ano === anoDecisao) ?? anos[0];
  const c = alvo.cenarios;
  const ordem = (Object.keys(c) as Cenario[]).sort((a, b) => c[b].sobra - c[a].sobra);
  const melhor = ordem[0];
  const diferenca = c[melhor].sobra - c[ordem[1]].sobra;
  const motivos: string[] = [];
  const { anexo, fatorR } = anexoDe(d);
  const R = d.receitaMensal * 12;
  const { numero } = faixaDe(anexo, R);
  motivos.push(
    `Enquadramento: ${ANEXOS[anexo].nome}, ${numero}ª faixa, alíquota efetiva de ${(aliquotaEfetiva(anexo, R) * 100).toFixed(2).replace(".", ",")}%` +
      (fatorR !== null ? ` (fator R de ${(fatorR * 100).toFixed(0)}%).` : "."),
  );
  const virada = pontoDeVirada(d, anoDecisao);
  if (virada === null) motivos.push("O híbrido não compensa nem se todas as vendas fossem para empresas do regime regular.");
  else if (virada === 0) motivos.push("O híbrido compensa mesmo sem vendas para empresas do regime regular, pelos créditos das compras.");
  else motivos.push(`O híbrido passa a compensar quando mais de ${virada}% das vendas vão para empresas do regime regular; hoje são ${d.vendas.regular.toFixed(0)}%.`);
  if (c.hibrido.creditosCompras > 0) motivos.push(`No híbrido a empresa aproveitaria ${brl(c.hibrido.creditosCompras)} de créditos nas compras em ${alvo.ano}.`);
  if (c.hibrido.creditoAoComprador > c.puro.creditoAoComprador) {
    motivos.push(`Os clientes do regime regular tomariam ${brl(c.hibrido.creditoAoComprador)} de crédito no híbrido contra ${brl(c.puro.creditoAoComprador)} no Simples puro.`);
  }
  const ultimo = anos[anos.length - 1];
  if (ultimo.melhor !== melhor) motivos.push(`Em ${ultimo.ano}, com o IBS completo, o melhor passa a ser ${CENARIOS[ultimo.melhor].nome}: vale rever a opção a cada semestre.`);
  return { ano: alvo.ano, melhor, diferenca, motivos };
}
