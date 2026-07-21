import { cn } from "@/lib/utils";
import { dueTone, dueText, DUE_BADGE_CLASS } from "@/lib/deliverableDisplay";
import type { DeliverableStatus } from "@/lib/api";

type Props = {
  dueDate: string | null | undefined;
  status: DeliverableStatus;
  className?: string;
};

/**
 * Selo de urgência do vencimento ("Vence hoje", "Venceu há 3 dias").
 * A cor é o sinal principal da tela — vermelho vencido, âmbar perto, verde pago.
 */
export function DueBadge({ dueDate, status, className }: Props) {
  if (!dueDate && status !== "paid") return null;
  const tone = dueTone(dueDate, status);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold",
        DUE_BADGE_CLASS[tone],
        className
      )}
    >
      {dueText(dueDate, status)}
    </span>
  );
}
