import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserCheck, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { maskCPF } from "@/lib/masks";
import { competenciaLabel } from "@/lib/deliverableDisplay";
import { toast } from "sonner";

type Props = {
  companyId: string;
  companyName: string;
};

type Preview = Awaited<ReturnType<typeof api.admin.extratoEmployees>>;

/**
 * Cadastro inicial de funcionários lendo o último extrato de folha da empresa
 * (já hospedado no portal). O admin confere os nomes+CPF antes de gravar.
 */
export function AdminExtratoImport({ companyId, companyName }: Props) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<Preview | null>(null);

  const scan = useMutation({
    mutationFn: () => api.admin.extratoEmployees(companyId),
    onSuccess: (data) => {
      setPreview(data);
      if (data.total === 0) toast.info("Nenhum funcionário reconhecido no extrato.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importar = useMutation({
    mutationFn: () => api.admin.importExtratoEmployees(companyId),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      setPreview(null);
      toast.success(
        `${r.inseridos} cadastrado(s), ${r.pulados} já existia(m)` +
          (r.inativados ? `, ${r.inativados} inativado(s) (fora do extrato).` : ".")
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div>
        <p className="text-xs font-semibold text-foreground">Cadastrar funcionários pelo extrato de folha</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Lê o último extrato de folha que está no portal e reconhece nome + CPF de cada
          funcionário. Confira antes de cadastrar. Quem já existe é ignorado.
        </p>
      </div>

      {!preview ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="gap-1"
          onClick={() => scan.mutate()}
          disabled={scan.isPending}
        >
          <ScanLine className="h-3.5 w-3.5" />
          {scan.isPending ? "Lendo extrato..." : "Ler extrato"}
        </Button>
      ) : (
        <div className="space-y-3 rounded-md border bg-background/60 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              Extrato de <strong>{competenciaLabel(preview.competencia)}</strong> ·{" "}
              {preview.total} reconhecido(s) · <strong className="text-primary">{preview.novos} novo(s)</strong>
            </span>
            {preview.invalidos > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {preview.invalidos} CPF ilegível
              </Badge>
            )}
          </div>

          {preview.inativar > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              <p className="font-medium text-amber-700 dark:text-amber-400">
                {preview.inativar} funcionário(s) serão inativados — não aparecem neste extrato (demissão):
              </p>
              <p className="mt-0.5 text-muted-foreground">{preview.ausentes.join(", ")}</p>
            </div>
          )}

          <div className="max-h-56 space-y-1 overflow-y-auto text-xs">
            {preview.funcionarios.map((f) => (
              <div
                key={f.cpf}
                className="flex items-center justify-between gap-2 border-b border-border/40 pb-1 last:border-0"
              >
                <span className="min-w-0 truncate font-medium">{f.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-muted-foreground">{maskCPF(f.cpf)}</span>
                  {f.jaCadastrado && (
                    <Badge variant="outline" className="text-[10px]">já existe</Badge>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="gap-1"
              onClick={() => importar.mutate()}
              disabled={importar.isPending || (preview.novos === 0 && preview.inativar === 0)}
            >
              <UserCheck className="h-3.5 w-3.5" />
              {importar.isPending
                ? "Aplicando..."
                : preview.novos === 0 && preview.inativar === 0
                  ? "Nada a fazer"
                  : preview.novos > 0 && preview.inativar > 0
                    ? `Cadastrar ${preview.novos} e inativar ${preview.inativar}`
                    : preview.novos > 0
                      ? `Cadastrar ${preview.novos} funcionário(s)`
                      : `Inativar ${preview.inativar} funcionário(s)`}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreview(null)} disabled={importar.isPending}>
              Cancelar
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Empresa: {companyName}</p>
        </div>
      )}
    </div>
  );
}
