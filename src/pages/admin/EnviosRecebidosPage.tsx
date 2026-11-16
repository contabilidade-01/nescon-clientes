import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Download, ExternalLink, Inbox, MessageCircle, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { maskCNPJ } from "@/lib/masks";

/** Endereço público da página de envio (sem login). */
function linkEnvio(origem: string = window.location.origin): string {
  return `${origem.replace(/\/+$/, "")}/enviar`;
}

function dataHora(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function tamanho(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Documentos que os clientes mandaram pela página pública /enviar.
 * O arquivo só sai daqui, logado e como download (nunca abre no navegador).
 */
export default function EnviosRecebidosPage() {
  const [status, setStatus] = useState<"novo" | "tratado" | "">("novo");
  const [busca, setBusca] = useState("");
  const qc = useQueryClient();
  const url = linkEnvio();

  const { data, isLoading, error } = useQuery({
    queryKey: ["envios-recebidos", status, busca],
    queryFn: () => api.enviosRecebidos.listar({ status, busca: busca.trim() }),
  });

  const marcar = useMutation({
    mutationFn: ({ id, novo }: { id: string; novo: "novo" | "tratado" }) => api.enviosRecebidos.marcar(id, novo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["envios-recebidos"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const baixar = async (arquivoId: string, nome: string) => {
    try {
      const blob = await api.enviosRecebidos.fetchArquivo(arquivoId);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = nome;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const copiar = () => {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copiado"),
      () => toast.error("Não foi possível copiar. Selecione o link e copie à mão.")
    );
  };
  const mensagem = `Para enviar documentos à Nescon, sem senha: abra ${url}, informe o CNPJ da empresa, escolha o tipo e anexe os arquivos.`;

  return (
    <AdminLayout
      title="Documentos recebidos"
      description="O que os clientes mandaram pela página de envio sem login (/enviar)"
    >
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <p className="min-w-0 flex-1 select-all break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">{url}</p>
          <Button size="sm" className="gap-2" onClick={copiar}>
            <Copy className="h-4 w-4" /> Copiar link
          </Button>
          <Button size="sm" variant="outline" className="gap-2" asChild>
            <a href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
          </Button>
          <Button size="sm" variant="ghost" className="gap-2" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" /> Abrir
            </a>
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["novo", `Novos${data ? ` (${data.novos})` : ""}`],
            ["tratado", "Tratados"],
            ["", "Todos"],
          ] as const
        ).map(([s, rotulo]) => (
          <Button key={s || "todos"} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
            {rotulo}
          </Button>
        ))}
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Empresa, CNPJ ou protocolo"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {data && data.envios.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          <Inbox className="h-8 w-8" />
          <p className="text-sm">Nada por aqui.</p>
        </div>
      )}

      <div className="space-y-3">
        {data?.envios.map((e) => (
          <Card key={e.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{e.empresa}</p>
                  <p className="text-xs text-muted-foreground">
                    CNPJ {maskCNPJ(e.cnpj.replace(/\D/g, ""))} · {dataHora(e.created_at)}
                    {e.remetente ? ` · enviado por ${e.remetente}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{e.tipo_rotulo}</Badge>
                  <Badge variant="outline" className="font-mono">
                    {e.protocolo}
                  </Badge>
                  {e.status === "tratado" ? (
                    <Badge>Tratado</Badge>
                  ) : (
                    <Badge variant="destructive">Novo</Badge>
                  )}
                </div>
              </div>
              {e.observacao && (
                <p className="whitespace-pre-wrap rounded-lg bg-muted p-2 text-sm">{e.observacao}</p>
              )}
              <ul className="space-y-1">
                {e.arquivos.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                    <span className="text-xs text-muted-foreground">{tamanho(a.tamanho)}</span>
                    <Button size="sm" variant="ghost" className="gap-1" onClick={() => void baixar(a.id, a.nome)}>
                      <Download className="h-4 w-4" /> Baixar
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  {e.status === "tratado" ? `Tratado por ${e.tratado_por || "—"} em ${dataHora(e.tratado_em)}` : ""}
                </p>
                {e.status === "novo" ? (
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={marcar.isPending}
                    onClick={() => marcar.mutate({ id: e.id, novo: "tratado" })}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Marcar como tratado
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={marcar.isPending}
                    onClick={() => marcar.mutate({ id: e.id, novo: "novo" })}
                  >
                    <RotateCcw className="h-4 w-4" /> Voltar para novos
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AdminLayout>
  );
}
