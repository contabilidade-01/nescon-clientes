import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, CalendarSearch, Check, Loader2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/admin/AdminLayout";
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
import { api } from "@/lib/api";

const PROVIDER_LABELS: Record<string, { nome: string; descricao: string }> = {
  claude: { nome: "Claude (Anthropic)", descricao: "Mais preciso em documentos fiscais" },
  gemini: { nome: "Gemini (Google)", descricao: "Rápido e econômico" },
  chatgpt: { nome: "ChatGPT (OpenAI)", descricao: "Intermediário — bom equilíbrio" },
};

const ConfigIaPage = () => {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; erro?: string } | null>(null);

  const { data: config, isLoading } = useQuery({
    queryKey: ["admin-config-ia"],
    queryFn: () => api.configIa.get(),
  });

  const salvar = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.configIa.salvar(body),
    onSuccess: () => {
      toast.success("Configuração salva");
      queryClient.invalidateQueries({ queryKey: ["admin-config-ia"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testar = useMutation({
    mutationFn: (provider: string) => api.configIa.testar(provider),
    onSuccess: (r) => setTestResult(r),
    onError: (e: Error) => setTestResult({ ok: false, erro: e.message }),
  });

  if (isLoading || !config) return null;

  return (
    <AdminLayout
      title="Configuração de IA"
      description="Escolha o provider de IA para auxiliar na leitura de CNPJ em documentos"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4" /> Inteligência Artificial para CNPJ
            </CardTitle>
            <CardDescription>
              A IA é acionada apenas quando a leitura direta do PDF não encontra o CNPJ.
              Primeiro o sistema tenta regex puro, depois busca contextual, e só então aciona a IA.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label>Usar IA quando o texto do PDF não revelar CNPJ</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Se desligado, documentos sem CNPJ legível precisarão de alocação manual.
                </p>
              </div>
              <Switch
                checked={config.habilitada}
                onCheckedChange={(v) => salvar.mutate({ habilitada: v })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Provider de IA</Label>
                <Select
                  value={config.provider}
                  onValueChange={(v) => salvar.mutate({ provider: v })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {config.provedores_disponiveis.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PROVIDER_LABELS[p]?.nome || p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {PROVIDER_LABELS[config.provider]?.descricao}
                </p>
              </div>

              <div>
                <Label>Limiar de confiança (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={config.limiar_confianca}
                  onChange={(e) => salvar.mutate({ limiar_confianca: Number(e.target.value) })}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Abaixo deste valor, o CNPJ não é sugerido automaticamente.
                </p>
              </div>
            </div>

            <div>
              <Label>Timeout (ms)</Label>
              <Input
                type="number"
                min={1000}
                max={120000}
                value={config.timeout_ms}
                onChange={(e) => salvar.mutate({ timeout_ms: Number(e.target.value) })}
                className="mt-1 max-w-[200px]"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Tempo máximo de espera pela resposta da IA.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarSearch className="h-4 w-4" /> Inteligência Artificial para vencimento em documentos
            </CardTitle>
            <CardDescription>
              Usa o mesmo provedor e credencial configurados acima, mas é um interruptor à parte: liga a IA
              como fallback quando a varredura de vencimentos (fila de revisão) não encontra um rótulo
              conhecido no PDF. Um documento genérico (contrato, holerite) confunde mais do que um DARF —
              por isso não fica ligado junto com o de CNPJ por padrão.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Usar IA quando o PDF não tiver rótulo de vencimento reconhecível</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Se desligado, a varredura só encontra vencimento por regex — o que não achar fica sem
                  sugestão até o admin corrigir à mão.
                </p>
              </div>
              <Switch
                checked={config.vencimento_habilitada}
                onCheckedChange={(v) => salvar.mutate({ vencimento_habilitada: v })}
              />
            </div>
            <Button variant="outline" asChild>
              <Link to="/admin/vencimentos-sugeridos">Abrir fila de revisão de vencimentos</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credenciais</CardTitle>
            <CardDescription>
              A chave pode vir de variável de ambiente ou ser gravada aqui.
              Variável de ambiente (ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY) sempre tem prioridade.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label>Chave de API para {PROVIDER_LABELS[config.provider]?.nome || config.provider}</Label>
                <Input
                  type="password"
                  placeholder="sk-... ou AIza..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="mt-1"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  if (apiKey) {
                    salvar.mutate({ api_key: apiKey, provider: config.provider });
                    setApiKey("");
                  }
                }}
                disabled={!apiKey}
              >
                Salvar chave
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setTestResult(null);
                  testar.mutate(config.provider);
                }}
                disabled={testar.isPending}
              >
                {testar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Testar conexão
              </Button>
              {testResult && (
                <span className={`flex items-center gap-1 text-sm ${testResult.ok ? "text-green-600" : "text-red-600"}`}>
                  {testResult.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  {testResult.ok ? "Conectado" : testResult.erro || "Falhou"}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default ConfigIaPage;
