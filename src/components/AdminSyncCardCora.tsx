import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

/** Card do painel admin: dispara a busca de boletos na Cora e mostra o resultado. */
export function AdminSyncCardCora() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["admin-sync-cora-status"],
    queryFn: () => api.admin.coraSyncStatus(),
    // Enquanto está sincronizando, atualiza sozinho para o admin ver terminar.
    refetchInterval: (q) => (q.state.data?.rodando ? 3000 : false),
  });

  const run = useMutation({
    mutationFn: () => api.admin.runCorSync(),
    onSuccess: (r) => {
      toast.success(r.message);
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["admin-sync-cora-status"] }), 500);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rodando = status?.rodando || run.isPending;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="h-4 w-4" /> Sincronizar boletos da Cora
        </CardTitle>
        <p className="text-xs text-muted-foreground font-normal">
          Traz os boletos mensais emitidos pela Cora para o portal. Aparecem automaticamente
          na seção de boletos, no calendário e nos próximos pagamentos. Roda sozinho a cada
          poucas horas — use o botão para trazer agora.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!status?.configurado && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Cora não configurada no servidor (certificados SSL não encontrados).
          </p>
        )}

        {status?.ultima && (
          <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>
                <span className="text-muted-foreground">Novos:</span>{" "}
                <strong>{status.ultima.criados}</strong>
              </span>
              <span>
                <span className="text-muted-foreground">Atualizados:</span>{" "}
                <strong>{status.ultima.atualizados}</strong>
              </span>
              <span className="flex items-center gap-1">
                <Receipt className="h-3 w-3 text-muted-foreground" />
                <strong>{status.ultima.empresasProcessadas}</strong> empresa(s)
              </span>
              {status.ultima.erros > 0 && (
                <span className="text-destructive">{status.ultima.erros} erro(s)</span>
              )}
            </div>
            <p className="text-muted-foreground">
              Última: {format(new Date(status.ultima.em), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}{" "}
              · {status.ultima.segundos}s
            </p>
          </div>
        )}

        <Button
          type="button"
          onClick={() => run.mutate()}
          disabled={rodando || !status?.configurado}
        >
          {rodando ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sincronizando...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" /> Sincronizar agora
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
