/**
 * Simulação de contingente: quantas pessoas a empresa precisa para cobrir a demanda de
 * cada dia da semana, em cada fase da EC 141/2026, e quanto isso custa.
 *
 * Conta em "dias-pessoa" por semana: a demanda soma quantas pessoas trabalham em cada
 * dia (domingo a sábado); cada pessoa entrega no máximo os dias que a regra permite —
 * o menor entre (7 − repousos) e (limite semanal ÷ horas por dia). Um turno de 8h na
 * regra de 44h dá 5,5 dias (5 dias + meio sábado); na de 40h, 5.
 *
 * É estimativa de quadro mínimo: não conta férias, faltas nem faixas de horário no dia.
 */
import { VIGENCIAS } from "./regras";

/** Pessoas necessárias por dia da semana, de domingo (0) a sábado (6). */
export type Demanda = [number, number, number, number, number, number, number];

export const DEMANDA_VAZIA: Demanda = [0, 0, 0, 0, 0, 0, 0];

/** FGTS sobre o salário — o mesmo encargo usado no custo de férias (Simples Nacional). */
const FGTS = 0.08;

export interface Cenario {
  nome: string;
  limiteSemanalHoras: number;
  diasPorPessoa: number;
  pessoas: number;
  custoMensal: number | null;
}

export function diasPorPessoa(limiteSemanalHoras: number, repousos: number, horasPorDia: number): number {
  if (horasPorDia <= 0) return 0;
  return Math.min(7 - repousos, limiteSemanalHoras / horasPorDia);
}

export function pessoasNecessarias(demanda: Demanda, capacidade: number): number {
  const total = demanda.reduce((a, b) => a + Math.max(0, b), 0);
  if (total === 0) return 0;
  if (capacidade <= 0) return Infinity;
  // Arredonda para cima, mas tolera ruído de ponto flutuante (5,5 dias × 2 = 11).
  const porDias = Math.ceil(total / capacidade - 1e-9);
  return Math.max(porDias, ...demanda);
}

export function compararCenarios(demanda: Demanda, horasPorDia: number, salarioMedio: number | null): Cenario[] {
  const custo = (n: number) => (salarioMedio && salarioMedio > 0 && Number.isFinite(n) ? n * salarioMedio * (1 + FGTS) : null);
  const fases: Cenario[] = VIGENCIAS.map((v) => {
    const cap = diasPorPessoa(v.limiteSemanalHoras, v.repousosSemanais, horasPorDia);
    const pessoas = pessoasNecessarias(demanda, cap);
    return { nome: v.nome, limiteSemanalHoras: v.limiteSemanalHoras, diasPorPessoa: cap, pessoas, custoMensal: custo(pessoas) };
  });
  // 12x36: cada pessoa faz 3,5 plantões por semana, em média, e cada plantão cobre o dia.
  const p12 = pessoasNecessarias(demanda, 3.5);
  fases.push({ nome: "12x36 (plantões de 12h)", limiteSemanalHoras: 42, diasPorPessoa: 3.5, pessoas: p12, custoMensal: custo(p12) });
  return fases;
}
