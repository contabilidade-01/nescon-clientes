import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  Plus,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { PortalPage } from "@/components/PortalPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";

/** Os mesmos três valores do CHECK em `conversations.status` (ensureChatSchema.js).
 *  Tipar como `string` foi o que deixou passar a comparação com "resolved" (inglês),
 *  que nunca casava e fazia a conversa encerrada seguir parecendo aberta. */
type ConversationStatus = "aberto" | "em_atendimento" | "resolvido";

type Conversation = {
  id: string;
  subject: string | null;
  status: ConversationStatus;
  created_at: string;
  last_message_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  nao_lidas: number;
  ultima_mensagem: string | null;
};

type Message = {
  id: string;
  sender_type: string;
  sender_name: string | null;
  body: string;
  created_at: string;
};

const MensagensPage = () => {
  const { company } = useAuth();
  const qc = useQueryClient();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Lista de conversas — polling a cada 15s. */
  const convQuery = useQuery({
    queryKey: ["chat-conversations"],
    queryFn: () => api.chat.conversations(),
    enabled: !!company,
    refetchInterval: 15000,
  });

  const conversations: Conversation[] = useMemo(
    () => convQuery.data?.conversations ?? [],
    [convQuery.data]
  );

  /** Separar por status: abertas em cima, resolvidas embaixo. */
  const { abertas, resolvidas } = useMemo(() => {
    const abertas: Conversation[] = [];
    const resolvidas: Conversation[] = [];
    for (const c of conversations) {
      if (c.status === "resolvido") resolvidas.push(c);
      else abertas.push(c);
    }
    abertas.sort(
      (a, b) =>
        new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    );
    resolvidas.sort(
      (a, b) =>
        new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    );
    return { abertas, resolvidas };
  }, [conversations]);

  /** Mensagens da conversa ativa — polling a cada 5s. */
  const messagesQuery = useQuery({
    queryKey: ["chat-messages", activeId],
    queryFn: () => api.chat.messages(activeId as string),
    enabled: !!activeId,
    refetchInterval: 5000,
  });

  const messages: Message[] = useMemo(
    () => messagesQuery.data?.messages ?? [],
    [messagesQuery.data]
  );

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  /** Quando abrir uma conversa, marcar como lida e rolar para o fim. */
  const markReadMut = useMutation({
    mutationFn: (id: string) => api.chat.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
      qc.invalidateQueries({ queryKey: ["chat-unread"] });
    },
  });

  useEffect(() => {
    if (activeId) {
      markReadMut.mutate(activeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  /** Auto-scroll para a mensagem mais recente quando a lista muda. */
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, activeId]);

  /** Enviar mensagem na conversa ativa. */
  const sendMut = useMutation({
    mutationFn: ({ id, body, clientMsgId }: { id: string; body: string; clientMsgId: string }) =>
      api.chat.send(id, body, clientMsgId),
    onSuccess: (res) => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["chat-messages", activeId] });
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
      if (res.reaberta) {
        toast.success("Conversa reaberta");
      }
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar mensagem");
    },
  });

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !activeId) return;
    sendMut.mutate({ id: activeId, body: text, clientMsgId: crypto.randomUUID() });
  };

  /** Criar nova conversa. */
  const createMut = useMutation({
    mutationFn: ({ body, subject, clientMsgId }: { body: string; subject?: string; clientMsgId: string }) =>
      api.chat.create(body, subject, clientMsgId),
    onSuccess: (res) => {
      setShowNew(false);
      setNewSubject("");
      setNewBody("");
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
      qc.invalidateQueries({ queryKey: ["chat-unread"] });
      setActiveId(res.conversation.id);
      toast.success("Conversa criada");
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Falha ao abrir conversa");
    },
  });

  const handleCreate = () => {
    const body = newBody.trim();
    if (!body) return;
    const subject = newSubject.trim() || undefined;
    createMut.mutate({ body, subject, clientMsgId: crypto.randomUUID() });
  };

  /** Encerrar (resolver) a conversa ativa. */
  const resolveMut = useMutation({
    mutationFn: (id: string) => api.chat.resolve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
      qc.invalidateQueries({ queryKey: ["chat-messages", activeId] });
      toast.success("Conversa encerrada");
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Falha ao encerrar conversa");
    },
  });

  const handleResolve = () => {
    if (!activeId) return;
    if (!confirm("Encerrar esta conversa? Você poderá reabrir enviando uma nova mensagem.")) {
      return;
    }
    resolveMut.mutate(activeId);
  };

  const isResolved = activeConv?.status === "resolvido";

  return (
    <PortalPage title="Mensagens" subtitle={company?.name} wide>
      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        {/* Lista de conversas */}
        <Card className="self-start">
          <CardContent className="p-3">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <h2 className="text-sm font-semibold text-foreground">Conversas</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowNew((s) => !s)}
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Nova
              </Button>
            </div>

            {showNew && (
              <div className="mb-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                <Input
                  placeholder="Assunto (opcional)"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  className="bg-card"
                />
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Escreva sua mensagem..."
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowNew(false);
                      setNewSubject("");
                      setNewBody("");
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCreate}
                    disabled={!newBody.trim() || createMut.isPending}
                    className="gap-1"
                  >
                    {createMut.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Abrir
                  </Button>
                </div>
              </div>
            )}

            {convQuery.isLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando...
              </div>
            ) : conversations.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-8 text-center">
                <MessageCircle className="mx-auto h-7 w-7 text-muted-foreground/60" />
                <p className="mt-2 text-xs text-muted-foreground">
                  Nenhuma conversa ainda. Inicie uma nova conversa com a contabilidade.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {abertas.length > 0 && (
                  <div>
                    <p className="eyebrow px-1 pb-1">Abertas</p>
                    <div className="space-y-1">
                      {abertas.map((c) => (
                        <ConversationItem
                          key={c.id}
                          c={c}
                          active={activeId === c.id}
                          onClick={() => setActiveId(c.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {resolvidas.length > 0 && (
                  <div>
                    <p className="eyebrow px-1 pb-1">Encerradas</p>
                    <div className="space-y-1">
                      {resolvidas.map((c) => (
                        <ConversationItem
                          key={c.id}
                          c={c}
                          active={activeId === c.id}
                          onClick={() => setActiveId(c.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Janela de chat */}
        <Card className="flex h-[70vh] flex-col">
          {!activeId ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground">
              <MessageCircle className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm">
                Selecione uma conversa à esquerda ou abra uma nova para falar com a contabilidade.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {activeConv?.subject || "Conversa"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isResolved ? "Encerrada" : "Em atendimento"}
                  </p>
                </div>
                {!isResolved && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleResolve}
                    disabled={resolveMut.isPending}
                    className="gap-1"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Encerrar
                  </Button>
                )}
              </div>

              <div
                ref={scrollRef}
                className="flex-1 space-y-2 overflow-y-auto bg-muted/20 p-4"
              >
                {messagesQuery.isLoading ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Carregando mensagens...
                  </div>
                ) : messages.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Sem mensagens ainda.
                  </p>
                ) : (
                  messages.map((m) => <MessageBubble key={m.id} m={m} />)
                )}
              </div>

              <div className="border-t border-border p-3">
                {isResolved && (
                  <p className="mb-2 rounded-md bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                    Esta conversa está encerrada. Envie uma mensagem para reabrir.
                  </p>
                )}
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                  }}
                >
                  <Input
                    placeholder={
                      isResolved
                        ? "Reabrir conversa com uma mensagem..."
                        : "Digite sua mensagem..."
                    }
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={sendMut.isPending}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!draft.trim() || sendMut.isPending}
                    aria-label="Enviar"
                  >
                    {sendMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </form>
              </div>
            </>
          )}
        </Card>
      </div>
    </PortalPage>
  );
};

function ConversationItem({
  c,
  active,
  onClick,
}: {
  c: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const isResolved = c.status === "resolvido";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
        active
          ? "border-primary bg-primary/10"
          : "border-transparent hover:bg-muted"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground">
          {c.subject || "Conversa"}
        </span>
        {c.nao_lidas > 0 && (
          <Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-[10px]">
            {c.nao_lidas}
          </Badge>
        )}
      </div>
      {c.ultima_mensagem && (
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {c.ultima_mensagem}
        </p>
      )}
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{format(new Date(c.last_message_at), "dd/MM HH:mm", { locale: ptBR })}</span>
        {isResolved && <span className="italic">Encerrada</span>}
      </div>
    </button>
  );
}

function MessageBubble({ m }: { m: Message }) {
  const isSystem = m.sender_type === "system";
  const isClient = m.sender_type === "client";

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <p className="max-w-[80%] rounded-full bg-muted px-3 py-1 text-center text-xs italic text-muted-foreground">
          {m.body}
        </p>
      </div>
    );
  }

  return (
    <div className={`flex ${isClient ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isClient
            ? "rounded-br-sm bg-primary/10 text-foreground"
            : "rounded-bl-sm bg-muted text-foreground"
        }`}
      >
        {!isClient && m.sender_name && (
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {m.sender_name}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
        <p className="mt-1 text-right text-[10px] text-muted-foreground">
          {format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}
        </p>
      </div>
    </div>
  );
}

export default MensagensPage;