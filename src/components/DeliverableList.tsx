import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Label } from "@/components/ui/label";
import { api, type DeliverableCategory, type DeliverableStatus } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { DeliverableCard } from "@/components/DeliverableCard";
import { competenciaLabel } from "@/lib/deliverableDisplay";

type Props = {
  category: DeliverableCategory;
  emptyText: string;
  /** Guias: mostra vencimento, situação e o botão de marcar pago. */
  showPayment?: boolean;
};

export function DeliverableList({ category, emptyText, showPayment = false }: Props) {
  const { company } = useAuth();
  const [competencia, setCompetencia] = useState("");
  const [status, setStatus] = useState<"" | DeliverableStatus>("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["deliverables", category],
    queryFn: () => api.deliverables.list({ category }),
    enabled: !!company,
  });

  // Filtrar no cliente mantém a lista de competências estável ao trocar de filtro.
  const competencias = useMemo(() => {
    const set = new Set((data ?? []).map((d) => d.competencia).filter((c): c is string => !!c));
    return [...set].sort().reverse();
  }, [data]);

  const items = useMemo(
    () =>
      (data ?? []).filter((d) => {
        if (competencia && d.competencia !== competencia) return false;
        if (status && d.status !== status) return false;
        return true;
      }),
    [data, competencia, status]
  );

  if (error) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error instanceof Error ? error.message : "Erro ao carregar"}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {(competencias.length > 1 || showPayment) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {competencias.length > 1 && (
            <div>
              <Label className="text-xs">Competência</Label>
              <select
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
              >
                <option value="">Todas</option>
                {competencias.map((c) => (
                  <option key={c} value={c}>
                    {competenciaLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {showPayment && (
            <div>
              <Label className="text-xs">Situação</Label>
              <select
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as "" | DeliverableStatus)}
              >
                <option value="">Todas</option>
                <option value="pending">A pagar</option>
                <option value="paid">Pagas</option>
              </select>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-2 text-sm text-muted-foreground">
            {data?.length ? "Nada encontrado com estes filtros." : emptyText}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((d) => (
            <DeliverableCard key={d.id} deliverable={d} showPayment={showPayment} />
          ))}
        </div>
      )}
    </div>
  );
}
