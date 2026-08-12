import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarSearch, Check, Loader2, Sparkles, X } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

function formatDate(date: string | null): string {
  if (!date) return "—";
  return date.split("-").reverse().join("/");
}

function mesAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

function OrigemBadge({
  origem,
  confianca,
  providerIa,
}: {
  origem: "deterministico" | "ia";
  confianca: number | null;
  providerIa: string | null;
}) {
  if (origem === "ia") {
    return (
      <Badge className="bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30">
        <Sparkles className="mr-1 h-3 w-3" />
        IA{providerIa ? ` (${providerIa})` : ""}
        {confianca != null ? ` — ${confianca}%` : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <CalendarSearch className="mr-1 h-3 w-3" /> Rótulo no PDF
    </Badge>
  );
}

const VencimentosSugeridosPage = () => {
  const queryClient = useQueryClient();
  const [desde, setDesde] = useState(mesAtual());

  const { data: sugestoes, isLoading } = useQuery({
    queryKey: ["admin-vencimentos-sugeridos"],
    queryFn: () => api.vencimentosSugeridos.list(),
  });

  const rodar = useMutation({
    mutationFn: () => api.vencimentosSugeridos.rodar(desde),
    onSuccess: (r) => {
      toast.success(
        `Varredura concluída: ${r.processados} documento(s) analisados, ${r.sugestoes_criadas} sugestão(ões) nova(s).`
      );
      queryClient.invalidateQueries({ queryKey: ["admin-vencimentos-sugeridos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aprovar = useMutation({
    mutationFn: (id: string) => api.vencimentosSugeridos.aprovar(id),
    onSuccess: () => {
      toast.success("Vencimento aplicado ao calendário.");
      queryClient.invalidateQueries({ queryKey: ["admin-vencimentos-sugeridos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejeitar = useMutation({
    mutationFn: (id: string) => api.vencimentosSugeridos.rejeitar(id),
    onSuccess: () => {
      toast.success("Sugestão rejeitada.");
      queryClient.invalidateQueries({ queryKey: ["admin-vencimentos-sugeridos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminLayout
      title="Vencimentos sugeridos"
      description="Vencimento encontrado em documento (determinístico ou por IA) fica aqui até você decidir — nunca é aplicado sozinho ao calendário."
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarSearch className="h-4 w-4" /> Rodar varredura
            </CardTitle>
            <CardDescription>
              Varre documentos sem vencimento cadastrado a partir da competência escolhida (nunca o histórico
              inteiro). Primeiro tenta o rótulo do PDF; se não achar, tenta a IA configurada em{" "}
              <span className="font-medium">Configuração de IA</span>, quando habilitada para esta tarefa.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-end gap-3">
            <div>
              <Label>A partir da competência</Label>
              <Input
                type="month"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="mt-1 max-w-[180px]"
              />
            </div>
            <Button onClick={() => rodar.mutate()} disabled={rodar.isPending}>
              {rodar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Rodar agora
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fila de revisão</CardTitle>
            <CardDescription>
              {sugestoes ? `${sugestoes.length} sugestão(ões) pendente(s).` : "Carregando..."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !sugestoes?.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma sugestão pendente. Rode a varredura acima para procurar por novos vencimentos.
              </p>
            ) : (
              <div className="space-y-3">
                {sugestoes.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{s.company_nome}</span>
                        <span className="text-xs text-muted-foreground">{s.company_cnpj}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {s.title} · {s.category}
                        {s.competencia ? ` · competência ${s.competencia}` : ""}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Badge variant="outline">Vencimento sugerido: {formatDate(s.data_sugerida)}</Badge>
                        <OrigemBadge origem={s.origem} confianca={s.confianca} providerIa={s.provider_ia} />
                      </div>
                      {s.motivo && <p className="text-xs text-muted-foreground">{s.motivo}</p>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => rejeitar.mutate(s.id)}
                        disabled={rejeitar.isPending || aprovar.isPending}
                      >
                        <X className="mr-1 h-4 w-4" /> Rejeitar
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => aprovar.mutate(s.id)}
                        disabled={rejeitar.isPending || aprovar.isPending}
                      >
                        <Check className="mr-1 h-4 w-4" /> Aprovar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default VencimentosSugeridosPage;
