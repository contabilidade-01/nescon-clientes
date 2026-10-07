/**
 * Agente de IA do contrato: o operador conversa, a IA devolve campos a preencher e o
 * navegador valida e aplica (contratoCampos.aplicarAtualizacoes). A IA não escreve
 * cláusula: a prévia ao lado muda porque os campos mudaram.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  aplicarAtualizacoes,
  campoDef,
  camposParaIa,
  definirCampo,
  estadoParaIa,
  fmtValor,
  lerCampo,
  CAMPOS,
  type ContratoPreset,
  type ModoAssistente,
} from "@/lib/contratoCampos";
import { TABELA_BASE, mesclarDados, type ContratoDados } from "@/lib/contratoModelo";

type Mudanca = { chave: string; rotulo: string; antes: string | number | boolean; depois: string | number | boolean };
type Msg = { role: "user" | "assistant"; content: string; mudancas?: Mudanca[]; avisos?: string[]; faltando?: string[]; pronto?: boolean };

const EXEMPLOS: Record<ModoAssistente, string[]> = {
  contrato: [
    "Loja de roupas no Simples, 2 funcionários, vence dia 10, começa em 01/11",
    "MEI de prestação de serviços, mensalidade de R$ 150",
    "Comércio de alta complexidade, 8 funcionários, sem 13º",
  ],
  aditivo: ["Reajuste de 8% na mensalidade a partir de janeiro", "Mudar o vencimento para o dia 5 e incluir mais 2 funcionários", "Passou a cobrar balancetes mensais"],
};

export function AssistenteContrato({
  modo,
  dados,
  onAlterar,
  presets,
  empresaNome,
  desabilitado,
}: {
  modo: ModoAssistente;
  dados: ContratoDados;
  /** Recebe a função que transforma os dados (evita ler estado velho). */
  onAlterar: (fn: (d: ContratoDados) => ContratoDados) => void;
  presets: ContratoPreset[];
  empresaNome?: string;
  desabilitado?: boolean;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const dadosRef = useRef(dados);
  const fimRef = useRef<HTMLDivElement>(null);
  dadosRef.current = dados;

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, enviando]);

  async function enviar(conteudo?: string) {
    const t = (conteudo ?? texto).trim();
    if (!t || enviando) return;
    const historico: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(historico);
    setTexto("");
    setEnviando(true);
    try {
      const atual = dadosRef.current;
      const r = await api.admin.contratos.assistente({
        modo,
        mensagens: historico.map((m) => ({ role: m.role, content: m.content })),
        campos: camposParaIa(modo),
        estado: estadoParaIa(atual, modo),
        perfis: presets
          .filter((p) => p.ativo)
          .map((p) => ({ id: p.id, nome: p.nome, criterios: p.criterios, valorMensal: p.dados.honorarios?.valorMensal ?? null })),
        contexto: { empresa: empresaNome || null, faixasMensalidade: TABELA_BASE, hoje: new Date().toISOString().slice(0, 10) },
      });

      // Perfil primeiro, depois os campos soltos; tudo passa pela validação do catálogo.
      let trabalho = atual;
      const preset = r.perfil_id ? presets.find((p) => p.id === r.perfil_id) : null;
      if (preset && modo === "contrato") trabalho = mesclarDados(trabalho, preset.dados);
      const { dados: novo, avisos } = aplicarAtualizacoes(trabalho, r.atualizacoes, modo);

      const mudancas: Mudanca[] = [];
      for (const def of CAMPOS) {
        const antes = lerCampo(atual, def.chave);
        const depois = lerCampo(novo, def.chave);
        if (JSON.stringify(antes) !== JSON.stringify(depois)) mudancas.push({ chave: def.chave, rotulo: def.rotulo, antes, depois });
      }
      if (mudancas.length) onAlterar(() => novo);
      setMsgs([
        ...historico,
        {
          role: "assistant",
          content: r.mensagem || (mudancas.length ? "Campos atualizados." : "Sem alterações."),
          mudancas,
          avisos,
          faltando: r.faltando,
          pronto: r.pronto,
        },
      ]);
    } catch (e) {
      setMsgs(historico);
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function desfazer(m: Mudanca, idxMsg: number) {
    onAlterar((d) => definirCampo(d, m.chave, m.antes));
    setMsgs((arr) => arr.map((x, i) => (i === idxMsg ? { ...x, mudancas: x.mudancas?.filter((c) => c.chave !== m.chave) } : x)));
  }

  function fmt(chave: string, v: string | number | boolean) {
    const def = campoDef(chave);
    return def ? fmtValor(def, v) : String(v);
  }

  return (
    <Card className="border-violet-300 print:hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" /> Assistente de {modo === "aditivo" ? "aditivo" : "contrato"}
        </CardTitle>
        <CardDescription>
          Descreva o caso; a IA preenche os campos e pergunta o que faltar. Ela não escreve cláusulas: o texto é sempre o do modelo, e dados pessoais (CPF, endereço) ficam só no cadastro.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-[320px] overflow-auto space-y-2 rounded-md border bg-muted/30 p-2 text-sm">
          {!msgs.length ? (
            <div className="space-y-1 text-muted-foreground">
              <p>Exemplos (clique para enviar):</p>
              {EXEMPLOS[modo].map((e) => (
                <button key={e} type="button" className="block w-full text-left rounded border bg-background px-2 py-1 hover:bg-muted" onClick={() => enviar(e)} disabled={desabilitado || enviando}>
                  {e}
                </button>
              ))}
            </div>
          ) : null}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : ""}>
              <div className={`inline-block max-w-[92%] rounded-md px-2 py-1 text-left whitespace-pre-wrap ${m.role === "user" ? "bg-violet-600 text-white" : "bg-background border"}`}>{m.content}</div>
              {m.mudancas?.length ? (
                <div className="mt-1 space-y-1">
                  {m.mudancas.map((c) => (
                    <div key={c.chave} className="flex flex-wrap items-center gap-1 text-xs">
                      <Badge variant="secondary" className="font-normal">
                        {c.rotulo}: {fmt(c.chave, c.antes)} → <b className="ml-1">{fmt(c.chave, c.depois)}</b>
                      </Badge>
                      {!desabilitado ? (
                        <button type="button" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground" onClick={() => desfazer(c, i)}>
                          <Undo2 className="h-3 w-3" /> desfazer
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {m.avisos?.length ? (
                <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">
                  {m.avisos.map((a, k) => (
                    <li key={k}>{a}</li>
                  ))}
                </ul>
              ) : null}
              {m.pronto ? <Badge className="mt-1 bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Pronto para revisar a prévia</Badge> : null}
            </div>
          ))}
          {enviando ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Pensando…
            </div>
          ) : null}
          <div ref={fimRef} />
        </div>
        <div className="flex gap-2">
          <Textarea
            rows={2}
            value={texto}
            placeholder={modo === "aditivo" ? "O que mudou no contrato?" : "Descreva o cliente e o que foi combinado…"}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            disabled={desabilitado || enviando}
          />
          <Button onClick={() => enviar()} disabled={desabilitado || enviando || !texto.trim()} title="Enviar (Enter)">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
