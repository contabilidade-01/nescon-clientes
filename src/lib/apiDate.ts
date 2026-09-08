/**
 * Datas vindas de colunas DATE do backend.
 *
 * Cuidado histórico: o Postgres (via driver `pg` + `res.json()`) serializa uma
 * coluna DATE como ISO UTC COMPLETO — ex. "2026-09-07T03:00:00.000Z" — e não como
 * "2026-09-07". Por isso concatenar "T12:00:00" direto no valor gerava
 * "2026-09-07T03:00:00.000ZT12:00:00" = Invalid Date, e o date-fns estourava
 * (RangeError: Invalid time value) ao formatar/gerar documento.
 *
 * `dateFromApi` pega só a parte YYYY-MM-DD e fixa meio-dia LOCAL, o que ao mesmo
 * tempo evita o Invalid Date e impede a data de "andar" um dia por causa de fuso.
 * Aceita tanto "YYYY-MM-DD" quanto o ISO completo. Devolve null se não der para ler.
 */
export function dateFromApi(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dia = String(value).slice(0, 10);
  const d = new Date(`${dia}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Igual a `dateFromApi`, mas nunca devolve null: cai no `fallback` (tipicamente o
 * created_at, um TIMESTAMPTZ que o `new Date(iso)` lê sem problema) e, em último
 * caso, na data de hoje. Para telas que precisam sempre de uma Date válida.
 */
export function dateFromApiOr(value: string | null | undefined, fallbackIso: string): Date {
  const d = dateFromApi(value);
  if (d) return d;
  const fb = new Date(fallbackIso);
  return Number.isNaN(fb.getTime()) ? new Date() : fb;
}
