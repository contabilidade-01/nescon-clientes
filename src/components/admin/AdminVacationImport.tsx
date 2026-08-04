import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { formatDateBR } from "@/lib/licenses";

/**
 * Importação da Programação de Férias (PDF do G-Click), dentro do cadastro da empresa.
 *
 * Sem tela nova: fica ao lado de "Importar funcionários" e "Ler extrato", que é onde
 * quem cuida do DP já está. O servidor confere o CNPJ do PDF contra o da empresa e
 * recusa a importação se divergirem — não dá para subir o arquivo de um cliente na
 * ficha de outro.
 */
export function AdminVacationImport({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const { data } = useQuery({
    queryKey: ["ferias-ultima", companyId],
    queryFn: () => api.admin.ferias.ultima(companyId),
  });

  const enviar = useMutation({
    mutationFn: () => api.admin.ferias.upload(companyId, file as File),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["ferias-ultima", companyId] });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      if (r.confere) {
        toast.success(`${r.funcionarios} funcionário(s) e ${r.periodos} período(s) importados`);
      } else {
        // Ler menos gente do que o rodapé declara é sinal de leitura parcial. Avisar
        // é obrigatório: um número a menos aqui vira um funcionário sem férias na tela.
        toast.warning(
          `Li ${r.funcionarios}, mas o PDF declara ${r.total_declarado}. Confira o arquivo antes de usar.`,
          { duration: 15000 }
        );
      }
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10000 }),
  });

  const escolher = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      toast.error("Apenas PDF");
      return;
    }
    setFile(f);
  };

  const upload = data?.upload;
  const funcionarios = new Set((data?.periodos ?? []).map((p) => p.nome)).size;
  const parcial =
    upload && upload.total_declarado !== null && upload.total_empregados !== upload.total_declarado;

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" /> Programação de Férias
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          PDF do G-Click. Alimenta a previsão de férias, o custo e o alerta de faltas de{" "}
          {companyName}. Cada importação substitui a anterior nas telas; o histórico fica
          guardado.
        </p>
      </div>

      {upload ? (
        <div className="rounded-md border bg-background/60 px-3 py-2 text-xs">
          <p>
            Última: <strong>{upload.total_empregados} funcionário(s)</strong>
            {upload.emissao ? ` · emissão ${formatDateBR(upload.emissao)}` : ""}
            {upload.data_base ? ` · data base ${formatDateBR(upload.data_base)}` : ""}
          </p>
          <p className="text-muted-foreground">
            {funcionarios} na lista · importada em{" "}
            {new Date(upload.criado_em).toLocaleDateString("pt-BR")}
            {upload.arquivo_nome ? ` · ${upload.arquivo_nome}` : ""}
          </p>
          {parcial && (
            <p className="mt-1 flex items-start gap-1.5 text-amber-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              O PDF declarava {upload.total_declarado} funcionários e foram lidos{" "}
              {upload.total_empregados}. Vale reimportar.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma programação importada ainda.</p>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          escolher(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "rounded-lg border border-dashed px-3 py-4 text-center text-xs transition-colors",
          arrastando ? "border-primary bg-primary/5" : "bg-muted/20"
        )}
      >
        {file ? (
          <div className="flex items-center justify-center gap-2">
            <span className="truncate font-medium">{file.name}</span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              aria-label="Remover arquivo"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <p className="text-muted-foreground">Arraste o PDF aqui ou escolha abaixo</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="flex-1 text-xs"
          onChange={(e) => escolher(e.target.files?.[0])}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => enviar.mutate()}
          disabled={!file || enviar.isPending}
        >
          <Upload className="mr-1 h-4 w-4" />
          {enviar.isPending ? "Lendo..." : "Importar"}
        </Button>
      </div>
    </div>
  );
}
