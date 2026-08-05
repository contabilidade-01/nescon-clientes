/**
 * Upload de documentos avulsos com reconhecimento de CNPJ.
 *
 * Fluxo em duas etapas, e a segunda é a que importa: o portal **sugere** a empresa e a
 * pessoa **confirma**. Alocar o documento de um cliente para outro é o pior erro deste
 * fluxo, então nada é gravado sem alguém olhar.
 *
 * A tela sempre deixa escolher a empresa à mão — inclusive quando nenhum CNPJ foi lido.
 * Um PDF digitalizado sem camada de texto não pode virar beco sem saída.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Check, Sparkles, Upload, X } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type DocUploadCompany, type DocUploadFile } from "@/lib/api";

function formatarCnpj(cnpj: string): string {
  return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

type Linha = DocUploadFile & { titulo?: string; escolhida?: DocUploadCompany | null };

const DocumentUploadPage = () => {
  const queryClient = useQueryClient();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const { data: empresas } = useQuery({
    queryKey: ["admin-companies-all"],
    queryFn: () => api.admin.companies(),
  });

  const ia = useQuery({ queryKey: ["doc-upload", "ia"], queryFn: () => api.docUpload.ia() });

  const alternarIa = useMutation({
    mutationFn: (v: boolean) => api.docUpload.definirIa(v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doc-upload", "ia"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const analisar = useMutation({
    mutationFn: (files: File[]) => api.docUpload.analisar(files),
    onSuccess: (d) => {
      setLinhas(d.arquivos.map((a) => ({ ...a, escolhida: a.empresa })));
      setErro(null);
    },
    onError: (e: Error) => setErro(e.message),
  });

  const confirmar = useMutation({
    mutationFn: () =>
      api.docUpload.confirmar(
        linhas
          .filter((l) => l.escolhida)
          .map((l) => ({
            storedName: l.storedName,
            company_id: l.escolhida!.id,
            title: l.titulo || l.filename,
            originalName: l.filename,
          }))
      ),
    onSuccess: (r) => {
      if (r.erros.length) toast.error(`${r.erros.length} arquivo(s) não gravaram.`);
      if (r.gravados.length) toast.success(`${r.gravados.length} documento(s) enviados ao cliente.`);
      setLinhas([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Cancelar precisa apagar os arquivos: eles já estão no disco desde a análise.
  const descartar = useMutation({
    mutationFn: () => api.docUpload.descartar(linhas.map((l) => l.storedName)),
    onSuccess: () => setLinhas([]),
    onError: () => setLinhas([]),
  });

  const receber = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    analisar.mutate(Array.from(fileList));
  };

  const atualizar = (idx: number, dados: Partial<Linha>) =>
    setLinhas((prev) => prev.map((l, i) => (i === idx ? { ...l, ...dados } : l)));

  const prontos = linhas.filter((l) => l.escolhida).length;

  return (
    <AdminLayout
      title="Upload de documentos"
      description="Arraste os PDFs: o portal lê o CNPJ e sugere o cliente; você confirma"
    >
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" /> Documentos avulsos
            </CardTitle>
            <CardDescription>
              O documento entra visível para o cliente na hora — não passa pela retenção
              das guias do G-Click.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!linhas.length && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setArrastando(true);
                }}
                onDragLeave={() => setArrastando(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setArrastando(false);
                  receber(e.dataTransfer.files);
                }}
                className={`rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
                  arrastando ? "border-primary bg-primary/5" : "border-muted-foreground/25"
                }`}
              >
                <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Arraste os PDFs aqui</p>
                <p className="mt-1 text-xs text-muted-foreground">Até 20 arquivos, 10 MB cada</p>
                <Input
                  type="file"
                  multiple
                  accept="application/pdf,.pdf"
                  className="hidden"
                  id="doc-upload-input"
                  onChange={(e) => receber(e.target.files)}
                />
                <Button variant="outline" className="mt-4" asChild>
                  <label htmlFor="doc-upload-input" className="cursor-pointer">
                    Selecionar arquivos
                  </label>
                </Button>
              </div>
            )}

            {analisar.isPending && (
              <p className="text-center text-sm text-muted-foreground">Lendo os arquivos…</p>
            )}

            {erro && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{erro}</AlertDescription>
              </Alert>
            )}

            {linhas.map((l, idx) => (
              <div key={l.storedName} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="truncate text-sm font-medium">{l.filename}</p>

                    {l.cnpjs.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {l.cnpjs.map((c) => (
                          <Badge key={c} variant="outline" className="font-mono text-[10px]">
                            {formatarCnpj(c)}
                          </Badge>
                        ))}
                        {l.origem === "ia" && (
                          <Badge variant="secondary" className="text-[10px]">
                            <Sparkles className="mr-1 h-3 w-3" /> lido por IA
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                        <AlertCircle className="h-3 w-3" />
                        Nenhum CNPJ legível — escolha o cliente à mão.
                      </p>
                    )}

                    {l.observacao && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">{l.observacao}</p>
                    )}

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Cliente</Label>
                        <Select
                          value={l.escolhida?.id ?? ""}
                          onValueChange={(v) => {
                            const c = empresas?.find((x) => x.id === v);
                            atualizar(idx, { escolhida: c ? { id: c.id, name: c.name, cnpj: c.cnpj } : null });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o cliente" />
                          </SelectTrigger>
                          <SelectContent>
                            {empresas?.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Título que o cliente vê</Label>
                        <Input
                          value={l.titulo ?? l.filename}
                          onChange={(e) => atualizar(idx, { titulo: e.target.value })}
                        />
                      </div>
                    </div>

                    {l.escolhida && l.origem !== "nao_encontrado" && (
                      <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500">
                        <Check className="h-3 w-3" />
                        {l.escolhida.name}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLinhas((p) => p.filter((_, i) => i !== idx))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            {linhas.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  onClick={() => confirmar.mutate()}
                  disabled={!prontos || confirmar.isPending}
                >
                  {confirmar.isPending ? "Gravando…" : `Enviar ${prontos} documento(s)`}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => descartar.mutate()}
                  disabled={confirmar.isPending || descartar.isPending}
                >
                  Descartar tudo
                </Button>
                {prontos < linhas.length && (
                  <span className="self-center text-xs text-muted-foreground">
                    {linhas.length - prontos} sem cliente definido — só os definidos serão enviados.
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Leitura de PDFs</CardTitle>
            <CardDescription>
              Por padrão a leitura é <strong>determinística</strong> — regex sobre o texto do
              PDF. Sem chamada externa, sem custo por arquivo e com o mesmo resultado hoje
              e daqui a um ano. A IA entra só quando o parser não acha nada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div className="min-w-0">
                <Label htmlFor="ia-fallback" className="font-normal">
                  Usar IA quando o parser falhar
                </Label>
                <p className="text-xs text-muted-foreground">
                  {ia.data?.configurada
                    ? `Modelo: ${ia.data.modelo}`
                    : "Sem chave no ambiente — ligar aqui não teria efeito."}
                </p>
              </div>
              <Switch
                id="ia-fallback"
                checked={Boolean(ia.data?.habilitada)}
                disabled={!ia.data?.configurada || alternarIa.isPending}
                onCheckedChange={(v) => alternarIa.mutate(v)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              O parser erra de forma previsível: não acha, e avisa. A IA erra de forma
              plausível — devolve um CNPJ com cara de certo, tirado do rodapé errado. Por
              isso ela nunca vem primeiro, e o que ela ler aparece marcado para conferência.
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default DocumentUploadPage;
