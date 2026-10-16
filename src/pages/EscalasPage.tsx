import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarRange } from "lucide-react";
import { PlanejadorEscala } from "@/components/escala/PlanejadorEscala";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { empresaEh12x36 } from "@/lib/suspensaoPeriodo";

/** Planejador de escalas no portal. Só aparece depois que o escritório libera na empresa. */
const EscalasPage = () => {
  const navigate = useNavigate();
  const { company } = useAuth();

  const { data: funcionarios, isLoading } = useQuery({
    queryKey: ["employees", company?.id],
    queryFn: () => api.employees.list({ companyId: company!.id }),
    enabled: Boolean(company?.id),
  });

  const pessoas = useMemo(
    () => (funcionarios || []).filter((f) => f.active).map((f) => ({ id: f.id, name: f.name })),
    [funcionarios],
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-20 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <CalendarRange className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Escalas de trabalho</h1>
              <p className="text-xs text-muted-foreground">Planeje escalas e folgas para o fim da 6x1</p>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl p-4">
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <PlanejadorEscala
            pessoas={pessoas}
            regime12x36Padrao={empresaEh12x36({ escala12x36: company?.escala12x36, cnpj: company?.cnpj })}
          />
        )}
      </main>
    </div>
  );
};

export default EscalasPage;
