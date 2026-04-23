import { differenceInCalendarDays, endOfMonth, isWithinInterval, startOfMonth } from "date-fns";

export type PeriodMode = "worked_days" | "start_in_month" | "closed_month";

const DIAS_MES_FECHADO = 30;
const DIVISOR_SALARIO = 30;

export interface AdhocSalaryInput {
  salarioBase: number;
  modo: PeriodMode;
  /** Modo 3.1: dias informados pelo utilizador */
  diasTrabalhadosInformado: number | null;
  /** Mês de referência (qualquer dia dentro do mês; usamos início do mês internamente) */
  refMonth: Date;
  /** Modo 3.2: primeiro dia efectivo no mês de referência */
  dataInicioNoMes: Date | null;
  faltas: Date[];
  descontoVale: number;
  descontosOutros: number;
}

export interface AdhocSalaryResult {
  valorDia: number;
  diasBrutos: number;
  faltasCount: number;
  /** Dias do período menos faltas (só referência; o bruto não é calculado com este valor). */
  diasLiquidos: number;
  /** Provento: valor/dia × dias brutos (conforme 3.1 / 3.2 / 3.3), sem subtrair faltas. */
  bruto: number;
  /** Desconto por faltas: valor/dia × número de faltas. */
  descontoFaltas: number;
  descontoVale: number;
  descontosOutros: number;
  liquido: number;
}

export function uniqueFaltaCount(faltas: Date[]): number {
  const keys = new Set(faltas.map((d) => formatDayKey(d)));
  return keys.size;
}

function formatDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Valor de um dia de salário (base ÷ 30). */
export function valorDiaFromBase(salarioBase: number): number {
  return salarioBase / DIVISOR_SALARIO;
}

/** Dias brutos conforme o modo, antes de subtrair faltas. */
export function computeDiasBrutos(
  modo: PeriodMode,
  diasTrabalhadosInformado: number | null,
  refMonth: Date,
  dataInicioNoMes: Date | null
): { diasBrutos: number; error?: string } {
  const monthStart = startOfMonth(refMonth);
  const monthEnd = endOfMonth(refMonth);

  if (modo === "closed_month") {
    return { diasBrutos: DIAS_MES_FECHADO };
  }

  if (modo === "worked_days") {
    const n = diasTrabalhadosInformado;
    if (n == null || !Number.isFinite(n) || n < 1 || n > 31) {
      return { diasBrutos: 0, error: "Informe de 1 a 31 dias trabalhados." };
    }
    return { diasBrutos: Math.floor(n) };
  }

  if (modo === "start_in_month") {
    if (!dataInicioNoMes) {
      return { diasBrutos: 0, error: "Informe a data de início no mês." };
    }
    if (
      !isWithinInterval(dataInicioNoMes, {
        start: monthStart,
        end: monthEnd,
      })
    ) {
      return { diasBrutos: 0, error: "A data de início deve estar dentro do mês de referência." };
    }
    const dias = differenceInCalendarDays(monthEnd, dataInicioNoMes) + 1;
    return { diasBrutos: dias };
  }

  return { diasBrutos: 0, error: "Modo inválido." };
}

export function calculateAdhocSalary(input: AdhocSalaryInput): { ok: true; data: AdhocSalaryResult } | { ok: false; error: string } {
  if (!Number.isFinite(input.salarioBase) || input.salarioBase <= 0) {
    return { ok: false, error: "Salário base deve ser maior que zero." };
  }
  if (input.descontoVale < 0 || input.descontosOutros < 0) {
    return { ok: false, error: "Descontos não podem ser negativos." };
  }

  const { diasBrutos, error } = computeDiasBrutos(
    input.modo,
    input.diasTrabalhadosInformado,
    input.refMonth,
    input.dataInicioNoMes
  );
  if (error) return { ok: false, error };

  const faltasCount = uniqueFaltaCount(input.faltas);
  if (faltasCount > diasBrutos) {
    return {
      ok: false,
      error: `O número de faltas (${faltasCount}) não pode ser maior que os dias do período (${diasBrutos}).`,
    };
  }

  const diasLiquidos = Math.max(0, diasBrutos - faltasCount);
  const valorDia = valorDiaFromBase(input.salarioBase);
  const valorDiaR = Math.round(valorDia * 100) / 100;

  const bruto = Math.round(valorDia * diasBrutos * 100) / 100;
  const descontoFaltas = Math.round(valorDia * faltasCount * 100) / 100;
  const liquido = Math.round(
    (bruto - descontoFaltas - input.descontoVale - input.descontosOutros) * 100
  ) / 100;

  if (liquido < 0) {
    return {
      ok: false,
      error: "O líquido ficaria negativo. Revise faltas ou descontos.",
    };
  }

  return {
    ok: true,
    data: {
      valorDia: valorDiaR,
      diasBrutos,
      faltasCount,
      diasLiquidos,
      bruto,
      descontoFaltas,
      descontoVale: input.descontoVale,
      descontosOutros: input.descontosOutros,
      liquido,
    },
  };
}

/** Interpreta valor monetário (ex.: 3500, 3500,50 ou 1.500,75). */
export function parseMoneyBR(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) {
    const [a, ...rest] = t.split(",");
    const dec = (rest.join("") || "0").slice(0, 2);
    const intPart = a.replace(/\./g, "");
    const n = parseFloat(`${intPart}.${dec}`);
    if (Number.isNaN(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  }
  const n = parseFloat(t.replace(/\./g, ""));
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
