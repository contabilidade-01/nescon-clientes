import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Check, FileUp, Loader2, Upload, X } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

interface ResultadoGravado {
  arquivo: string;
  empresa: string;
  company_id: string;
  funcionarios: number;
  periodos: number;
}

interface ResultadoErro {
  arquivo: string;
  motivo: string;
}

const FeriasUploadLotePage = () => {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [resultado, setResultado] = useState<{
    gravados: ResultadoGravado[];
    erros: ResultadoErro[];
  } | null>(null);

  const enviar = useMutation({
    mutationFn: (files: File[]) => api.admin.ferias.lote(files),
    onSuccess: (data) => {
      setResultado(data);
      setArquivos([]);
      if (data.gravados.length && !data.erros.length) {
        toast.success(`${data.gravados.length} programação(ões) importada(s)`);
      } else if (data.erros.length && !data.gravados.length) {
        toast.error("Nenhum arquivo pôde ser importado");
      } else {
        toast.info(`${data.gravados.length} importado(s), ${data.erros.length} com erro`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleFiles = useCallback((files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (!pdfs.length) {
      toast.error("Selecione apenas arquivos PDF");
      return;
    }
    setArquivos((prev) => [...prev, ...pdfs]);
    setResultado(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setArrastando(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const removerArquivo = (idx: number) => {
    setArquivos((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <AdminLayout
      title="Upload de Férias em Lote"
      description="Arraste vários PDFs de Programação de Férias — o sistema lê o CNPJ e aloca automaticamente"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileUp className="h-4 w-4" /> Programação de Férias
            </CardTitle>
            <CardDescription>
              Arraste os PDFs da "Programação de Férias" do G-Click. O sistema lê o CNPJ do
              cabeçalho de cada arquivo e grava automaticamente na empresa correspondente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                arrastando
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={handleDrop}
            >
              <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-2">
                Arraste os PDFs aqui ou clique para selecionar
              </p>
              <input
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                id="ferias-lote-input"
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" size="sm" asChild>
                <label htmlFor="ferias-lote-input" className="cursor-pointer">
                  Selecionar arquivos
                </label>
              </Button>
            </div>

            {arquivos.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {arquivos.length} arquivo(s) selecionado(s):
                </p>
                <ul className="space-y-1">
                  {arquivos.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-1.5"
                    >
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => removerArquivo(i)}
                        className="text-muted-foreground hover:text-destructive ml-2"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={() => enviar.mutate(arquivos)}
                  disabled={enviar.isPending}
                  className="mt-2"
                >
                  {enviar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Importar tudo
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {resultado && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resultado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {resultado.gravados.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-green-700">
                    Importados ({resultado.gravados.length}):
                  </p>
                  {resultado.gravados.map((g) => (
                    <div
                      key={g.company_id + g.arquivo}
                      className="flex items-start gap-2 text-sm bg-green-50 rounded px-3 py-2"
                    >
                      <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium">{g.arquivo}</span>
                        <span className="text-muted-foreground">
                          {" → "}{g.empresa} ({g.funcionarios} funcionário(s), {g.periodos} período(s))
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {resultado.erros.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-red-700">
                    Erros ({resultado.erros.length}):
                  </p>
                  {resultado.erros.map((e, i) => (
                    <Alert key={`${e.arquivo}-${i}`} variant="destructive" className="py-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        <span className="font-medium">{e.arquivo}</span> — {e.motivo}
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
};

export default FeriasUploadLotePage;
