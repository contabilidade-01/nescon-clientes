import { format, differenceInCalendarDays, startOfToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { fromInputDateValue } from "@/components/DateField";
import type { DeliverableStatus } from "@/lib/api";

/** A API devolve 'YYYY-MM-DD'; converter para Date local evita o recuo de um dia por fuso. */
export function parseDue(due: string | null | undefined): Date | undefined {
  return due ? fromInputDateValue(due) : undefined;
}

export function formatDue(due: string | null | undefined): string {
  const d = parseDue(due);
  return d ? format(d, "dd/MM/yyyy", { locale: ptBR }) : "—";
}

/** 'YYYY-MM' → 'Julho de 2026' */
export function competenciaLabel(comp: string | null | undefined): string {
  if (!comp) return "—";
  const d = fromInputDateValue(`${comp}-01`);
  if (!d) return comp;
  const s = format(d, "MMMM 'de' yyyy", { locale: ptBR });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type DueTone = "overdue" | "today" | "soon" | "future" | "none";

export function dueTone(due: string | null | undefined, status: DeliverableStatus): DueTone {
  if (status === "paid") return "none";
  const d = parseDue(due);
  if (!d) return "none";
  const diff = differenceInCalendarDays(d, startOfToday());
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "soon";
  return "future";
}

export function dueText(due: string | null | undefined, status: DeliverableStatus): string {
  if (status === "paid") return "Pago";
  const d = parseDue(due);
  if (!d) return "Sem vencimento";
  const diff = differenceInCalendarDays(d, startOfToday());
  if (diff < 0) {
    const n = Math.abs(diff);
    return n === 1 ? "Venceu ontem" : `Venceu há ${n} dias`;
  }
  if (diff === 0) return "Vence hoje";
  if (diff === 1) return "Vence amanhã";
  return `Vence em ${diff} dias`;
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  overdue: "text-destructive font-semibold",
  today: "text-destructive font-semibold",
  soon: "text-amber-600 dark:text-amber-500 font-medium",
  future: "text-muted-foreground",
  none: "text-muted-foreground",
};
