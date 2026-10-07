import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { PadraoHonorario } from "@/lib/contratoModelo";
import {
  aplicarPatch,
  catalogoParaAssistente,
  estadoParaAssistente,
  type CatalogoProposta,
  type PropostaDados,
} from "@/lib/propostaModelo";

type Msg = { role: "user" | "assistant"; content: string; avisos?: string[]; mudancas?: string[] };

const SUGESTOES = [
  "MEI com DASN de 2022, 2023 e 2024 em atraso e uns R$ 8 mil de DAS para parcelar. Depois quer a contabilidade mensal.",
  "Abrir uma empresa de serviços com 2 sócios, quer começar logo.",
  "Empresa no Simples com 8 meses de PGDAS em atraso, dívida na Receita de R$ 25 mil e na prefeitura.",
  "Alterar endereço e incluir um sócio.",
];

/** O que mudou entre duas versões da proposta, em linguagem de gente (para o balão do assistente). */
function descreverMudancas(antes: PropostaDados, depois: PropostaDados): string[] {
  const out: string[] = [];
  const idsAntes = new Map(antes.itens.map((i) => [i.uid, i]));
  for (const i of depois.itens) {
    const a = idsAntes.get(i.uid);
    if (!a) out.push(`+ ${i.titulo}${i.quantidade > 1 ? ` (×${i.quantidade})` : ""}`);
    else if (a.quantidade !== i.quantidade || a.valorUnit !== i.valorUnit || a.modo !== i.modo || a.base !== i.base || a.percentual !== i.percentual)
      out.push(`~ ${i.titulo} atualizado`);
  }
  const idsDepois = new Set(depois.itens.map((i) => i.uid));
  for (const a of antes.itens) if (!idsDepois.has(a.uid)) out.push(`− ${a.titulo}`);
  const c = antes.cliente;
  const n = depois.cliente;
  if (c.nome !== n.nome && n.nome) out.push(`Cliente: ${n.nome}`);
  if (c.enquadramento !== n.enquadramento || c.tipoEmpresa !== n.tipoEmpresa || c.complexidade !== n.complexidade)
    out.push(`Perfil: ${n.enquadramento} · ${n.tipoEmpresa} · ${n.complexidade}`);
  if (c.funcionarios !== n.funcionarios) out.push(`Funcionários: ${n.funcionarios}`);
  return out;
}

export function AssistentePropostas({
  dados,
  setDados,
  catalogo,
  tabela,
  habilitado,
  motivoDesligado,
}: {
  dados: PropostaDados;
  setDados: (d: PropostaDados) => void;
  catalogo: CatalogoProposta;
  tabela?: PadraoHonorario[] | null;
  habilitado: boolean;
  motivoDesligado?: string;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Oi! Me conte sobre o cliente e o que ele precisa — pode ser tudo de uma vez, do jeito que vier. Eu monto os itens e só pergunto o que faltar. Os valores saem do seu catálogo.",
    },
  ]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const dadosRef = useRef(dados);
  dadosRef.current = dados;

  useEffect(() => {
    fim.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [msgs, enviando]);

  async function enviar(conteudo: string) {
    const t = conteudo.trim();
    if (!t || enviando || !habilitado) return;
    const historico: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(historico);
    setTexto("");
    setEnviando(true);
    try {
      const r = await api.admin.propostas.assistente({
        mensagens: historico.map((m) => ({ role: m.role, content: m.content })),
        catalogo: catalogoParaAssistente(catalogo),
        estado: estadoParaAssistente(dadosRef.current),
      });
      const antes = dadosRef.current;
      const { dados: depois, avisos } = aplicarPatch(antes, r.patch, catalogo, tabela);
      setDados(depois);
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: r.mensagem || "Pronto.", avisos, mudancas: descreverMudancas(antes, depois) },
      ]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `Não consegui responder agora: ${(e as Error).message}` }]);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!habilitado ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {motivoDesligado || "Assistente desligado."} Enquanto isso, use os pacotes e as abas <b>Cliente</b> e <b>Serviços</b> — o resultado é o mesmo.
        </div>
      ) : null}

      <div className="max-h-[48vh] min-h-[200px] space-y-2 overflow-auto rounded-md border bg-muted/30 p-3">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "border bg-background"
              }`}
            >
              {m.role === "assistant" && i === 0 ? <Sparkles className="mr-1 inline h-3.5 w-3.5 text-amber-500" /> : null}
              {m.content}
              {m.mudancas?.length ? (
                <ul className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
                  {m.mudancas.map((x, k) => (
                    <li key={k}>{x}</li>
                  ))}
                </ul>
              ) : null}
              {m.avisos?.length ? (
                <ul className="mt-2 space-y-0.5 border-t pt-2 text-xs text-amber-700">
                  {m.avisos.map((x, k) => (
                    <li key={k}>⚠ {x}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ))}
        {enviando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> montando a proposta…
          </div>
        ) : null}
        <div ref={fim} />
      </div>

      {msgs.length <= 1 && habilitado ? (
        <div className="flex flex-wrap gap-1.5">
          {SUGESTOES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setTexto(s)}
              className="rounded-full border bg-background px-2.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
            >
              {s.length > 70 ? `${s.slice(0, 68)}…` : s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <Textarea
          value={texto}
          rows={2}
          disabled={!habilitado || enviando}
          placeholder={habilitado ? "Descreva o cliente e o que ele precisa… (Enter envia, Shift+Enter quebra a linha)" : "Assistente indisponível"}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar(texto);
            }
          }}
        />
        <Button onClick={() => void enviar(texto)} disabled={!habilitado || enviando || !texto.trim()}>
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
