import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { PortalPage } from "@/components/PortalPage";
import { DeliverableCard } from "@/components/DeliverableCard";
import { api, type Deliverable } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { formatDue, parseDue } from "@/lib/deliverableDisplay";
import { startOfToday } from "date-fns";

/** Vencidas primeiro (cobrança), depois as futuras em ordem de vencimento. */
function splitByDue(items: Deliverable[]) {
  const today = startOfToday();
  const overdue: Deliverable[] = [];
  const upcoming: Deliverable[] = [];
  for (const d of items) {
    const date = parseDue(d.due_date);
    if (date && date < today) overdue.push(d);
    else upcoming.push(d);
  }
  return { overdue, upcoming };
}

const ProximosPagamentosPage = () => {
  const { company } = useAuth();

  // /upcoming já vem ordenado por vencimento e inclui as vencidas.
  const { data, isLoading, error } = useQuery({
    queryKey: ["deliverables-upcoming", "all"],
    queryFn: () => api.deliverables.upcoming({ limit: 100 }),
    enabled: !!company,
  });

  const { overdue, upcoming } = useMemo(() => splitByDue(data ?? []), [data]);

  return (
    <PortalPage title="Próximos pagamentos" subtitle={company?.name}>
      <div className="space-y-6">
        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error instanceof Error ? error.message : "Erro ao carregar"}
          </p>
        ) : isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
        ) : overdue.length === 0 && upcoming.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600/70" />
            <p className="mt-2 text-sm font-medium text-foreground">Nada pendente</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Não há guias em aberto. Novos vencimentos aparecem aqui assim que a contabilidade
              enviar.
            </p>
          </div>
        ) : (
          <>
            {overdue.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-destructive">
                  Em atraso ({overdue.length})
                </h2>
                {overdue.map((d) => (
                  <DeliverableCard key={d.id} deliverable={d} showPayment />
                ))}
              </section>
            )}

            {upcoming.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">
                  A vencer ({upcoming.length})
                  {upcoming[0]?.due_date && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      · próximo em {formatDue(upcoming[0].due_date)}
                    </span>
                  )}
                </h2>
                {upcoming.map((d) => (
                  <DeliverableCard key={d.id} deliverable={d} showPayment />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </PortalPage>
  );
};

export default ProximosPagamentosPage;
