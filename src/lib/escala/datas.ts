/**
 * Aritmética de datas da escala. Mesma decisão de api/src/diasBancarios.js: datas são
 * strings 'YYYY-MM-DD' e as contas usam Date.UTC, que não desloca com o fuso.
 */

const DIA_MS = 86400000;

export function paraUTC(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

export function paraISO(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function somarDias(iso: string, n: number): string {
  return paraISO(paraUTC(iso) + n * DIA_MS);
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(iso: string): number {
  return new Date(paraUTC(iso)).getUTCDay();
}

/** Domingo que abre a semana da data (semana de domingo a sábado). */
export function inicioDaSemana(iso: string): string {
  return somarDias(iso, -diaDaSemana(iso));
}

export function diasEntre(de: string, ate: string): number {
  return Math.round((paraUTC(ate) - paraUTC(de)) / DIA_MS);
}

/** 'HH:MM' -> minutos desde a meia-noite. */
export function hhmmParaMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minParaHhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
