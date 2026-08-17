import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  MessageCircle,
  Paperclip,
  RotateCcw,
  Send,
  UserCheck,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatDistanceToNow } from "date-fns";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";

/**
 * Conversas iniciadas pelos clientes a partir do portal. Tres blocos de atencao:
 *  - 3 cartoes no topo (na fila / meus / resolvidos hoje) com polling de 15s.
 *  - Lista filtrada de conversas, tambem a 15s.
 *  - Ao abrir uma conversa, marca como lida e passa a puxar as mensagens a cada 5s.
 *
 * Acoes (assumir / transferir / resolver / reabrir) sao PATCH na propria conversa;
 * "assumir" pode dar 409 se outro atendente pegou no mesmo segundo - ai mostra o
 * motivo no toast e forca recarregar a lista, sem deixar o operador achar que assumiu
 * uma conversa que ja nao e mais sua.
 */

type Conversation = {
  id: string;
  subject: string | null;
  status: string;
  assigned_to: string | null;
  created_at: string;
  last_message_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  empresa: string;
  cnpj: string;
  responsavel_nome: string | null;
  nao_lidas: number;
  ultima_mensagem: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  aberto: "Aberto",
  em_atendimento: "Em atendimento",
  resolvido: "Resolvido",
};

function StatusBadge({ status }: { status: string }) {
  // Cores vem direto no className porque o componente Badge do projeto so conhece as
  // variants padrao (default/secondary/outline/destructive) - pedir uma variant
  // customizada exige mexer em UI, entao deixamos a cor por aqui.
  const cls =
    status === "aberto"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : status === "em_atendimento"
        ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
        : status === "resolvido"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "";
  return (
    <Badge variant="outline" className={cls}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function formatarHora(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "dd/MM HH:mm", { locale: ptBR });
}

function tempoRelativo(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
  } catch {
    return "";
  }
}

const AtendimentosPage = () => {
  const queryClient = useQueryClient();
  // O filtro pode vir na URL (?status=aberto): é assim que os cartões da Visão geral
  // levam direto para a fila que a pessoa clicou, em vez de largá-la na lista inteira.
  const [searchParams] = useSearchParams();
  const statusDaUrl = searchParams.get("status") || "";
  const [statusFiltro, setStatusFiltro] = useState<string>(
    ["aberto", "em_atendimento", "resolvido"].includes(statusDaUrl) ? statusDaUrl : "todos"
  );
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ["admin-atendimentos-summary"],
    queryFn: () => api.atendimentos.summary(),
    refetchInterval: 15_000,
  });

  const conversasQuery = useQuery({
    queryKey: ["admin-atendimentos-list", statusFiltro],
    queryFn: () =>
      api.atendimentos.list(
        statusFiltro && statusFiltro !== "todos" ? { status: statusFiltro } : undefined
      ),
    refetchInterval: 15_000,
  });

  const conversas: Conversation[] = conversasQuery.data?.conversations ?? [];

  const conversasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return conversas;
    return conversas.filter((c) => c.empresa.toLowerCase().includes(termo));
  }, [conversas, busca]);

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-atendimentos-list"] });
    queryClient.invalidateQueries({ queryKey: ["admin-atendimentos-summary"] });
    queryClient.invalidateQueries({ queryKey: ["admin-atendimentos-unread"] });
  };

  return (
    <AdminLayout title="Atendimentos" description="Conversas com os clientes pelo portal">
      {/* Cartoes de resumo - polling a cada 15s, alinhado com a lista abaixo. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <Inbox className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{summary.data?.na_fila ?? "—"}</p>
              <p className="text-xs text-muted-foreground">Na fila</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{summary.data?.meus ?? "—"}</p>
              <p className="text-xs text-muted-foreground">Meus</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{summary.data?.resolvidos_hoje ?? "—"}</p>
              <p className="text-xs text-muted-foreground">Resolvidos hoje</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {aberta ? (
        <ConversaView
          id={aberta}
          onVoltar={() => {
            setAberta(null);
            invalidar();
          }}
          onMudou={invalidar}
        />
      ) : (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={statusFiltro} onValueChange={setStatusFiltro}>
                <SelectTrigger className="h-9 w-48 text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="aberto">Aberto</SelectItem>
                  <SelectItem value="em_atendimento">Em atendimento</SelectItem>
                  <SelectItem value="resolvido">Resolvido</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative min-w-[220px] flex-1">
                <MessageCircle className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Buscar por empresa…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
            </div>

            {conversasQuery.isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
            ) : conversasFiltradas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma conversa encontrada.
              </p>
            ) : (
              <ul className="divide-y">
                {conversasFiltradas.map((c) => (
                  <li key={c.id}>
                    <button
                      className="flex w-full flex-wrap items-center gap-2 rounded-md p-3 text-left hover:bg-muted/50"
                      onClick={() => setAberta(c.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{c.empresa}</span>
                          <span className="text-xs text-muted-foreground">CNPJ {c.cnpj}</span>
                        </div>
                        <p className="truncate text-sm text-muted-foreground">
                          {c.subject ?? "(sem assunto)"}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {tempoRelativo(c.last_message_at) || formatarHora(c.last_message_at)}
                          {c.responsavel_nome && (
                            <>
                              {" · "}
                              <span>{c.responsavel_nome}</span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <StatusBadge status={c.status} />
                        {c.nao_lidas > 0 && <Badge variant="destructive">{c.nao_lidas}</Badge>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </AdminLayout>
  );
};

type MessagesResponse = Awaited<ReturnType<typeof api.atendimentos.messages>>;

function ConversaView({
  id,
  onVoltar,
  onMudou,
}: {
  id: string;
  onVoltar: () => void;
  onMudou: () => void;
}) {
  const queryClient = useQueryClient();
  const [resposta, setResposta] = useState("");
  const mensagensRef = useRef<HTMLDivElement | null>(null);

  const conversa = useQuery({
    queryKey: ["admin-atendimentos-messages", id],
    queryFn: () => api.atendimentos.messages(id),
    refetchInterval: 5_000,
  });

  // Marca como lida na primeira vez que a conversa e aberta. Erro aqui e benigno: o
  // servidor pode ja ter marcado como lida por conta de outra aba - nao precisa de
  // toast de erro so porque o estado ja bateu.
  useEffect(() => {
    let cancelado = false;
    api.atendimentos
      .markRead(id)
      .then(() => {
        if (cancelado) return;
        queryClient.invalidateQueries({ queryKey: ["admin-atendimentos-list"] });
        queryClient.invalidateQueries({ queryKey: ["admin-atendimentos-unread"] });
        queryClient.invalidateQueries({ queryKey: ["admin-atendimentos-summary"] });
      })
      .catch(() => {
        /* silencioso */
      });
    return () => {
      cancelado = true;
    };
  }, [id, queryClient]);

  // Auto-scroll para a mensagem mais recente quando a lista cresce.
  useEffect(() => {
    const el = mensagensRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [conversa.data?.messages?.length]);

  const enviar = useMutation({
    mutationFn: (vars: { body: string; clientMsgId: string }) =>
      api.atendimentos.send(id, vars.body, vars.clientMsgId),
    onSuccess: () => {
      setResposta("");
      queryClient.invalidateQueries({ queryKey: ["admin-atendimentos-messages", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-atendimentos-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enviarArquivo = useMutation({
    mutationFn: ({ file, enviarAoPortal }: { file: File; enviarAoPortal: boolean }) =>
      api.atendimentos.uploadFile(id, file, resposta.trim() || undefined, enviarAoPortal),
    onSuccess: (data) => {
      setResposta("");
      queryClient.invalidateQueries({ queryKey: ["admin-atendimentos-messages", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-atendimentos-list"] });
      toast.success(data?.deliverable_criado ? "Documento enviado e disponibilizado no portal" : "Documento enviado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [enviarAoPortal, setEnviarAoPortal] = useState(false);

  // Para "transferir" precisamos da lista de atendentes - so vale a pena buscar quando
  // o operador clica em "Transferir", porque a lista nao muda o tempo todo e o select
  // precisa dela para renderizar.
  const [transferirAberto, setTransferirAberto] = useState(false);
  const [transferirPara, setTransferirPara] = useState<string>("");
  const atendentes = useQuery({
    queryKey: ["admin-atendimentos-atendentes"],
    queryFn: () => api.atendimentos.atendentes(),
    enabled: transferirAberto,
  });

  const acao = useMutation({
    mutationFn: (vars: {
      action: "assumir" | "transferir" | "resolver" | "reabrir";
      transferirPara?: string;
    }) => api.atendimentos.action(id, vars.action, vars.transferirPara),
    onSuccess: (_r, vars) => {
      toast.success(
        vars.action === "assumir"
          ? "Conversa assumida."
          : vars.action === "transferir"
            ? "Conversa transferida."
            : vars.action === "resolver"
              ? "Conversa resolvida."
              : "Conversa reaberta."
      );
      setTransferirAberto(false);
      setTransferirPara("");
      queryClient.invalidateQueries({ queryKey: ["admin-atendimentos-messages", id] });
      onMudou();
    },
    onError: (e: Error) => {
      // O backend devolve "Outro atendente assumiu" no 409 do "assumir". Qualquer
      // mensagem vinda do servidor e mostrada como esta - nao vale a pena reinventar.
      toast.error(e.message || "Não foi possível concluir a ação.");
      onMudou();
    },
  });

  const dados: MessagesResponse | undefined = conversa.data;
  const status = dados?.conversation.status ?? "aberto";
  const assignedTo = dados?.conversation.assigned_to ?? null;

  return (
    <Card>
      <CardContent className="flex h-[70vh] flex-col gap-0 p-0">
        {/* Cabecalho */}
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Button variant="ghost" size="icon" onClick={onVoltar} title="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {dados?.empresa?.name ?? "—"}
              {dados?.empresa?.cnpj && (
                <span className="ml-2 text-xs text-muted-foreground">
                  CNPJ {dados.empresa.cnpj}
                </span>
              )}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {dados?.conversation.subject ?? "(sem assunto)"}
            </p>
          </div>
          <StatusBadge status={status} />

          {status === "aberto" && !assignedTo && (
            <Button
              size="sm"
              onClick={() => acao.mutate({ action: "assumir" })}
              disabled={acao.isPending}
            >
              <UserCheck className="mr-2 h-4 w-4" />
              Assumir
            </Button>
          )}
          {status !== "resolvido" && assignedTo && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => acao.mutate({ action: "resolver" })}
                disabled={acao.isPending}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Resolver
              </Button>
              {!transferirAberto ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTransferirAberto(true)}
                  disabled={acao.isPending}
                >
                  <ArrowRightLeft className="mr-2 h-4 w-4" />
                  Transferir
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Select value={transferirPara} onValueChange={setTransferirPara}>
                    <SelectTrigger className="h-9 w-48 text-sm">
                      <SelectValue placeholder="Escolha o atendente" />
                    </SelectTrigger>
                    <SelectContent>
                      {(atendentes.data?.atendentes ?? []).map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={() =>
                      acao.mutate({ action: "transferir", transferirPara: transferirPara })
                    }
                    disabled={acao.isPending || !transferirPara}
                  >
                    Confirmar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTransferirAberto(false);
                      setTransferirPara("");
                    }}
                    disabled={acao.isPending}
                  >
                    Cancelar
                  </Button>
                </div>
              )}
            </>
          )}
          {status === "resolvido" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => acao.mutate({ action: "reabrir" })}
              disabled={acao.isPending}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reabrir
            </Button>
          )}
        </div>

        {/* Mensagens */}
        <div
          ref={mensagensRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-3"
        >
          {conversa.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : (dados?.messages ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma mensagem ainda.
            </p>
          ) : (
            dados?.messages.map((m) => {
              if (m.sender_type === "system") {
                return (
                  <div
                    key={m.id}
                    className="my-1 text-center text-xs italic text-muted-foreground"
                  >
                    {m.body}
                  </div>
                );
              }
              const ehAdmin = m.sender_type === "admin" || m.sender_type === "attendant";
              return (
                <div
                  key={m.id}
                  className={`flex ${ehAdmin ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      ehAdmin
                        ? "bg-primary/10 text-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    {m.attachment_name && (
                      <a
                        href={`/api/uploads/${m.attachment_path}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 rounded bg-background/50 px-2 py-1 text-xs text-primary hover:underline"
                      >
                        <Paperclip className="h-3 w-3" />
                        {m.attachment_name}
                      </a>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {m.sender_name ?? (ehAdmin ? "Atendente" : "Cliente")}
                      {" · "}
                      {formatarHora(m.created_at)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Composer - so envia se a conversa nao estiver resolvida. */}
        <div
          className={`border-t transition-colors ${arrastando ? "bg-primary/5 border-primary" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            const file = e.dataTransfer.files?.[0];
            if (file) enviarArquivo.mutate({ file, enviarAoPortal });
          }}
        >
          {arrastando && (
            <p className="text-center text-xs text-primary py-2">Solte o arquivo aqui</p>
          )}
          <div className="flex items-center gap-1 px-3 pt-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enviarAoPortal}
                onChange={(e) => setEnviarAoPortal(e.target.checked)}
                className="rounded border-muted-foreground/40"
              />
              Disponibilizar no portal do cliente
            </label>
          </div>
          <form
            className="flex items-center gap-2 p-3 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              const body = resposta.trim();
              if (!body) return;
              enviar.mutate({ body, clientMsgId: crypto.randomUUID() });
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.zip"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) enviarArquivo.mutate({ file, enviarAoPortal });
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              disabled={status === "resolvido" || enviarArquivo.isPending}
              onClick={() => fileInputRef.current?.click()}
              title="Enviar documento"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Input
              placeholder={
                status === "resolvido"
                  ? "Conversa resolvida — reabra para responder."
                  : "Digite sua resposta…"
              }
              value={resposta}
              onChange={(e) => setResposta(e.target.value)}
              disabled={status === "resolvido" || enviar.isPending}
            />
            <Button
              type="submit"
              disabled={status === "resolvido" || enviar.isPending || !resposta.trim()}
            >
              <Send className="mr-2 h-4 w-4" />
              Enviar
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

export default AtendimentosPage;
