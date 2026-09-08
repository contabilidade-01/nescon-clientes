import { addDays } from "date-fns";

/**
 * Empresas que já operam em 12x36 (Queijeiro 3 e 4). A coluna `escala_12x36` liga
 * qualquer outra; estas duas não podem cair em dia corrido só porque a sessão
 * aberta ainda não carrega a flag.
 */
const CNPJ_12X36 = new Set(["52191264000173", "54803962000108"]);

export function empresaEh12x36({
  escala12x36,
  cnpj,
}: {
  escala12x36?: boolean | null;
  cnpj?: string | null;
}): boolean {
  if (escala12x36 === true) return true;
  const digits = String(cnpj || "").replace(/\D/g, "");
  return CNPJ_12X36.has(digits);
}

/**
 * Período de uma suspensão disciplinar: último dia suspenso e data de retorno.
 *
 * Duas escalas, duas contagens — e é essa diferença que gerava a data errada:
 *
 * - **Normal (6x1, 5x2…)**: "N dias" são N dias CORRIDOS. Retorno no dia seguinte ao fim.
 *
 * - **12x36**: o empregado trabalha dia sim, dia não. Aqui "N dias" significa **N
 *   plantões**, não N dias de calendário — suspender "1 dia" tirando um plantão e
 *   mandando voltar no dia seguinte é inócuo, porque o dia seguinte já seria folga dele.
 *   Então os plantões suspensos andam de 2 em 2 dias, e o retorno é no plantão seguinte
 *   ao último suspenso (fim + 2), pulando a folga.
 *
 * Premissa (decisão do escritório): a data de início informada É um dia de plantão. O
 * sistema não guarda em qual ciclo (par/ímpar) cada empregado está, então confia no que
 * o admin digitou em vez de adivinhar.
 */
export function calcularPeriodoSuspensao({
  inicio,
  dias,
  escala12x36,
}: {
  inicio: Date;
  dias: number;
  escala12x36: boolean;
}): { fim: Date; retorno: Date } {
  const n = Math.max(1, Math.floor(dias) || 1);
  const passo = escala12x36 ? 2 : 1;
  const fim = addDays(inicio, (n - 1) * passo);
  const retorno = addDays(fim, passo);
  return { fim, retorno };
}
