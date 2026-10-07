/** Número digitado num input (aceita vírgula); inválido cai no `fallback`. */
export function num(v: string, fallback = 0): number {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}
