/**
 * Regras de jornada que o planejador de escalas aplica — EC 141/2026 (fim da 6x1) + CLT.
 *
 * A emenda foi promulgada em 16/10/2026, mas o texto ainda não saiu no Diário Oficial
 * e as matérias divergem em detalhes. Por isso TODO número que vem da emenda mora aqui,
 * numa tabela por vigência: quando o texto oficial sair, corrige-se esta tabela e o
 * resto do motor não muda.
 *
 * Vigências (datas contadas da promulgação; conferir com o DOU):
 *  - até 14/12/2026: regra antiga — 44h semanais, 1 repouso semanal.
 *  - a partir de 15/12/2026 (promulgação + 60 dias): 42h semanais, 2 repousos semanais.
 *  - a partir de 15/12/2027 (etapa 1 + 12 meses): 40h semanais, 2 repousos semanais.
 *
 * O limite diário de 8h (CF art. 7º, XIII) não muda com a emenda.
 */

export type Segmento = "construcao_civil" | "restaurante" | "comercio" | "outro";

export interface Vigencia {
  /** Primeiro dia em que a regra vale, 'YYYY-MM-DD'. */
  inicio: string;
  nome: string;
  limiteSemanalHoras: number;
  /** Repousos semanais remunerados por semana (domingo a sábado). */
  repousosSemanais: number;
}

export const VIGENCIAS: Vigencia[] = [
  { inicio: "1988-10-05", nome: "Regra anterior (CLT, 44h)", limiteSemanalHoras: 44, repousosSemanais: 1 },
  { inicio: "2026-12-15", nome: "EC 141/2026 — etapa 1 (42h)", limiteSemanalHoras: 42, repousosSemanais: 2 },
  { inicio: "2027-12-15", nome: "EC 141/2026 — etapa 2 (40h)", limiteSemanalHoras: 40, repousosSemanais: 2 },
];

/** Regra em vigor numa data 'YYYY-MM-DD' (datas ISO ordenam como texto). */
export function vigenciaEm(data: string): Vigencia {
  let atual = VIGENCIAS[0];
  for (const v of VIGENCIAS) if (v.inicio <= data) atual = v;
  return atual;
}

/** Limites da CLT que valem para qualquer vigência. */
export const CLT = {
  limiteDiarioHoras: 8,
  /** Art. 59: até 2h extras por dia. Acima de 10h trabalhadas é irregular (fora a 12x36). */
  maxHorasExtrasDia: 2,
  /** Art. 66: 11h entre o fim de uma jornada e o início da próxima. */
  interjornadaHoras: 11,
  /** Art. 67 + OJ 410 TST: o repouso não pode passar do 7º dia — no máximo 6 dias seguidos. */
  maxDiasSeguidos: 6,
  /** Art. 71: acima de 6h, intervalo de 1h (30min com acordo coletivo, art. 611-A, III). */
  intervaloAcimaDe6hMin: 60,
  intervaloAcimaDe6hComAcordoMin: 30,
  /** Art. 71 §1º: acima de 4h e até 6h, 15 minutos. */
  intervaloAte6hMin: 15,
  /** 12x36 (art. 59-A): plantão de 12h. */
  plantao12x36Horas: 12,
} as const;

export interface RegraSegmento {
  nome: string;
  /** O repouso precisa cair no domingo ao menos 1 vez a cada N semanas. */
  domingoACadaSemanas: number;
  /** Trabalho em feriado só com autorização em convenção coletiva (Lei 10.101/2000, art. 6º-A). */
  feriadoExigeConvencao: boolean;
}

/**
 * Comércio: domingo de folga a cada 3 semanas (Lei 10.101/2000, art. 6º, parágrafo único).
 * Demais: a regra geral de escala de revezamento, a cada 7 semanas (Portaria MTPS 417/1966).
 */
export const SEGMENTOS: Record<Segmento, RegraSegmento> = {
  construcao_civil: { nome: "Construção civil", domingoACadaSemanas: 7, feriadoExigeConvencao: false },
  restaurante: { nome: "Restaurante / bar", domingoACadaSemanas: 7, feriadoExigeConvencao: false },
  comercio: { nome: "Comércio em geral", domingoACadaSemanas: 3, feriadoExigeConvencao: true },
  outro: { nome: "Outro", domingoACadaSemanas: 7, feriadoExigeConvencao: false },
};

/** O que a empresa (e o empregado) informam e muda a régua. */
export interface PerfilJornada {
  segmento: Segmento;
  /**
   * Há acordo/convenção coletiva que permite compensação. Com ele, os repousos e as horas
   * são cobrados pela média do mês e o intervalo pode cair para 30min.
   */
  temAcordoColetivo: boolean;
  /**
   * Empregado com nível superior e salário >= 2,5x o teto do RGPS: fora das regras de
   * duração da jornada da emenda, mas mantém o repouso semanal.
   */
  hipersuficiente?: boolean;
  /**
   * Regime 12x36 (art. 59-A). A emenda mantém o regime, mas a média semanal dele (42h)
   * passa do limite novo: a validação avisa em vez de barrar, porque a saída é a
   * renegociação na convenção. É o mesmo dado de `companies.escala_12x36`.
   */
  regime12x36?: boolean;
}
