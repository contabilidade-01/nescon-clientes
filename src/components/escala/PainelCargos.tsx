import { useMemo, useState } from "react";
import { BriefcaseBusiness, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CARGOS_SUGERIDOS, cargosEmUso, chaveDoCargo, nomeDeCargo } from "@/lib/escala/cargos";
import type { Demanda } from "@/lib/escala/contingente";
import type { Segmento } from "@/lib/escala/regras";
import { cn } from "@/lib/utils";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export interface PessoaDoCargo {
  id: string;
  nome: string;
  cargo?: string;
  unidade?: string;
}

/**
 * Cargos na escala: o cargo de cada pessoa (vem do cadastro da folha; aqui a empresa troca)
 * e, se quiser, o mínimo de cada cargo por dia da semana. Vale para todos os meses. A grade,
 * a semana e o PDF mostram quantos de cada cargo trabalham e avisam o dia abaixo do mínimo.
 */
export function PainelCargos({
  pessoas,
  segmento,
  minimoPorCargo,
  aberto,
  onAbrir,
  onCargo,
  onMinimo,
}: {
  pessoas: PessoaDoCargo[];
  segmento: Segmento;
  minimoPorCargo: Record<string, Demanda>;
  aberto: boolean;
  onAbrir: (v: boolean) => void;
  onCargo: (id: string, cargo: string | undefined) => void;
  onMinimo: (cargo: string, minimo: Demanda | null) => void;
}) {
  const emUso = useMemo(() => cargosEmUso(pessoas, minimoPorCargo), [pessoas, minimoPorCargo]);
  const sugestoes = useMemo(() => {
    const vistos = new Set(emUso.map(chaveDoCargo));
    return [...emUso, ...CARGOS_SUGERIDOS[segmento].filter((c) => !vistos.has(chaveDoCargo(c)))];
  }, [emUso, segmento]);
  const semCargo = pessoas.filter((p) => !p.cargo).length;
  const [novo, setNovo] = useState("");
  const minimoDe = (cargo: string) => Object.entries(minimoPorCargo).find(([c]) => chaveDoCargo(c) === chaveDoCargo(cargo));
  const ordenadas = [...pessoas].sort((a, b) => (a.unidade || "~").localeCompare(b.unidade || "~") || a.nome.localeCompare(b.nome));

  function adicionarMinimo() {
    const n = nomeDeCargo(novo);
    if (!n) return;
    if (!minimoDe(n)) onMinimo(n, [1, 1, 1, 1, 1, 1, 1]);
    setNovo("");
  }

  return (
    <Card className="overflow-hidden">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left" onClick={() => onAbrir(!aberto)} aria-expanded={aberto}>
        <BriefcaseBusiness className="h-4 w-4 text-primary" />
        <span className="font-semibold">2. Cargos</span>
        <span className="text-xs text-muted-foreground">cargo de cada pessoa e quantos de cada cargo a casa precisa por dia</span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {emUso.slice(0, 6).map((c) => (
            <Badge key={c} variant="secondary" className="font-normal">
              {c}: {pessoas.filter((p) => p.cargo && chaveDoCargo(p.cargo) === chaveDoCargo(c)).length}
            </Badge>
          ))}
          {semCargo > 0 && (
            <Badge variant="outline" className="font-normal">
              Sem cargo: {semCargo}
            </Badge>
          )}
          {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      {aberto && (
        <div className="grid gap-4 border-t p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <datalist id="cargos-sugeridos">
            {sugestoes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Cargo de cada pessoa</h4>
            <p className="text-xs text-muted-foreground">Vem do cadastro da folha. Para trocar, escreva ou escolha na lista.</p>
            <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
              {ordenadas.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate" title={p.nome}>
                    {p.nome}
                    {p.unidade && <span className="ml-1 text-[10px] text-muted-foreground">· {p.unidade}</span>}
                  </span>
                  <Input
                    key={`${p.id}-${p.cargo ?? ""}`}
                    className="h-7 w-44 text-xs"
                    list="cargos-sugeridos"
                    defaultValue={p.cargo ?? ""}
                    placeholder="Sem cargo"
                    maxLength={40}
                    aria-label={`Cargo de ${p.nome}`}
                    onBlur={(e) => {
                      const v = nomeDeCargo(e.target.value);
                      if (v !== p.cargo) onCargo(p.id, v);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Mínimo de cada cargo por dia</h4>
            <p className="text-xs text-muted-foreground">
              Ex.: 1 cozinheiro e 2 garçons todo dia. A escala avisa o dia que ficar abaixo (não é regra da lei, é a necessidade da casa).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="p-1 text-left font-medium">Cargo</th>
                    {DIAS.map((d) => (
                      <th key={d} className="p-1 text-center font-medium">
                        {d}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {emUso.map((cargo) => {
                    const m = minimoDe(cargo);
                    const valores: Demanda = m ? m[1] : [0, 0, 0, 0, 0, 0, 0];
                    const chave = m ? m[0] : cargo;
                    return (
                      <tr key={cargo} className={cn("border-t", !m && "text-muted-foreground")}>
                        <td className="max-w-[140px] truncate p-1 font-medium" title={cargo}>
                          {cargo}
                        </td>
                        {valores.map((v, i) => (
                          <td key={i} className="p-0.5">
                            <Input
                              type="number"
                              min={0}
                              max={99}
                              className="h-7 w-11 px-1 text-center text-xs"
                              value={v}
                              aria-label={`Mínimo de ${cargo} em ${DIAS[i]}`}
                              onChange={(e) => {
                                const novoValor = [...valores] as Demanda;
                                novoValor[i] = Math.max(0, Math.min(99, Math.floor(Number(e.target.value) || 0)));
                                onMinimo(chave, novoValor.some((n) => n > 0) ? novoValor : null);
                              }}
                            />
                          </td>
                        ))}
                        <td className="p-0.5">
                          {m && (
                            <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => onMinimo(chave, null)} aria-label={`Tirar o mínimo de ${cargo}`}>
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!emUso.length && (
                    <tr>
                      <td colSpan={9} className="p-2 text-muted-foreground">
                        Ninguém tem cargo ainda. Marque o cargo das pessoas ao lado, ou adicione um cargo aqui.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-56 text-xs"
                list="cargos-sugeridos"
                placeholder="Outro cargo (ex.: Cozinheiro)"
                value={novo}
                maxLength={40}
                onChange={(e) => setNovo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && adicionarMinimo()}
                aria-label="Novo cargo"
              />
              <Button size="sm" variant="outline" className="h-8 gap-1" onClick={adicionarMinimo} disabled={!nomeDeCargo(novo)}>
                <Plus className="h-3.5 w-3.5" /> Adicionar cargo
              </Button>
            </div>
          </section>
        </div>
      )}
    </Card>
  );
}
