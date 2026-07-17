import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { PortalPage } from "@/components/PortalPage";
import { DeliverableCard } from "@/components/DeliverableCard";
import { api, type Deliverable } from "@/lib/api";
import { parseDue, formatDue } from "@/lib/deliverableDisplay";
import { useAuth } from "@/hooks/useAuth";

const CalendarioPage = () => {
  const { company } = useAuth();
  const [selected, setSelected] = useState<Date | undefined>(undefined);

  const { data, isLoading, error } = useQuery({
    queryKey: ["deliverables-calendar"],
    queryFn: () => api.deliverables.calendar(),
    enabled: !!company,
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Deliverable[]>();
    for (const d of data ?? []) {
      if (!d.due_date) continue;
      const list = map.get(d.due_date) ?? [];
      list.push(d);
      map.set(d.due_date, list);
    }
    return map;
  }, [data]);

  // Um dia com qualquer pendência conta como pendente; só fica "pago" quando tudo do dia foi quitado.
  const marks = useMemo(() => {
    const today = startOfToday();
    const overdue: Date[] = [];
    const pending: Date[] = [];
    const paid: Date[] = [];
    for (const [key, list] of byDay) {
      const date = parseDue(key);
      if (!date) continue;
      if (!list.some((d) => d.status === "pending")) paid.push(date);
      else if (date < today) overdue.push(date);
      else pending.push(date);
    }
    return { overdue, pending, paid };
  }, [byDay]);

  const selectedKey = selected ? format(selected, "yyyy-MM-dd") : "";
  const dayItems = selectedKey ? byDay.get(selectedKey) ?? [] : [];
  const totalPendentes = (data ?? []).filter((d) => d.status === "pending").length;

  return (
    <PortalPage title="Calendário de vencimentos" subtitle={company?.name} wide>
      <div className="space-y-4">
        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error instanceof Error ? error.message : "Erro ao carregar"}
          </p>
        ) : (
          <>
            <Card>
              <CardContent className="p-3 sm:p-4">
                {isLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
                ) : (
                  <Calendar
                    mode="single"
                    selected={selected}
                    onSelect={setSelected}
                    locale={ptBR}
                    showOutsideDays
                    modifiers={{
                      overdue: marks.overdue,
                      pending: marks.pending,
                      paid: marks.paid,
                    }}
                    modifiersClassNames={{
                      overdue: "bg-destructive/20 text-destructive font-bold rounded-md",
                      pending: "bg-primary/20 text-primary font-bold rounded-md",
                      paid: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-md",
                    }}
                    className="pointer-events-auto mx-auto"
                  />
                )}
                <div className="mt-3 flex flex-wrap justify-center gap-4 border-t pt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-destructive/40" /> Vencida
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-primary/40" /> A vencer
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-emerald-500/40" /> Pago
                  </span>
                </div>
              </CardContent>
            </Card>

            {!isLoading && byDay.size === 0 && (
              <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
                <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Nenhum vencimento registado. As guias enviadas pela contabilidade são marcadas aqui
                  automaticamente.
                </p>
              </div>
            )}

            {selected && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold">
                  {formatDue(selectedKey)}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {dayItems.length === 0
                      ? "· nada a pagar neste dia"
                      : `· ${dayItems.length} ${dayItems.length === 1 ? "documento" : "documentos"}`}
                  </span>
                </h2>
                {dayItems.map((d) => (
                  <DeliverableCard key={d.id} deliverable={d} showPayment />
                ))}
              </div>
            )}

            {!selected && byDay.size > 0 && (
              <p className="text-center text-sm text-muted-foreground">
                Toque num dia marcado para ver o que vence.
                {totalPendentes > 0 && (
                  <>
                    {" "}
                    Há <strong className="text-foreground">{totalPendentes}</strong>{" "}
                    {totalPendentes === 1 ? "documento pendente" : "documentos pendentes"}.
                  </>
                )}
              </p>
            )}
          </>
        )}
      </div>
    </PortalPage>
  );
};

export default CalendarioPage;
