import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api, type Deliverable, type DeliverableStatus } from "@/lib/api";
import { openDeliverableFile } from "@/lib/openFile";
import { DueBadge } from "@/components/DueBadge";
import { competenciaLabel, formatDue, dueTone, DUE_TONE_CLASS } from "@/lib/deliverableDisplay";
import { toast } from "sonner";

type Props = {
  deliverable: Deliverable;
  /** Mostra vencimento, situação e o botão de marcar pago (guias). */
  showPayment?: boolean;
  /** Exibe a competência ao lado do tipo. */
  showCompetencia?: boolean;
};

/** Card de uma entrega, com abrir e marcar pago. Usado na lista, no calendário e nos próximos pagamentos. */
export function DeliverableCard({ deliverable: d, showPayment = false, showCompetencia = true }: Props) {
  const queryClient = useQueryClient();
  const [opening, setOpening] = useState(false);
  const tone = dueTone(d.due_date, d.status);
  // Documento de carga histórica: é arquivo, não conta a pagar. Sem esta distinção o
  // selo diria "Venceu há 200 dias" em vermelho para uma guia de janeiro que o cliente
  // trouxe justamente para consultar — e o portal passaria a acusar dívida inexistente.
  const ehHistorico = Boolean(d.historico);
  const mostrarCobranca = showPayment && !ehHistorico;

  const setStatus = useMutation({
    mutationFn: (next: DeliverableStatus) => api.deliverables.setStatus(d.id, next),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["deliverables"] });
      queryClient.invalidateQueries({ queryKey: ["deliverables-upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["deliverables-calendar"] });
      toast.success(updated.status === "paid" ? "Marcado como pago" : "Voltou para pendente");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const open = async () => {
    setOpening(true);
    try {
      await openDeliverableFile(d.id, d.file_name, d.pdf_url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o documento");
    } finally {
      setOpening(false);
    }
  };

  return (
    <Card
      className={cn(
        "rounded-2xl border bg-card/70 transition-colors hover:bg-card",
        tone === "overdue" && !ehHistorico && "border-destructive/40"
      )}
    >
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {d.doc_type && (
              <Badge variant="secondary" className="font-mono text-[10px] tracking-wide">
                {d.doc_type}
              </Badge>
            )}
            {ehHistorico ? (
              <Badge variant="outline" className="text-[10px]">
                histórico
              </Badge>
            ) : (
              showPayment && <DueBadge dueDate={d.due_date} status={d.status} />
            )}
            {showCompetencia && d.competencia && (
              <span className="text-xs text-muted-foreground">{competenciaLabel(d.competencia)}</span>
            )}
          </div>
          <p className="mt-1.5 truncate font-semibold">{d.title}</p>
          {mostrarCobranca && d.due_date && (
            <p className={cn("mt-0.5 text-sm", DUE_TONE_CLASS[tone])}>
              Vence em {formatDue(d.due_date)}
            </p>
          )}
          {ehHistorico && d.due_date && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Venceu em {formatDue(d.due_date)} · documento de arquivo
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={open} disabled={opening}>
            {opening ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <FileText className="mr-1 h-4 w-4" /> Abrir
              </>
            )}
          </Button>
          {mostrarCobranca && (
            <Button
              variant={d.status === "paid" ? "ghost" : "default"}
              size="sm"
              onClick={() => setStatus.mutate(d.status === "paid" ? "pending" : "paid")}
              disabled={setStatus.isPending}
            >
              {d.status === "paid" ? (
                <>
                  <RotateCcw className="mr-1 h-4 w-4" /> Reabrir
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Paguei
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
