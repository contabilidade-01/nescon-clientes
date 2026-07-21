import { type ChangeEvent, useRef, useState } from "react";
import { Upload, Download } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { parseEmployeeImportFile } from "@/lib/parseEmployeeSpreadsheet";
import { toast } from "sonner";
import { maskCNPJ } from "@/lib/masks";

type Props = {
  companyId: string;
  companyCnpj: string;
  companyName: string;
};

export function AdminEmployeeImport({ companyId, companyCnpj, companyName }: Props) {
  const queryClient = useQueryClient();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    fileCnpj: string;
    rows: Array<{ name: string; cpf: string }>;
    skippedDismissed: number;
  } | null>(null);

  const importMutation = useMutation({
    mutationFn: ({ rows, fileCnpj }: { rows: Array<{ name: string; cpf: string }>; fileCnpj: string }) =>
      api.admin.importEmployees(companyId, rows, fileCnpj),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      setPendingImport(null);
      toast.success(`Importação concluída: ${result.inserted} inseridos, ${result.skipped} ignorados`);
      if (result.errors.length) {
        toast.warning(`${result.errors.length} linhas com erro foram ignoradas`);
      }
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao importar funcionários"),
  });

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = await parseEmployeeImportFile(file);
      if (!parsed?.fileCnpj) {
        toast.error("Não foi possível identificar o CNPJ na planilha");
        return;
      }
      const expectedCnpj = companyCnpj.replace(/\D/g, "");
      if (parsed.fileCnpj !== expectedCnpj) {
        toast.error(
          `Esta planilha é de outra empresa (CNPJ ${maskCNPJ(parsed.fileCnpj)}). Selecione ${companyName}.`
        );
        return;
      }

      const { rows, skippedDismissed, fileCnpj } = parsed;
      if (!rows.length) {
        toast.error("Planilha sem funcionários válidos para importar");
        return;
      }
      setPendingImport({ fileName: file.name, fileCnpj, rows, skippedDismissed });
    } catch {
      toast.error("Não foi possível ler a planilha. Use CSV ou Excel (.xls, .xlsx).");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="border-t pt-4 mt-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-foreground">Importar funcionários (planilha)</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Aceita CSV, .xls ou .xlsx. Precisa de <strong>Nome</strong> e <strong>CPF</strong> por linha, e o
          CNPJ <strong>{maskCNPJ(companyCnpj)}</strong> em algum lugar do arquivo. Quem tiver data de demissão
          não é importado.
        </p>
        <a
          href="/modelo-importar-funcionarios.xlsx"
          download
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Download className="h-3.5 w-3.5" /> Baixar modelo de planilha
        </a>
      </div>

      <input
        ref={importInputRef}
        type="file"
        accept=".csv,.xls,.xlsx,.xlsm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={handleImportFile}
      />

      {pendingImport ? (
        <div className="rounded-md border bg-background/60 p-3 space-y-2 text-xs">
          <p>
            Arquivo: <strong>{pendingImport.fileName}</strong> · {pendingImport.rows.length} funcionário(s)
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="gap-1"
              onClick={() =>
                importMutation.mutate({ rows: pendingImport.rows, fileCnpj: pendingImport.fileCnpj })
              }
              disabled={importMutation.isPending}
            >
              <Upload className="h-3.5 w-3.5" />
              {importMutation.isPending ? "Importando..." : "Confirmar importação"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPendingImport(null)} disabled={importMutation.isPending}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="gap-1"
          onClick={() => importInputRef.current?.click()}
          disabled={importMutation.isPending}
        >
          <Upload className="h-3.5 w-3.5" /> Selecionar planilha
        </Button>
      )}
    </div>
  );
}
