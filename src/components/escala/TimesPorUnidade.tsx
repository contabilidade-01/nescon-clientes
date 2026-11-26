import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { nomeDeUnidade } from "@/lib/escala/planejamento";
import { cn } from "@/lib/utils";

/** Destino de uma pessoa no quadro de times: uma unidade, "" (sem unidade) ou fora da escala. */
export const FORA = "__fora__";

export interface PessoaDoTime {
  id: string;
  nome: string;
  /** Unidade em que a pessoa está hoje ("" = sem unidade). */
  unidade: string;
  fora: boolean;
}

/**
 * Passo 1 da escala de empresa com mais de uma loja: montar os times de cada unidade.
 * Vale para todos os meses e alimenta a escala: a grade, os cenários e o PDF de cada
 * unidade saem só com o time dela; quem está "fora da escala" não entra.
 */
export function TimesPorUnidade({
  pessoas,
  unidades,
  aberto,
  onAbrir,
  onMover,
  onNovaUnidade,
  onMontar,
}: {
  pessoas: PessoaDoTime[];
  unidades: string[];
  aberto: boolean;
  onAbrir: (v: boolean) => void;
  onMover: (id: string, destino: string) => void;
  onNovaUnidade: (nome: string) => void;
  onMontar: (unidade: string) => void;
}) {
  const [nova, setNova] = useState("");
  const colunas: Array<{ chave: string; titulo: string; dica?: string }> = [
    ...unidades.map((u) => ({ chave: u, titulo: u })),
    { chave: "", titulo: "Sem unidade", dica: "Entram na escala, mas sem time." },
    { chave: FORA, titulo: "Fora da escala", dica: "Outra empresa, outro regime (12x36 de outra loja), afastado ou desligado." },
  ];
  const doGrupo = (chave: string) =>
    pessoas.filter((p) => (chave === FORA ? p.fora : !p.fora && p.unidade === chave)).sort((a, b) => a.nome.localeCompare(b.nome));
  const criar = () => {
    const n = nomeDeUnidade(nova);
    if (!n) return;
    onNovaUnidade(n);
    setNova("");
  };

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
        onClick={() => onAbrir(!aberto)}
        aria-expanded={aberto}
      >
        <Users className="h-4 w-4 text-primary" />
        <span className="font-semibold">1. Times por unidade</span>
        <span className="text-xs text-muted-foreground">monte o time de cada loja antes da escala; vale para todos os meses</span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {colunas.map((c) => (
            <Badge key={c.chave || "sem"} variant={c.chave === FORA ? "outline" : "secondary"} className="font-normal">
              {c.titulo}: {doGrupo(c.chave).length}
            </Badge>
          ))}
          {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      {aberto && (
        <div className="space-y-3 border-t p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-64"
              placeholder="Nova unidade (ex.: Terra Preta)"
              value={nova}
              maxLength={40}
              onChange={(e) => setNova(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              aria-label="Nova unidade"
            />
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={criar} disabled={!nomeDeUnidade(nova)}>
              <Plus className="h-3.5 w-3.5" /> Criar unidade
            </Button>
            <span className="text-xs text-muted-foreground">Para mudar alguém de time, escolha o destino ao lado do nome.</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {colunas.map((col) => {
              const lista = doGrupo(col.chave);
              const unidade = col.chave !== "" && col.chave !== FORA;
              return (
                <div key={col.chave || "sem"} className={cn("rounded-md border p-2", unidade ? "bg-primary/5" : "bg-muted/40")}>
                  <div className="mb-1 flex items-center gap-1">
                    <span className="text-sm font-semibold">{col.titulo}</span>
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                      {lista.length}
                    </Badge>
                    {unidade && (
                      <Button size="sm" className="ml-auto h-6 px-2 text-[11px]" onClick={() => onMontar(col.chave)} disabled={!lista.length}>
                        Montar escala
                      </Button>
                    )}
                  </div>
                  {col.dica && <p className="mb-1 text-[11px] text-muted-foreground">{col.dica}</p>}
                  <ul className="space-y-1">
                    {lista.map((p) => (
                      <li key={p.id} className="flex items-center gap-1 text-xs">
                        <span className="min-w-0 flex-1 truncate" title={p.nome}>
                          {p.nome}
                        </span>
                        <select
                          className="h-6 max-w-[9rem] rounded border bg-background px-1 text-[11px]"
                          value={p.fora ? FORA : p.unidade}
                          onChange={(e) => onMover(p.id, e.target.value)}
                          aria-label={`Time de ${p.nome}`}
                        >
                          {unidades.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                          <option value="">Sem unidade</option>
                          <option value={FORA}>Fora da escala</option>
                        </select>
                      </li>
                    ))}
                    {!lista.length && <li className="text-[11px] text-muted-foreground">Ninguém</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
