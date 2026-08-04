import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Palmtree } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { PortalPage } from "@/components/PortalPage";
import { DeliverableCard } from "@/components/DeliverableCard";
import { api, type Deliverable, type VacationCalendarItem } from "@/lib/api";
import { parseDue, formatDue } from "@/lib/deliverableDisplay";
import { useAuth } from "@/hooks/useAuth";
import { isToolAllowed } from "@/lib/companyTools";
import { formatDateBR } from "@/lib/licenses";

const CalendarioPage = () => {
  const { company } = useAuth();
  const [selected, setSelected] = useState<Date | undefined>(undefined);

  const { data, isLoading, error } = useQuery({
    queryKey: ["deliverables-calendar"],
    queryFn: () => api.deliverables.calendar(),
    enabled: !!company,
  });

  // Férias entram no mesmo calendário, mas pela data de SEGURANÇA (30 dias antes do
  // limite oficial): marcar o limite seria avisar no dia em que já não dá para agir.
  const podeFerias = isToolAllowed(company?.toolAccess, "vacations");
  const { data: ferias } = useQuery({
    queryKey: ["ferias-calendario"],
    queryFn: () => api.ferias.calendario(),
    enabled: !!company && podeFerias,
  });

  const feriasPorDia = useMemo(() => {
    const map = new Map<string, VacationCalendarItem[]>();
    for (const f of ferias ?? []) {
      if (!f.data) continue;
      const lista = map.get(f.data) ?? [];
      lista.push(f);
      map.set(f.data, lista);
    }
    return map;
  }, [ferias]);

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

  const marcasFerias = useMemo(
    () => [...feriasPorDia.keys()].map((k) => parseDue(k)).filter((d): d is Date => !!d),
    [feriasPorDia]
  );

  const selectedKey = selected ? format(selected, "yyyy-MM-dd") : "";
  const dayItems = selectedKey ? byDay.get(selectedKey) ?? [] : [];
  const feriasDoDia = selectedKey ? feriasPorDia.get(selectedKey) ?? [] : [];
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
                      ferias: marcasFerias,
                    }}
                    modifiersClassNames={{
                      overdue: "bg-destructive/20 text-destructive font-bold rounded-md",
                      pending: "bg-primary/20 text-primary font-bold rounded-md",
                      paid: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-md",
                      ferias: "ring-2 ring-amber-500/60 rounded-md",
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
                  {podeFerias && (
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-sm ring-2 ring-amber-500/60" /> Programar férias
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            {!isLoading && byDay.size === 0 && feriasPorDia.size === 0 && (
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
                    {dayItems.length === 0 && feriasDoDia.length === 0
                      ? "· nada neste dia"
                      : dayItems.length > 0
                        ? `· ${dayItems.length} ${dayItems.length === 1 ? "documento" : "documentos"}`
                        : ""}
                  </span>
                </h2>
                {feriasDoDia.map((f) => (
                  <div
                    key={`${f.nome}-${f.limite_oficial}`}
                    className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                  >
                    <Palmtree className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      <strong>{f.nome}</strong> — hora de programar as férias ({f.dias} dias).
                      <span className="block text-xs text-muted-foreground">
                        O prazo legal termina em {formatDateBR(f.limite_oficial)}; este aviso vem 30
                        dias antes.
                      </span>
                    </span>
                  </div>
                ))}
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
