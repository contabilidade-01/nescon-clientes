/**
 * Tabelas do Simples Nacional: alíquota nominal, parcela a deduzir e repartição (partilha)
 * de cada faixa dos Anexos I a V da LC 123/2006, na redação da LC 155/2016.
 *
 * A partilha é o que diz quanto do DAS é PIS/Cofins (vira CBS em 2027) e quanto é
 * ICMS/ISS (vira IBS de 2029 a 2033) — é dela que sai o crédito que o Simples puro
 * repassa ao comprador e o quanto o DAS encolhe no regime híbrido.
 */

export type Anexo = "I" | "II" | "III" | "IV" | "V";

export interface Partilha {
  irpj: number;
  csll: number;
  cofins: number;
  pis: number;
  /** Contribuição patronal. No Anexo IV fica fora do DAS (0 aqui). */
  cpp: number;
  /** Só no Anexo II. */
  ipi: number;
  /** ICMS (Anexos I e II) ou ISS (III, IV e V). */
  local: number;
}

export interface Faixa {
  /** Receita bruta dos 12 meses (RBT12) até a qual a faixa vale, em R$. */
  ate: number;
  /** Alíquota nominal, em % . */
  aliquota: number;
  deduzir: number;
  /** Repartição dos tributos, em % do DAS (soma 100). */
  partilha: Partilha;
}

const p = (irpj: number, csll: number, cofins: number, pis: number, cpp: number, ipi: number, local: number): Partilha => ({
  irpj, csll, cofins, pis, cpp, ipi, local,
});

/** Limites de faixa, iguais nos cinco anexos. */
const LIMITES = [180_000, 360_000, 720_000, 1_800_000, 3_600_000, 4_800_000];

/** Teto do Simples (LC 123, art. 3º, II). */
export const TETO_SIMPLES = 4_800_000;
/** Acima disto ICMS e ISS saem do DAS e são pagos pela regra normal (LC 123, art. 13-A). */
export const SUBLIMITE_ICMS_ISS = 3_600_000;
/** Fator R: folha de 12 meses / RBT12 >= 28% leva a atividade do Anexo V para o III. */
export const FATOR_R_MINIMO = 0.28;

function faixas(linhas: Array<[number, number, Partilha]>): Faixa[] {
  return linhas.map(([aliquota, deduzir, partilha], i) => ({ ate: LIMITES[i], aliquota, deduzir, partilha }));
}

export const ANEXOS: Record<Anexo, { nome: string; faixas: Faixa[] }> = {
  I: {
    nome: "Anexo I — Comércio",
    faixas: faixas([
      [4.0, 0, p(5.5, 3.5, 12.74, 2.76, 41.5, 0, 34.0)],
      [7.3, 5_940, p(5.5, 3.5, 12.74, 2.76, 41.5, 0, 34.0)],
      [9.5, 13_860, p(5.5, 3.5, 12.74, 2.76, 42.0, 0, 33.5)],
      [10.7, 22_500, p(5.5, 3.5, 12.74, 2.76, 42.0, 0, 33.5)],
      [14.3, 87_300, p(5.5, 3.5, 12.74, 2.76, 42.0, 0, 33.5)],
      [19.0, 378_000, p(13.5, 10.0, 28.27, 6.13, 42.1, 0, 0)],
    ]),
  },
  II: {
    nome: "Anexo II — Indústria",
    faixas: faixas([
      [4.5, 0, p(5.5, 3.5, 11.51, 2.49, 37.5, 7.5, 32.0)],
      [7.8, 5_940, p(5.5, 3.5, 11.51, 2.49, 37.5, 7.5, 32.0)],
      [10.0, 13_860, p(5.5, 3.5, 11.51, 2.49, 37.5, 7.5, 32.0)],
      [11.2, 22_500, p(5.5, 3.5, 11.51, 2.49, 37.5, 7.5, 32.0)],
      [14.7, 85_500, p(5.5, 3.5, 11.51, 2.49, 37.5, 7.5, 32.0)],
      [30.0, 720_000, p(8.5, 7.5, 20.96, 4.54, 23.5, 35.0, 0)],
    ]),
  },
  III: {
    nome: "Anexo III — Serviços (com fator R ou sem ele)",
    faixas: faixas([
      [6.0, 0, p(4.0, 3.5, 12.82, 2.78, 43.4, 0, 33.5)],
      [11.2, 9_360, p(4.0, 3.5, 14.05, 3.05, 43.4, 0, 32.0)],
      [13.5, 17_640, p(4.0, 3.5, 13.64, 2.96, 43.4, 0, 32.5)],
      [16.0, 35_640, p(4.0, 3.5, 13.64, 2.96, 43.4, 0, 32.5)],
      [21.0, 125_640, p(4.0, 3.5, 12.82, 2.78, 43.4, 0, 33.5)],
      [33.0, 648_000, p(35.0, 15.0, 16.03, 3.47, 30.5, 0, 0)],
    ]),
  },
  IV: {
    nome: "Anexo IV — Construção, vigilância, limpeza, advocacia (INSS patronal fora do DAS)",
    faixas: faixas([
      [4.5, 0, p(18.8, 15.2, 17.67, 3.83, 0, 0, 44.5)],
      [9.0, 8_100, p(19.8, 15.2, 20.55, 4.45, 0, 0, 40.0)],
      [10.2, 12_420, p(20.8, 15.2, 19.73, 4.27, 0, 0, 40.0)],
      [14.0, 39_780, p(17.8, 19.2, 18.9, 4.1, 0, 0, 40.0)],
      [22.0, 183_780, p(18.8, 19.2, 18.08, 3.92, 0, 0, 40.0)],
      [33.0, 828_000, p(53.5, 21.5, 20.55, 4.45, 0, 0, 0)],
    ]),
  },
  V: {
    nome: "Anexo V — Serviços intelectuais com fator R abaixo de 28%",
    faixas: faixas([
      [15.5, 0, p(25.0, 15.0, 14.1, 3.05, 28.85, 0, 14.0)],
      [18.0, 4_500, p(23.0, 15.0, 14.1, 3.05, 27.85, 0, 17.0)],
      [19.5, 9_900, p(24.0, 15.0, 14.92, 3.23, 23.85, 0, 19.0)],
      [20.5, 17_100, p(21.0, 15.0, 15.74, 3.41, 23.85, 0, 21.0)],
      [23.0, 62_100, p(23.0, 12.5, 14.1, 3.05, 23.85, 0, 23.5)],
      [30.5, 540_000, p(35.0, 15.5, 16.44, 3.56, 29.5, 0, 0)],
    ]),
  },
};

export function faixaDe(anexo: Anexo, rbt12: number): { faixa: Faixa; numero: number } {
  const lista = ANEXOS[anexo].faixas;
  const i = lista.findIndex((f) => rbt12 <= f.ate);
  const numero = i === -1 ? lista.length - 1 : i;
  return { faixa: lista[numero], numero: numero + 1 };
}

/**
 * Alíquota efetiva (LC 123, art. 18, § 1º-A): (RBT12 × nominal − parcela a deduzir) / RBT12.
 * Devolvida como fração (0,0565 = 5,65%). Na 1ª faixa é a própria nominal.
 */
export function aliquotaEfetiva(anexo: Anexo, rbt12: number): number {
  const { faixa } = faixaDe(anexo, rbt12);
  if (rbt12 <= 0) return ANEXOS[anexo].faixas[0].aliquota / 100;
  return Math.max(0, (rbt12 * (faixa.aliquota / 100) - faixa.deduzir) / rbt12);
}

/** ISS dentro do DAS não passa de 5% da receita (Anexos III, IV e V, nota da 5ª faixa). */
const ISS_MAXIMO = 0.05;

/**
 * Partilha que vale para esta receita, em fração do DAS (soma 1). Se o ISS efetivo passar
 * de 5%, o excesso vai para os tributos federais na proporção deles, como manda a nota
 * da 5ª faixa dos Anexos III, IV e V.
 */
export function partilhaEfetiva(anexo: Anexo, rbt12: number): Partilha {
  const { faixa } = faixaDe(anexo, rbt12);
  const fr = Object.fromEntries(Object.entries(faixa.partilha).map(([k, v]) => [k, v / 100])) as unknown as Partilha;
  const ehIss = anexo === "III" || anexo === "IV" || anexo === "V";
  const ef = aliquotaEfetiva(anexo, rbt12);
  if (!ehIss || ef * fr.local <= ISS_MAXIMO) return fr;
  const local = ISS_MAXIMO / ef;
  const sobra = fr.local - local;
  const federais = fr.irpj + fr.csll + fr.cofins + fr.pis + fr.cpp;
  const mais = (v: number) => v + (sobra * v) / federais;
  return {
    irpj: mais(fr.irpj),
    csll: mais(fr.csll),
    cofins: mais(fr.cofins),
    pis: mais(fr.pis),
    cpp: mais(fr.cpp),
    ipi: fr.ipi,
    local,
  };
}
