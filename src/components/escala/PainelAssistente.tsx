import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, RotateCcw, Send, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { executarFerramenta, type EstadoEscala } from "@/lib/escala/assistenteFerramentas";
import type { ResultadoDistribuicao } from "@/lib/escala/distribuir";

type Bloco = { type: string; [k: string]: unknown };
type Mensagem = { role: "user" | "assistant"; content: string | Bloco[] };

const SUGESTOES = [
  "Onde estão os gargalos da escala deste mês?",
  "Como a minha escala fica em 16/12/2026 e em 16/12/2027?",
  "Distribua a equipe em 5x2 com folgas variadas e me mostre antes de aplicar.",
  "Preciso de 4 pessoas por dia de segunda a sábado e 2 no domingo. Quantas faltam?",
];

/** Rodadas de ferramenta por pergunta: passa disso, a IA para e explica. */
const MAX_VOLTAS = 10;

/**
 * Assistente de IA do planejador: conversa, aponta gargalos, projeta as etapas e, se a
 * pessoa pedir, muda a escala aberta pelas ferramentas (sempre pela trava de regras).
 */
export function PainelAssistente({
  estado,
  companyId,
  onEstado,
  onSalvar,
}: {
  estado: EstadoEscala;
  companyId?: string;
  onEstado: (e: EstadoEscala) => void;
  onSalvar: (e: EstadoEscala) => Promise<void>;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [acoes, setAcoes] = useState<Record<string, { resumo: string; erro?: boolean }>>({});
  const [texto, setTexto] = useState("");
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const estadoRef = useRef(estado);
  const simulacoes = useRef(new Map<string, ResultadoDistribuicao>());
  const fimRef = useRef<HTMLDivElement | null>(null);

  // Fora de uma resposta, a IA enxerga o que está na tela (inclusive edições à mão).
  useEffect(() => {
    if (!rodando) estadoRef.current = estado;
  }, [estado, rodando]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, acoes]);

  async function enviar(pergunta: string) {
    const t = pergunta.trim();
    if (!t || rodando) return;
    setErro(null);
    setTexto("");
    setRodando(true);
    let msgs: Mensagem[] = [...mensagens, { role: "user", content: t }];
    setMensagens(msgs);
    try {
      for (let volta = 0; volta < MAX_VOLTAS; volta++) {
        const r = await api.escalas.assistente(msgs, companyId);
        // O conteúdo volta intacto na próxima chamada (inclui os blocos de raciocínio).
        msgs = [...msgs, { role: "assistant", content: r.content }];
        setMensagens(msgs);
        if (r.stop_reason === "refusal") {
          setErro("A IA não quis responder a este pedido. Tente reformular.");
          break;
        }
        if (r.stop_reason !== "tool_use") break;

        const usos = r.content.filter((b) => b.type === "tool_use");
        const resultados: Bloco[] = [];
        for (const u of usos) {
          const res = await executarFerramenta(
            String(u.name),
            (u.input as Record<string, unknown>) || {},
            estadoRef.current,
            simulacoes.current,
          );
          if (res.estado) {
            estadoRef.current = res.estado;
            onEstado(res.estado);
          }
          if (res.salvar) await onSalvar(estadoRef.current);
          setAcoes((a) => ({ ...a, [String(u.id)]: { resumo: res.resumo, erro: res.erro } }));
          resultados.push({ type: "tool_result", tool_use_id: u.id, content: res.conteudo, ...(res.erro ? { is_error: true } : {}) });
        }
        msgs = [...msgs, { role: "user", content: resultados }];
        setMensagens(msgs);
        if (volta === MAX_VOLTAS - 1) setErro("A IA usou muitas ferramentas seguidas e parou. Peça para continuar, se fizer sentido.");
      }
    } catch (e) {
      setErro((e as Error).message || "Falha ao falar com o assistente.");
    } finally {
      setRodando(false);
    }
  }

  function novaConversa() {
    setMensagens([]);
    setAcoes({});
    setErro(null);
    simulacoes.current = new Map();
  }

  return (
    <Card>
      <CardContent className="flex h-[620px] flex-col gap-3 p-4">
        <div className="flex items-start gap-2">
          <Bot className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Assistente de escalas (IA)</p>
            <p className="text-xs text-muted-foreground">
              Pergunte sobre as regras, gargalos e projeções, ou peça para montar e aplicar a escala. Tudo o que a IA muda passa pelas
              mesmas regras da grade e só é gravado quando você salva (ou pede para salvar).
            </p>
          </div>
          {mensagens.length > 0 && (
            <Button size="sm" variant="ghost" onClick={novaConversa} disabled={rodando}>
              <RotateCcw className="mr-1 h-4 w-4" /> Nova conversa
            </Button>
          )}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto rounded-md border bg-muted/20 p-3 text-sm">
          {mensagens.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Sugestões:</p>
              <div className="flex flex-wrap gap-2">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => enviar(s)}
                    className="rounded-full border bg-background px-3 py-1 text-left text-xs hover:border-primary/60"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mensagens.map((m, i) => {
            if (m.role === "user") {
              if (typeof m.content !== "string") return null; // resultados de ferramenta
              return (
                <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground">
                  {m.content}
                </div>
              );
            }
            const blocos = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
            return (
              <div key={i} className="max-w-[90%] space-y-1.5">
                {blocos.map((b, k) =>
                  b.type === "text" && String(b.text || "").trim() ? (
                    <div key={k} className="whitespace-pre-wrap rounded-lg border bg-background px-3 py-2">
                      {String(b.text)}
                    </div>
                  ) : b.type === "tool_use" ? (
                    <div
                      key={k}
                      className={`flex items-center gap-1.5 text-xs ${acoes[String(b.id)]?.erro ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                    >
                      <Wrench className="h-3 w-3" /> {acoes[String(b.id)]?.resumo ?? "Trabalhando…"}
                    </div>
                  ) : null,
                )}
              </div>
            );
          })}
          {rodando && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…
            </div>
          )}
          {erro && <p className="text-xs text-destructive">{erro}</p>}
          <div ref={fimRef} />
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            enviar(texto);
          }}
        >
          <Textarea
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar(texto);
              }
            }}
            placeholder="Ex.: Coloque 3 pessoas em 12x36 e o resto em 5x2 com folga na segunda"
            className="resize-none"
            disabled={rodando}
          />
          <Button type="submit" disabled={rodando || !texto.trim()} className="self-end">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
