import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { lerSalvo, type RegimeSalvo as Salvo } from "@/lib/regime/salvo";
import type { DadosRegime } from "@/lib/regime/simular";
import { PainelCenarios } from "./PainelCenarios";
import { Questionario } from "./Questionario";
import { RegrasPrazos } from "./RegrasPrazos";

const hojeIso = () => new Date().toISOString().slice(0, 10);

/**
 * Simulador de regime no Simples depois da reforma. O escritório passa `companyId`
 * (simula qualquer cliente); no portal o cliente usa sem ele.
 */
export function SimuladorRegime({ companyId }: { companyId?: string }) {
  const qc = useQueryClient();
  const chave = ["regime", companyId ?? "eu"];
  const { data, isLoading } = useQuery({ queryKey: chave, queryFn: () => api.regime.carregar(companyId) });
  const [estado, setEstado] = useState<Salvo | null>(null);
  const [aba, setAba] = useState("questionario");

  useEffect(() => {
    if (!data) return;
    const s = lerSalvo(data.dados);
    setEstado(s);
    setAba(s.questionarioConcluido ? "cenarios" : "questionario");
  }, [data]);

  const salvar = useMutation({
    mutationFn: (s: Salvo) => api.regime.salvar(s, companyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chave });
      toast.success("Simulação salva.");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar."),
  });

  if (isLoading || !estado) return <Skeleton className="h-64 w-full" />;

  const setDados = (dados: DadosRegime) => setEstado({ ...estado, dados });

  return (
    <Tabs value={aba} onValueChange={setAba} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="questionario">1. Questionário</TabsTrigger>
          <TabsTrigger value="cenarios">2. Cenários</TabsTrigger>
          <TabsTrigger value="regras">Regras e prazos</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          {data?.atualizado_em && (
            <span className="text-xs text-muted-foreground">
              Salvo em {new Date(data.atualizado_em).toLocaleString("pt-BR")}
            </span>
          )}
          <Button size="sm" variant="outline" disabled={salvar.isPending} onClick={() => salvar.mutate(estado)}>
            <Save className="mr-1 h-4 w-4" /> Salvar
          </Button>
        </div>
      </div>
      <TabsContent value="questionario">
        <Questionario
          dados={estado.dados}
          onChange={setDados}
          salvando={salvar.isPending}
          onConcluir={() => {
            const s = { ...estado, questionarioConcluido: true };
            setEstado(s);
            salvar.mutate(s);
            setAba("cenarios");
          }}
        />
      </TabsContent>
      <TabsContent value="cenarios">
        <PainelCenarios dados={estado.dados} hoje={hojeIso()} />
      </TabsContent>
      <TabsContent value="regras">
        <RegrasPrazos dados={estado.dados} />
      </TabsContent>
    </Tabs>
  );
}
