/**
 * Regras da reforma tributária do consumo que o simulador de regime usa — um número por
 * linha, com o ano em que vale e a norma de onde veio. Lei nova = linha nova (ou número
 * corrigido) aqui; o cálculo (simular.ts) não muda. Ver docs/PLANO-SIMULADOR-REGIME.md.
 *
 * Base em 26/10/2026: EC 132/2023 (ADCT, arts. 125 a 133), LC 214/2025, LC 227/2026,
 * LC 235/2026, Decreto 12.955/2026 (RCBS), Resolução CGIBS 6/2026 (RIBS) e Resoluções
 * CGSN 186/2026 e 194/2026 (prazos de opção).
 */

/** Data até a qual estas regras foram revistas. A tela mostra ao usuário. */
export const REGRAS_ATUALIZADAS_EM = "2026-10-26";

export interface Fonte {
  norma: string;
  trecho: string;
  /** false = número tirado de fonte secundária ou estimativa; a tela marca como "a conferir". */
  conferido: boolean;
}

export interface RegraAno {
  ano: number;
  /** Alíquota da CBS no regime regular, em %. */
  cbs: number;
  /** Alíquota do IBS (estadual + municipal) no regime regular, em %. */
  ibs: number;
  /** Quanto do ICMS/ISS ainda existe fora do Simples (1 = inteiro, 0 = extinto). */
  icmsIssRestante: number;
  /**
   * Quanto da parcela de ICMS/ISS do DAS já virou IBS (0 a 1). A parcela de PIS/Cofins
   * vira CBS inteira a partir de 2027.
   */
  ibsNoDas: number;
}

/**
 * Alíquotas de referência estimadas (CBS 8,8% + IBS 17,7% = 26,5%, estimativa da Fazenda
 * usada na tramitação da LC 214). A CBS de 2027 sai de resolução do Senado prevista até
 * 15/12/2026; IBS de cada estado e município é lei local. O usuário pode trocar na tela.
 */
export const REFERENCIA_ESTIMADA = { cbs: 8.8, ibs: 17.7 };

/**
 * Transição (EC 132, ADCT arts. 125 a 129): 2027-2028 CBS cheia menos 0,1 ponto e IBS de
 * 0,1%; de 2029 a 2032 ICMS e ISS caem para 9/10, 8/10, 7/10 e 6/10 enquanto o IBS sobe
 * na mesma medida; 2033 só IBS e CBS.
 */
export function regrasDoAno(ano: number, ref = REFERENCIA_ESTIMADA): RegraAno {
  if (ano <= 2026) return { ano, cbs: 0, ibs: 0, icmsIssRestante: 1, ibsNoDas: 0 };
  if (ano <= 2028) return { ano, cbs: Math.round((ref.cbs - 0.1) * 1000) / 1000, ibs: 0.1, icmsIssRestante: 1, ibsNoDas: 0 };
  if (ano >= 2033) return { ano, cbs: ref.cbs, ibs: ref.ibs, icmsIssRestante: 0, ibsNoDas: 1 };
  const passo = ano - 2028; // 2029 = 1 … 2032 = 4
  return { ano, cbs: ref.cbs, ibs: ref.ibs * (passo / 10), icmsIssRestante: 1 - passo / 10, ibsNoDas: passo / 10 };
}

export const ANOS_SIMULADOS = [2027, 2028, 2029, 2030, 2031, 2032, 2033];

/** Reduções de alíquota da LC 214 que o questionário oferece (art. 9º e anexos). */
export const REDUCOES = [
  { valor: 0, nome: "Alíquota cheia", exemplo: "Comércio e serviços em geral" },
  { valor: 30, nome: "Redução de 30%", exemplo: "Profissões regulamentadas (advogado, contador, engenheiro…), LC 214 art. 127" },
  { valor: 60, nome: "Redução de 60%", exemplo: "Saúde, educação, alimentos e insumos agropecuários, LC 214 arts. 128 a 138" },
  { valor: 100, nome: "Alíquota zero", exemplo: "Cesta básica nacional e outros itens zerados, LC 214 art. 125" },
] as const;

/** Fora do Simples: Lucro Presumido (Lei 9.249/1995, arts. 15 e 20; Lei 9.430/1996). */
export const PRESUMIDO = {
  presuncaoIrpj: { comercio: 0.08, industria: 0.08, servico: 0.32 },
  presuncaoCsll: { comercio: 0.12, industria: 0.12, servico: 0.32 },
  irpj: 0.15,
  adicionalIrpj: 0.1,
  /** Adicional de 10% sobre a base que passar de R$ 20 mil por mês. */
  limiteAdicionalAno: 240_000,
  csll: 0.09,
} as const;

/**
 * INSS patronal fora do DAS: 20% + RAT (média 2%) + terceiros (5,8%) sobre salários e 20%
 * sobre pró-labore. No Anexo IV do Simples paga-se 20% + RAT, sem terceiros (LC 123, art. 18, § 5º-C).
 */
export const INSS_PATRONAL = {
  salariosForaDoSimples: 0.278,
  salariosAnexoIV: 0.22,
  proLabore: 0.2,
} as const;

export interface Prazo {
  inicio: string;
  fim: string;
  oQue: string;
  fonte: Fonte;
}

/** Janelas de opção e de desistência do regime regular de IBS/CBS no Simples. */
export const PRAZOS: Prazo[] = [
  {
    inicio: "2026-09-01",
    fim: "2026-10-30",
    oQue: "Optar pelo IBS/CBS por fora (regime regular) para o 1º semestre de 2027",
    fonte: { norma: "Resolução CGSN 194/2026", trecho: "prorroga a Res. CGSN 186/2026", conferido: false },
  },
  {
    inicio: "2026-11-03",
    fim: "2026-12-20",
    oQue: "Cancelar a opção feita para 2027, em caráter irretratável",
    fonte: { norma: "Resolução CGSN 194/2026", trecho: "cancelamento", conferido: false },
  },
  {
    inicio: "2027-03-01",
    fim: "2027-03-31",
    oQue: "Optar pelo IBS/CBS por fora para o 2º semestre de 2027",
    fonte: { norma: "Resolução CGSN 186/2026", trecho: "opção semestral", conferido: false },
  },
];

/** Prazos que ainda não acabaram em `hoje` ('YYYY-MM-DD'), do mais próximo ao mais distante. */
export function prazosAbertos(hoje: string): Array<Prazo & { aberto: boolean }> {
  return PRAZOS.filter((p) => p.fim >= hoje).map((p) => ({ ...p, aberto: p.inicio <= hoje }));
}

/** De onde vem cada regra que o cálculo usa. A tela lista tudo na aba "Regras". */
export const FONTES: Array<{ regra: string } & Fonte> = [
  { regra: "Tabelas e partilha dos Anexos I a V", norma: "LC 123/2006, Anexos (redação LC 155/2016)", trecho: "art. 18", conferido: false },
  { regra: "IBS e CBS dentro do DAS; opção por recolher por fora", norma: "LC 214/2025 (altera a LC 123)", trecho: "arts. 41 e 516 e seguintes", conferido: false },
  { regra: "Crédito que o comprador toma de quem está no Simples = IBS/CBS pago no DAS", norma: "LC 214/2025", trecho: "art. 47, § 9º", conferido: false },
  { regra: "CBS a partir de 2027, IBS de 0,1% em 2027-2028", norma: "EC 132/2023, ADCT", trecho: "arts. 125 a 127", conferido: false },
  { regra: "ICMS e ISS caem 10% ao ano de 2029 a 2032 e acabam em 2033", norma: "EC 132/2023, ADCT", trecho: "art. 128", conferido: false },
  { regra: "Parcela de ICMS/ISS do DAS migra para IBS no mesmo ritmo", norma: "LC 214/2025", trecho: "transição do Simples", conferido: false },
  { regra: "Alíquotas de referência CBS 8,8% e IBS 17,7%", norma: "Estimativa da Fazenda; CBS 2027 por resolução do Senado (até 15/12/2026)", trecho: "LC 214, arts. 18 a 20", conferido: false },
  { regra: "Reduções de 30%, 60% e alíquota zero", norma: "LC 214/2025", trecho: "arts. 125 a 138", conferido: false },
  { regra: "Lucro Presumido: presunção 8%/12% e 32%", norma: "Lei 9.249/1995 e Lei 9.430/1996", trecho: "arts. 15 e 20", conferido: false },
];
