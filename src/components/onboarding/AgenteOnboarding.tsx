import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, Loader2, Send, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { ModeloEntrada } from "@/lib/onboardingModelo";

type Mensagem = { role: "user" | "assistant"; content: string };

const SUGESTOES = [
  "Monte um roteiro para uma empresa do Simples, serviços, com 3 funcionários.",
  "Quero um modelo enxuto para MEI sem funcionários.",
  "Adicione os documentos de folha de pagamento só para quem tem funcionários.",
];

/** Base de conhecimento do agente: o texto de onde ele tira o que o escritório pede de cada cliente. */
export function BaseConhecimento({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const cfg = useQuery({ queryKey: ["admin-onboarding", "ia-config"], queryFn: () => api.admin.onboarding.iaConfig(), enabled: aberto });
  const [texto, setTexto] = useState<string | null>(null);
  const atual = texto ?? cfg.data?.conhecimento ?? "";

  const salvar = useMutation({
    mutationFn: () => api.admin.onboarding.salvarConhecimento(atual),
    onSuccess: () => {
      toast.success("Base de conhecimento salva. O agente já usa o novo texto.");
      queryClient.invalidateQueries({ queryKey: ["admin-onboarding", "ia-config"] });
      setTexto(null);
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Base de conhecimento do agente</DialogTitle>
          <DialogDescription>
            O que a Nescon pede de cada tipo de cliente, os prazos usuais e o tom dos textos. O agente monta os modelos a partir disto; escreva em linguagem comum.
          </DialogDescription>
        </DialogHeader>
        {cfg.isLoading ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        ) : (
          <>
            <Textarea
              rows={16}
              value={atual}
              maxLength={cfg.data?.limite}
              onChange={(e) => setTexto(e.target.value)}
              aria-label="Texto da base de conhecimento"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              {atual.length}/{cfg.data?.limite ?? 12000} caracteres
            </p>
          </>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" disabled={!cfg.data} onClick={() => setTexto(cfg.data?.conhecimento_padrao ?? "")}>
            Restaurar texto inicial
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="button" disabled={salvar.isPending || !cfg.data} onClick={() => salvar.mutate()}>
              {salvar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Conversa com o agente. Cada resposta com `modelo` substitui o rascunho da tela (com
 * "Desfazer" para voltar); nada é salvo até o operador clicar em Salvar no construtor.
 */
export function AgenteOnboarding({ modelo, onAplicar }: { modelo: ModeloEntrada; onAplicar: (m: ModeloEntrada) => void }) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [entrada, setEntrada] = useState("");
  const [anterior, setAnterior] = useState<ModeloEntrada | null>(null);
  const [faltando, setFaltando] = useState<string[]>([]);
  const [baseAberta, setBaseAberta] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const cfg = useQuery({ queryKey: ["admin-onboarding", "ia-config"], queryFn: () => api.admin.onboarding.iaConfig() });

  const enviar = useMutation({
    mutationFn: (historico: Mensagem[]) => api.admin.onboarding.assistente({ mensagens: historico, modelo }),
    onSuccess: (r, historico) => {
      setMensagens([...historico, { role: "assistant", content: r.mensagem }]);
      setFaltando(r.pronto ? [] : r.faltando);
      if (r.modelo) {
        setAnterior(modelo);
        onAplicar({ ...r.modelo, nome: r.modelo.nome || modelo.nome, ativo: modelo.ativo });
      }
      setTimeout(() => fim.current?.scrollIntoView?.({ behavior: "smooth" }), 50);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mandar = (texto: string) => {
    const t = texto.trim();
    if (!t || enviar.isPending) return;
    const historico: Mensagem[] = [...mensagens, { role: "user", content: t }];
    setMensagens(historico);
    setEntrada("");
    enviar.mutate(historico);
  };

  const semChave = cfg.data && !cfg.data.ia;

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> Agente de IA
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setBaseAberta(true)}>
          <BookOpen className="mr-1 h-4 w-4" /> Base de conhecimento
        </Button>
      </div>

      <div className="max-h-[420px] min-h-48 flex-1 space-y-3 overflow-y-auto p-3 text-sm" aria-live="polite">
        {semChave && (
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            Chave da Claude não configurada (ANTHROPIC_API_KEY ou Configurações › IA). Você ainda pode montar o modelo arrastando os blocos.
          </p>
        )}
        {!mensagens.length && (
          <div className="space-y-2">
            <p className="text-muted-foreground">Conte que tipo de cliente quer atender. O agente pergunta o que faltar e monta o roteiro; você revisa, arrasta e salva.</p>
            {SUGESTOES.map((s) => (
              <button key={s} type="button" disabled={Boolean(semChave)} onClick={() => mandar(s)} className="block w-full rounded-md border p-2 text-left text-xs hover:bg-accent disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        )}
        {mensagens.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-8 rounded-lg bg-primary/10 p-2" : "mr-8 rounded-lg bg-muted p-2"}>
            {m.content}
          </div>
        ))}
        {enviar.isPending && (
          <div className="mr-8 flex items-center gap-2 rounded-lg bg-muted p-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Montando…
          </div>
        )}
        {faltando.length > 0 && !enviar.isPending && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {faltando.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        <div ref={fim} />
      </div>

      {anterior && (
        <div className="flex items-center justify-between gap-2 border-t bg-muted/40 px-3 py-2 text-xs">
          <span>O agente atualizou o modelo. Revise antes de salvar.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              onAplicar(anterior);
              setAnterior(null);
            }}
          >
            <Undo2 className="mr-1 h-3.5 w-3.5" /> Desfazer
          </Button>
        </div>
      )}

      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          mandar(entrada);
        }}
      >
        <Textarea
          rows={2}
          value={entrada}
          disabled={Boolean(semChave)}
          placeholder="Descreva o cliente ou peça um ajuste…"
          aria-label="Mensagem para o agente"
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              mandar(entrada);
            }
          }}
        />
        <Button type="submit" size="icon" disabled={!entrada.trim() || enviar.isPending || Boolean(semChave)} aria-label="Enviar">
          <Send className="h-4 w-4" />
        </Button>
      </form>
      <BaseConhecimento aberto={baseAberta} onFechar={() => setBaseAberta(false)} />
    </div>
  );
}
