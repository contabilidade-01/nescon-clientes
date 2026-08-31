import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Server,
  Webhook,
  XCircle,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

function Linha({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      )}
      <span>{children}</span>
    </div>
  );
}

const WhatsAppStatusPage = () => {
  const queryClient = useQueryClient();
  const [numero, setNumero] = useState("");

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ["admin-whatsapp-diagnostico"],
    queryFn: () => api.admin.whatsappDiagnostico(),
    refetchInterval: 30000,
  });

  const testar = useMutation({
    mutationFn: () => api.admin.whatsappTestar(numero),
    onSuccess: (r) => {
      if (r.ok) toast.success(`Mensagem de teste enviada para ${r.numero}.`);
      else toast.error(r.erro || "Falha no envio.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inst = data?.instancia;
  const conectado = Boolean(inst?.ok);

  return (
    <AdminLayout
      title="Conexão do WhatsApp"
      description="Verifica se o número da Nescon está conectado à uazapi e se o assistente de DP (advertência/suspensão) consegue receber e responder mensagens."
    >
      <div className="space-y-6">
        {isError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>Não deu para ler a configuração do servidor: {(error as Error)?.message || "erro desconhecido"}.</span>
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4" /> Variáveis no Easypanel
            </CardTitle>
            <CardDescription>
              Leitura do ambiente da API. Tokens e chaves nunca aparecem — só se estão preenchidos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : data?.ambiente ? (
              <>
                <Linha ok={Boolean(data.ambiente.public_app_url)}>
                  PUBLIC_APP_URL: {data.ambiente.public_app_url || "não definida"}
                </Linha>
                <Linha ok={Boolean(data.ambiente.uazapi_subdomain)}>
                  UAZAPI_SUBDOMAIN: {data.ambiente.uazapi_subdomain || "não definido"}
                </Linha>
                <Linha ok={data.ambiente.uazapi_token_configurado}>
                  UAZAPI_TOKEN: {data.ambiente.uazapi_token_configurado ? "preenchido" : "vazio"}
                </Linha>
                <Linha ok={data.ambiente.webhook_secret_configurado}>
                  UAZAPI_WEBHOOK_SECRET: {data.ambiente.webhook_secret_configurado ? "preenchido" : "vazio"}
                </Linha>
                <Linha ok={Boolean(data.ambiente.nescon_contato_whatsapp)}>
                  NESCON_CONTATO_WHATSAPP: {data.ambiente.nescon_contato_whatsapp || "não definido (usa o admin)"}
                </Linha>
                <Linha ok={Boolean(data.ambiente.admin_whatsapp)}>
                  ADMIN_WHATSAPP: {data.ambiente.admin_whatsapp || "não definido (padrão 5511948626605)"}
                </Linha>
                <Linha ok={data.ambiente.openai_api_key_configurada}>
                  OPENAI_API_KEY: {data.ambiente.openai_api_key_configurada ? "preenchida" : "vazia"}
                </Linha>
                <Linha ok={data.ambiente.groq_api_key_configurada}>
                  GROQ_API_KEY: {data.ambiente.groq_api_key_configurada ? "preenchida" : "vazia"}
                </Linha>
                <Linha ok={data.ambiente.chatgpt_tela_configurada}>
                  ChatGPT na tela Config. de IA: {data.ambiente.chatgpt_tela_configurada ? "com chave" : "sem chave"}
                </Linha>
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* Estado da instância */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="h-4 w-4" /> Instância uazapi
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-diagnostico"] })}
                disabled={isFetching}
              >
                <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${conectado ? "bg-emerald-500" : "bg-destructive"}`} />
                  <Badge
                    className={
                      conectado
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                        : "bg-destructive/15 text-destructive border-destructive/30"
                    }
                  >
                    {conectado ? "Conectado" : "Desconectado"}
                  </Badge>
                  {inst?.owner && <span className="text-xs text-muted-foreground">nº {inst.owner}</span>}
                </div>
                <p className="text-sm text-muted-foreground">{inst?.mensagem}</p>
                {!conectado && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      Enquanto estiver desconectado, o assistente não responde e nenhum alerta sai. Abra o painel
                      da uazapi e leia o QR code de novo.
                    </span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Webhook — é o que faz o assistente RECEBER mensagens */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Webhook className="h-4 w-4" /> Webhook (recebimento de mensagens)
            </CardTitle>
            <CardDescription>
              É por aqui que a mensagem do cliente chega ao assistente. Se a instância está conectada mas o
              assistente <span className="font-medium">não responde</span>, quase sempre é o webhook: precisa
              estar registrado na uazapi apontando para a URL abaixo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data && (
              <>
                <Linha ok={Boolean(data.webhook.url_base)}>
                  {data.webhook.url_base ? (
                    <>URL pública configurada no servidor (PUBLIC_APP_URL).</>
                  ) : (
                    <>PUBLIC_APP_URL não está definida no servidor — sem ela não dá para montar a URL do webhook.</>
                  )}
                </Linha>
                <Linha ok={data.webhook.secret_configurado}>
                  {data.webhook.secret_configurado ? (
                    <>
                      Secret do webhook configurado. <span className="font-medium">Atenção:</span> a URL
                      registrada na uazapi <span className="font-medium">precisa</span> terminar com{" "}
                      <code className="rounded bg-muted px-1">?token=SEU_SECRET</code> — senão a uazapi recebe 401
                      e o assistente nunca responde.
                    </>
                  ) : (
                    <>Sem secret (UAZAPI_WEBHOOK_SECRET). O webhook aceita qualquer chamada — funciona, mas é aberto.</>
                  )}
                </Linha>

                {data.webhook.url_base && (
                  <div className="space-y-1">
                    <Label className="text-xs">URL para registrar na uazapi</Label>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded border bg-muted/50 px-2 py-1.5 text-xs">
                        {data.webhook.url_com_token || data.webhook.url_base}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard?.writeText(data.webhook.url_com_token || data.webhook.url_base || "");
                          toast.success("URL copiada.");
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    {data.webhook.secret_configurado && (
                      <p className="text-xs text-muted-foreground">
                        Troque <code className="rounded bg-muted px-1">SEU_SECRET</code> pelo valor real de
                        UAZAPI_WEBHOOK_SECRET (por segurança, ele não é exibido aqui).
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Assistente de DP */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Assistente de DP (advertência / suspensão)</CardTitle>
            <CardDescription>Requisitos extras do assistente automático.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data && (
              <>
                <Linha ok={data.assistente_dp.transcricao_audio_configurada}>
                  {data.assistente_dp.transcricao_audio_configurada ? (
                    <>Transcrição de áudio configurada (o cliente pode mandar áudio).</>
                  ) : (
                    <>
                      Sem chave de transcrição (OPENAI_API_KEY / GROQ_API_KEY / ChatGPT na Config. de IA). Áudios
                      não são entendidos — só texto funciona.
                    </>
                  )}
                </Linha>
                <Linha ok>
                  O assistente só inicia se a mensagem tiver *advertência* / *advertir* ou *suspensão* / *suspender*.
                  Qualquer outro recado (oi, falta, áudio sem essas palavras, aviso de ausência) vai para o contato da Nescon.
                </Linha>
              </>
            )}
            <p className="pt-1 text-xs text-muted-foreground">
              Para validar o recebimento de ponta a ponta: do seu WhatsApp, mande a palavra{" "}
              <span className="font-medium">advertência</span> para o número da Nescon. Se o assistente responder,
              o webhook está certo.
            </p>
          </CardContent>
        </Card>

        {/* Teste de envio */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="h-4 w-4" /> Testar envio
            </CardTitle>
            <CardDescription>
              Manda uma mensagem de teste para um número — prova que a saída funciona. (Não testa o recebimento;
              para isso, use o passo acima.)
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="numero-teste">Número (com DDD)</Label>
              <Input
                id="numero-teste"
                inputMode="numeric"
                placeholder="34999998888"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                className="mt-1 max-w-[220px]"
              />
            </div>
            <Button onClick={() => testar.mutate()} disabled={testar.isPending || numero.trim().length < 10}>
              {testar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar teste
            </Button>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default WhatsAppStatusPage;
