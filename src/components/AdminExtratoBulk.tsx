import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, ScanLine, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { competenciaLabel } from "@/lib/deliverableDisplay";
import { toast } from "sonner";

type Scan = Awaited<ReturnType<typeof api.admin.scanExtratoEmployees>>;

/**
 * Cadastro de funcionários em massa pelo extrato de folha, para todas as empresas.
 * Faz uma prévia (dry-run) e só cadastra ao confirmar. Reaproveita as rotas
 * `/admin/extrato-employees/{scan-all,import}` do backend.
 */
export function AdminExtratoBulk() {
  const queryClient = useQueryClient();
  const [scan, setScan] = useState<Scan | null>(null);

  const preview = useMutation({
    mutationFn: () => api.admin.scanExtratoEmployees(),
    onSuccess: (d) => {
      setScan(d);
      if (d.total_novos === 0) toast.info("Nenhum funcionário novo nos extratos.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importar = useMutation({
    mutationFn: () => api.admin.importExtratoEmployees(), // sem company_id = todas
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      setScan(null);
      const comErro = r.empresas.filter((e) => e.erro).length;
      toast.success(
        `${r.inseridos} cadastrado(s), ${r.inativados} inativado(s), ${r.pulados} já existia(m).` +
          (comErro ? ` ${comErro} com erro.` : "")
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> Cadastrar funcionários de todas as empresas
        </CardTitle>
        <p className="text-xs text-muted-foreground font-normal">
          Lê o último extrato de folha de cada empresa (já no portal) e cadastra os funcionários
          que faltam. Confira a prévia antes. Quem já existe é ignorado.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!scan ? (
          <Button
            type="button"
            variant="secondary"
            className="gap-1"
            onClick={() => preview.mutate()}
            disabled={preview.isPending}
          >
            <ScanLine className="h-4 w-4" />
            {preview.isPending ? "Lendo extratos..." : "Ver prévia (todas as empresas)"}
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg bg-muted p-3 text-sm">
              <span className="text-muted-foreground">Encontrado em </span>
              <strong>{scan.empresas_com_extrato}</strong>
              <span className="text-muted-foreground"> empresa(s) · </span>
              <strong className="text-primary">{scan.total_novos}</strong>
              <span className="text-muted-foreground"> novo(s)</span>
              {scan.total_inativar > 0 && (
                <>
                  <span className="text-muted-foreground"> · </span>
                  <strong className="text-amber-600">{scan.total_inativar}</strong>
                  <span className="text-muted-foreground"> a inativar (demissão)</span>
                </>
              )}
            </div>

            <div className="max-h-56 space-y-1 overflow-y-auto text-xs">
              {scan.empresas
                .filter((e) => e.novos > 0 || e.inativar > 0)
                .map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-2 border-b border-border/40 pb-1 last:border-0"
                  >
                    <span className="min-w-0 truncate font-medium">{e.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-muted-foreground">{competenciaLabel(e.competencia)}</span>
                      {e.novos > 0 && (
                        <Badge variant="secondary" className="text-[10px]">+{e.novos}</Badge>
                      )}
                      {e.inativar > 0 && (
                        <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-600">
                          −{e.inativar}
                        </Badge>
                      )}
                    </span>
                  </div>
                ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                className="gap-1"
                onClick={() => importar.mutate()}
                disabled={importar.isPending || (scan.total_novos === 0 && scan.total_inativar === 0)}
              >
                <UserCheck className="h-4 w-4" />
                {importar.isPending
                  ? "Aplicando..."
                  : scan.total_novos === 0 && scan.total_inativar === 0
                    ? "Nada a fazer"
                    : "Aplicar em todas"}
              </Button>
              <Button variant="outline" onClick={() => setScan(null)} disabled={importar.isPending}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
