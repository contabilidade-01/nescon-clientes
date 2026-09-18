import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CheckCircle2,
  Clock,
  ImageIcon,
  Loader2,
  Megaphone,
  Paperclip,
  Pause,
  Play,
  Send,
  Trash2,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api, type Circular, type CircularEnvio } from "@/lib/api";

const MAX_MB = 16;

const STATUS_CIRCULAR: Record<Circular["status"], { label: string; className: string }> = {
  rascunho: { label: "Rascunho", className: "border-muted-foreground/40 text-muted-foreground" },
  enviando: { label: "Enviando", className: "border-sky-500 text-sky-600 dark:text-sky-300" },
  pausada: { label: "Pausada", className: "border-amber-500 text-amber-700 dark:text-amber-300" },
  concluida: { label: "Concluída", className: "border-emerald-500 text-emerald-700 dark:text-emerald-300" },
};

const STATUS_ENVIO: Record<CircularEnvio["status"], { label: string; icon: typeof Clock; className: string }> = {
  pendente: { label: "Na fila", icon: Clock, className: "text-muted-foreground" },
  enviado: { label: "Enviado", icon: CheckCircle2, className: "text-emerald-600" },
  falhou: { label: "Falhou", icon: XCircle, className: "text-destructive" },
  sem_whatsapp: { label: "Sem WhatsApp", icon: XCircle, className: "text-amber-600" },
  duplicado: { label: "Número repetido", icon: XCircle, className: "text-muted-foreground" },
};

function quando(iso: string | null) {
  return iso ? format(new Date(iso), "dd/MM 'às' HH:mm", { locale: ptBR }) : "";
}

/** As duas mensagens como o cliente vê no WhatsApp: texto, depois a mídia. */
function Bolhas({ texto, midiaUrl, tipo }: { texto: string; midiaUrl: string | null; tipo: "image" | "video" | null }) {
  return (
    <div className="flex flex-col items-end gap-2">
      {texto && (
        <div className="max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-emerald-100 px-3 py-2 text-sm text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-50 sm:max-w-md">
          {texto}
        </div>
      )}
      {midiaUrl && (
        <div className="max-w-full overflow-hidden rounded-2xl rounded-br-sm bg-emerald-100 p-1 dark:bg-emerald-900/60 sm:max-w-xs">
          {tipo === "video" ? (
            <video src={midiaUrl} controls className="max-h-72 w-full rounded-xl" />
          ) : (
            <img src={midiaUrl} alt="Imagem da circular" className="max-h-72 w-full rounded-xl object-contain" />
          )}
        </div>
      )}
    </div>
  );
}

const CircularPage = () => {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const { data: circulares = [] } = useQuery({
    queryKey: ["circulares"],
    queryFn: () => api.circulares.listar(),
    refetchInterval: (q) => (q.state.data?.some((c) => c.rodando || c.status === "enviando") ? 5000 : false),
  });

  const { data: destinatarios = [] } = useQuery({
    queryKey: ["circulares-destinatarios"],
    queryFn: () => api.circulares.destinatarios(),
  });

  const { data: detalhe } = useQuery({
    queryKey: ["circular", selecionadaId],
    queryFn: () => api.circulares.detalhe(selecionadaId!),
    enabled: Boolean(selecionadaId),
    refetchInterval: (q) => (q.state.data?.rodando || q.state.data?.status === "enviando" ? 4000 : false),
  });

  const atualizar = () => {
    queryClient.invalidateQueries({ queryKey: ["circulares"] });
    queryClient.invalidateQueries({ queryKey: ["circular"] });
  };

  const escolherArquivo = (f: File | null) => {
    if (previa) URL.revokeObjectURL(previa);
    if (f && f.size > MAX_MB * 1024 * 1024) {
      toast.error(`Arquivo acima de ${MAX_MB} MB (limite do WhatsApp para vídeo).`);
      f = null;
    }
    setArquivo(f);
    setPrevia(f ? URL.createObjectURL(f) : null);
    if (inputArquivo.current) inputArquivo.current.value = "";
  };

  const criar = useMutation({
    mutationFn: () => api.circulares.criar(texto.trim(), arquivo),
    onSuccess: (c) => {
      toast.success("Circular criada. Agora marque uma empresa para testar.");
      setTexto("");
      escolherArquivo(null);
      setSelecionadaId(c.id);
      queryClient.invalidateQueries({ queryKey: ["circulares"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Com texto/anexo no quadro de escrever, "Enviar" cria a circular nova e já manda;
  // sem nada escrito, manda a circular escolhida no histórico.
  const temRascunho = Boolean(texto.trim() || arquivo);

  const enviar = useMutation({
    mutationFn: async () => {
      let id = selecionadaId;
      if (temRascunho) {
        const c = await api.circulares.criar(texto.trim(), arquivo);
        id = c.id;
        setSelecionadaId(c.id);
        setTexto("");
        escolherArquivo(null);
      }
      if (!id) throw new Error("Escreva o texto ou anexe o vídeo/imagem antes de enviar.");
      return api.circulares.enviar(id, [...marcadas]);
    },
    onSuccess: (r) => {
      setConfirmar(false);
      if (!r.na_fila) {
        toast.message("Nada novo para enviar: as marcadas já receberam ou estão sem WhatsApp válido.");
      } else {
        toast.success(
          `${r.na_fila} na fila${r.ignorados ? ` · ${r.ignorados} sem WhatsApp/repetido` : ""}. Tempo estimado: ~${r.minutos_estimados} min.`
        );
      }
      setMarcadas(new Set());
      atualizar();
    },
    onError: (e: Error) => {
      setConfirmar(false);
      toast.error(e.message);
    },
  });

  const parar = useMutation({
    mutationFn: () => api.circulares.parar(selecionadaId!),
    onSuccess: () => {
      toast.message("Parando depois da mensagem em curso.");
      setTimeout(atualizar, 1500);
    },
  });

  const retomar = useMutation({
    mutationFn: () => api.circulares.retomar(selecionadaId!),
    onSuccess: () => {
      toast.success("Envio retomado.");
      setTimeout(atualizar, 1500);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const apagar = useMutation({
    mutationFn: (id: string) => api.circulares.apagar(id),
    onSuccess: () => {
      toast.success("Circular apagada.");
      setSelecionadaId(null);
      queryClient.invalidateQueries({ queryKey: ["circulares"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Situação de cada empresa na circular em foco. Rascunho novo = ninguém recebeu ainda.
  const envios = useMemo(() => (temRascunho ? [] : detalhe?.envios ?? []), [temRascunho, detalhe]);

  // Quem já está nesta circular (recebeu ou na fila) não pode ser marcado de novo.
  const jaNaCircular = useMemo(
    () =>
      new Set(
        envios.filter((e) => e.status === "enviado" || e.status === "pendente").map((e) => e.company_id)
      ),
    [envios]
  );

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const d = t.replace(/\D/g, "");
    return destinatarios.filter(
      (e) => !t || e.name.toLowerCase().includes(t) || (d && String(e.cnpj).includes(d))
    );
  }, [destinatarios, busca]);

  const marcaveis = destinatarios.filter((e) => e.whatsapp_ok && !jaNaCircular.has(e.id));
  const todasMarcadas = marcaveis.length > 0 && marcaveis.every((e) => marcadas.has(e.id));

  const alternar = (id: string) =>
    setMarcadas((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selecionada = circulares.find((c) => c.id === selecionadaId) ?? null;
  const total = detalhe ? detalhe.enviados + detalhe.pendentes + detalhe.falhas : 0;
  const progresso = total ? Math.round(((detalhe!.enviados + detalhe!.falhas) / total) * 100) : 0;
  const rodando = Boolean(detalhe?.rodando || detalhe?.status === "enviando");

  return (
    <AdminLayout title="Circular" description="Mensagem com vídeo ou imagem para as empresas ativas pelo WhatsApp">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Coluna 1: conversa (histórico + compor) */}
        <Card className="flex min-h-[28rem] flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4" /> Circulares
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Sai em duas mensagens: primeiro o texto, depois o vídeo/imagem. Uma empresa a cada ~30s,
              das 08h às 19h.
            </p>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            <div className="flex max-h-[26rem] flex-1 flex-col gap-3 overflow-y-auto rounded-md border bg-muted/30 p-3">
              {!circulares.length && (
                <p className="m-auto text-center text-sm text-muted-foreground">Nenhuma circular ainda. Escreva abaixo.</p>
              )}
              {[...circulares].reverse().map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelecionadaId(c.id);
                    setMarcadas(new Set());
                  }}
                  className={`rounded-lg p-2 text-left transition ${
                    c.id === selecionadaId ? "bg-primary/10 ring-2 ring-primary" : "hover:bg-muted"
                  }`}
                >
                  <Bolhas texto={c.texto} midiaUrl={c.midia_url} tipo={c.midia_tipo} />
                  <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-[11px] text-muted-foreground">
                    <span>{quando(c.criado_em)}</span>
                    <Badge variant="outline" className={STATUS_CIRCULAR[c.status].className}>
                      {STATUS_CIRCULAR[c.status].label}
                    </Badge>
                    <span>
                      {c.enviados} enviada(s)
                      {c.pendentes ? ` · ${c.pendentes} na fila` : ""}
                      {c.falhas ? ` · ${c.falhas} falha(s)` : ""}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Compor */}
            <div className="space-y-2 rounded-md border p-2">
              {arquivo && previa && (
                <div className="relative w-fit">
                  {arquivo.type.startsWith("video") ? (
                    <video src={previa} className="max-h-32 rounded-md" />
                  ) : (
                    <img src={previa} alt="Prévia" className="max-h-32 rounded-md" />
                  )}
                  <button
                    type="button"
                    onClick={() => escolherArquivo(null)}
                    className="absolute -right-2 -top-2 rounded-full bg-background p-0.5 shadow"
                    aria-label="Remover anexo"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {arquivo.name} · {(arquivo.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
              )}
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Texto da circular (vai como primeira mensagem)"
                rows={3}
                maxLength={4000}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <input
                  ref={inputArquivo}
                  type="file"
                  accept="video/mp4,video/3gpp,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => inputArquivo.current?.click()}>
                  <Paperclip className="mr-1 h-4 w-4" />
                  Vídeo ou imagem
                  <span className="ml-1 hidden text-muted-foreground sm:inline">(até {MAX_MB} MB)</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={criar.isPending || (!texto.trim() && !arquivo)}
                  onClick={() => criar.mutate()}
                >
                  {criar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                  Criar circular
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Coluna 2: destinatários e andamento da circular escolhida */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Para quem enviar</CardTitle>
            <p className="text-xs text-muted-foreground">
              {temRascunho
                ? "Marque as empresas e clique em Enviar: a circular que você escreveu é criada e sai na hora."
                : selecionada
                  ? "Enviando a circular selecionada no histórico. Quem já recebeu fica de fora."
                  : "Escreva a circular ao lado (texto e/ou vídeo), marque as empresas e envie."}{" "}
              Teste primeiro com <strong>uma</strong> empresa; conferiu no celular, marque todas.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
              {/* Andamento */}
              {!temRascunho && detalhe && total > 0 && (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      <strong>{detalhe.enviados}</strong> de {total} enviada(s)
                      {detalhe.falhas ? ` · ${detalhe.falhas} falha(s)` : ""}
                    </span>
                    <div className="flex gap-2">
                      {rodando ? (
                        <Button size="sm" variant="outline" onClick={() => parar.mutate()} disabled={parar.isPending}>
                          <Pause className="mr-1 h-4 w-4" /> Parar
                        </Button>
                      ) : detalhe.pendentes > 0 ? (
                        <Button size="sm" onClick={() => retomar.mutate()} disabled={retomar.isPending}>
                          <Play className="mr-1 h-4 w-4" /> Retomar
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <Progress value={progresso} />
                  {detalhe.ultimo_erro && detalhe.status === "pausada" && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">{detalhe.ultimo_erro}</p>
                  )}
                </div>
              )}

              {/* Seleção */}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome ou CNPJ..."
                  className="h-9 min-w-0 flex-1"
                />
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={todasMarcadas}
                    onCheckedChange={(v) => setMarcadas(v ? new Set(marcaveis.map((e) => e.id)) : new Set())}
                  />
                  Marcar todas ({marcaveis.length})
                </label>
              </div>

              <div className="max-h-80 divide-y overflow-y-auto rounded-md border">
                {filtrados.map((e) => {
                  const envio = envios.find((x) => x.company_id === e.id);
                  const bloqueada = !e.whatsapp_ok || jaNaCircular.has(e.id);
                  const st = envio ? STATUS_ENVIO[envio.status] : null;
                  return (
                    <label
                      key={e.id}
                      className={`flex items-center gap-3 px-3 py-2 text-sm ${bloqueada ? "opacity-70" : "cursor-pointer hover:bg-muted/50"}`}
                    >
                      <Checkbox
                        checked={marcadas.has(e.id)}
                        disabled={bloqueada}
                        onCheckedChange={() => alternar(e.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{e.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {e.whatsapp_ok ? e.whatsapp : e.motivo || "Sem WhatsApp"}
                        </p>
                      </div>
                      {st && (
                        <span className={`flex shrink-0 items-center gap-1 text-xs ${st.className}`} title={envio?.erro || ""}>
                          <st.icon className="h-3.5 w-3.5" /> {st.label}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                {!temRascunho && detalhe && detalhe.enviados === 0 && !rodando ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => apagar.mutate(detalhe.id)}
                    disabled={apagar.isPending}
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> Apagar circular
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  disabled={!marcadas.size || enviar.isPending || (!temRascunho && !selecionada)}
                  title={!temRascunho && !selecionada ? "Escreva a circular ao lado primeiro" : undefined}
                  onClick={() => (marcadas.size === 1 ? enviar.mutate() : setConfirmar(true))}
                >
                  {enviar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                  {marcadas.size <= 1 ? "Enviar teste para 1 empresa" : `Enviar para ${marcadas.size} empresas`}
                </Button>
              </div>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {arquivo?.type.startsWith("video") || (!temRascunho && detalhe?.midia_tipo === "video") ? (
                  <Video className="h-3 w-3" />
                ) : arquivo || (!temRascunho && detalhe?.midia_tipo === "image") ? (
                  <ImageIcon className="h-3 w-3" />
                ) : null}
                Só empresas ativas aparecem aqui (arquivadas e excluídas nunca recebem). Número repetido em duas
                empresas recebe uma vez só.
              </p>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar para {marcadas.size} empresas?</AlertDialogTitle>
            <AlertDialogDescription>
              Cada empresa recebe o texto e, em seguida, o vídeo/imagem. O envio leva cerca de{" "}
              {Math.ceil((marcadas.size * 30) / 60)} minuto(s) e pode ser parado a qualquer momento. Não dá para
              desfazer o que já saiu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => enviar.mutate()}>Enviar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
};

export default CircularPage;
