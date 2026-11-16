import type { Deliverable } from "@/lib/api";

/** Dia de hoje em AAAA-MM-DD, no fuso do navegador (mesma base do vencimento). */
function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Guias e boletos dos últimos 90 dias e os próximos: pagas, a vencer e vencidas. */
export function situacaoPagamentos(itens: Deliverable[] | undefined, hoje = hojeIso()) {
  const inicio = new Date(`${hoje}T00:00:00`);
  inicio.setDate(inicio.getDate() - 90);
  const desde = inicio.toISOString().slice(0, 10);
  let pagas = 0;
  let aVencer = 0;
  let vencidas = 0;
  for (const d of itens ?? []) {
    if (d.historico || !d.due_date) continue;
    if (d.category !== "guia" && d.category !== "boleto") continue;
    const venc = d.due_date.slice(0, 10);
    if (venc < desde) continue;
    if (d.status === "paid") pagas++;
    else if (venc < hoje) vencidas++;
    else aVencer++;
  }
  return { pagas, aVencer, vencidas };
}
