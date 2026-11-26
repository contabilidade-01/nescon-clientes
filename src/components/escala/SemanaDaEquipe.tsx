import { Fragment, useMemo, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { diaDaSemana } from "@/lib/escala/datas";
import type { Turno } from "@/lib/escala/modelos";
import type { AvaliacaoPessoa } from "@/lib/escala/planejamento";
import { AlvoUnidade, BarraDeUnidades, PegadorPessoa, ehArrasteDePessoa } from "@/components/escala/ArrastarPessoa";

const DIAS_LETRA = ["D", "S", "T", "Q", "Q", "S", "S"];
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function hora(hhmm: string) {
  return hhmm.endsWith(":00") ? `${Number(hhmm.slice(0, 2))}h` : hhmm;
}

function fmtHoras(h: number) {
  const min = Math.round(h * 60);
  const m = min % 60;
  return m ? `${Math.floor(min / 60)}h${String(m).padStart(2, "0")}` : `${Math.floor(min / 60)}h`;
}

/** Semana que abre a tela: a de hoje, se cair no mês; senão a última semana inteira do mês. */
function semanaInicial(semanas: string[][], mes: string): number {
  const hoje = new Date().toISOString().slice(0, 10);
  const deHoje = semanas.findIndex((s) => s.includes(hoje) && hoje.startsWith(mes));
  if (deHoje >= 0) return deHoje;
  for (let i = semanas.length - 1; i >= 0; i--) if (semanas[i].every((d) => d.startsWith(mes))) return i;
  return 0;
}

/**
 * A semana da equipe no modo simples: anda semana a semana pelo mês (inclusive a semana
 * cortada pelo mês, com os dias do mês vizinho, que é como a lei conta), mostra as horas e
 * as folgas de cada pessoa contra a regra da semana e deixa arrastar um dia sobre outro
 * (mesma pessoa move a folga; outra pessoa troca o turno), com a mesma trava da grade.
 */
export function SemanaDaEquipe({
  mes,
  linhas,
  onTrocar,
  unidades,
  onAbrirPessoa,
}: {
  mes: string;
  linhas: AvaliacaoPessoa[];
  onTrocar?: (e: DragEndEvent) => void;
  /** Com as unidades, o nome ganha um pegador para levar a pessoa a outra unidade. */
  unidades?: string[];
  onAbrirPessoa?: (id: string) => void;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const moverPessoa = Boolean(onTrocar && unidades);
  const semanas = useMemo(() => {
    const dias = linhas[0]?.diasComVizinhos.map((d) => d.data) ?? [];
    const out: string[][] = [];
    for (let i = 0; i + 7 <= dias.length; i += 7) out.push(dias.slice(i, i + 7));
    return out;
  }, [linhas]);
  const [escolhida, setEscolhida] = useState<{ mes: string; i: number } | null>(null);
  const idx = escolhida && escolhida.mes === mes && escolhida.i < semanas.length ? escolhida.i : semanaInicial(semanas, mes);
  const ir = (i: number) => setEscolhida({ mes, i: Math.max(0, Math.min(semanas.length - 1, i)) });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const semana = semanas[idx];
  if (!semana) return null;
  const regra = linhas.find((l) => l.config.modelo !== "12x36")?.semanasInteiras.find((s) => s.inicio === semana[0]);
  const cortada = semana.some((d) => !d.startsWith(mes));

  return (
    <Card>
      <CardHeader className="space-y-2 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">
            Semana de {ddmm(semana[0])} a {ddmm(semana[6])}
          </CardTitle>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => ir(idx - 1)} disabled={idx === 0} aria-label="Semana anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {semanas.map((s, i) => (
              <Button
                key={s[0]}
                size="sm"
                variant={i === idx ? "default" : "outline"}
                className="h-8 px-2 text-xs"
                onClick={() => ir(i)}
                aria-label={`Semana de ${ddmm(s[0])} a ${ddmm(s[6])}`}
                aria-pressed={i === idx}
              >
                {s[0].slice(8)}–{s[6].slice(8)}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2"
              onClick={() => ir(idx + 1)}
              disabled={idx === semanas.length - 1}
              aria-label="Próxima semana"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {regra && (
            <>
              Regra desta semana: até <span className="font-medium text-foreground">{regra.limiteHoras}h</span> e{" "}
              <span className="font-medium text-foreground">
                {regra.repousosExigidos} folga
                {regra.repousosExigidos === 1 ? "" : "s"}
              </span>{" "}
              por pessoa ({regra.vigencia}).{" "}
            </>
          )}
          {cortada && "A semana passa da virada do mês: os dias do outro mês aparecem apagados e entram na conta, como a lei manda. "}
          {onTrocar && "Arraste um dia sobre outro para trocar (na mesma pessoa, move a folga). "}
          {onTrocar && unidades && "Para levar alguém a outra unidade, arraste pelo pegador ao lado do nome."}
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setArrastando(ehArrasteDePessoa(e.active.id) ? String(e.active.id).slice(7) : null)}
          onDragCancel={() => setArrastando(null)}
          onDragEnd={(e) => {
            setArrastando(null);
            onTrocar?.(e);
          }}
        >
          {moverPessoa && (
            <BarraDeUnidades
              ativa={Boolean(arrastando)}
              unidades={unidades ?? []}
              atual={linhas.find((l) => l.config.id === arrastando)?.config.unidade}
            />
          )}
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="border-b">
                <th className="p-2 text-left font-medium">Pessoa</th>
                {semana.map((d) => (
                  <th key={d} className={cn("p-1 text-center font-medium", !d.startsWith(mes) && "text-muted-foreground/60")}>
                    {DIAS_LETRA[diaDaSemana(d)]}
                    <span className="block font-normal text-muted-foreground">{d.slice(8)}</span>
                  </th>
                ))}
                <th className="p-1 text-right font-medium">Na semana</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => {
                const unidade = l.config.unidade || "";
                const novaUnidade = i === 0 || (linhas[i - 1].config.unidade || "") !== unidade;
                const s = l.semanasInteiras.find((x) => x.inicio === semana[0]);
                const doze = l.config.modelo === "12x36";
                const acima = !doze && s && s.horas > s.limiteHoras + 1e-9;
                const faltaFolga = !doze && s && s.folgas < s.repousosExigidos;
                return (
                  <Fragment key={l.config.id}>
                    {novaUnidade && linhas.some((x) => x.config.unidade) && (
                      <tr className="border-b bg-muted/50">
                        <td colSpan={9} className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {moverPessoa ? (
                            <AlvoUnidade chave={unidade} sufixo="semana" className="px-1">
                              {unidade || "Sem unidade"}
                            </AlvoUnidade>
                          ) : (
                            unidade || "Sem unidade"
                          )}
                        </td>
                      </tr>
                    )}
                    <tr className="border-b last:border-0">
                      <td className="max-w-[130px] p-2 font-medium sm:max-w-[220px]">
                        <span className="flex min-w-0 items-center gap-1">
                          {moverPessoa && <PegadorPessoa id={l.config.id} nome={l.config.nome} />}
                          <button
                            type="button"
                            className="block min-w-0 flex-1 truncate text-left hover:underline"
                            onClick={() => onAbrirPessoa?.(l.config.id)}
                          >
                            {l.config.nome}
                          </button>
                        </span>
                      </td>
                      {semana.map((d) => (
                        <CelulaDia
                          key={d}
                          id={`${l.config.id}|${d}`}
                          turno={l.diasComVizinhos.find((x) => x.data === d)?.turno ?? null}
                          doMes={d.startsWith(mes)}
                          arrastavel={Boolean(onTrocar)}
                          gravidade={l.porDia.get(d)}
                        />
                      ))}
                      <td className="whitespace-nowrap p-1 text-right tabular-nums">
                        {s ? (
                          <>
                            <span className={cn(acima && "font-semibold text-destructive")}>
                              {fmtHoras(s.horas)}
                              {!doze && <span className="text-muted-foreground"> de {s.limiteHoras}h</span>}
                            </span>
                            <span className={cn("block text-[11px] text-muted-foreground", faltaFolga && "font-semibold text-destructive")}>
                              {doze ? "12x36: conta a média" : `${s.folgas} folga${s.folgas === 1 ? "" : "s"}`}
                            </span>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </DndContext>
      </CardContent>
    </Card>
  );
}

function CelulaDia({
  id,
  turno,
  doMes,
  arrastavel,
  gravidade,
}: {
  id: string;
  turno: Turno | null;
  doMes: boolean;
  arrastavel: boolean;
  gravidade?: "erro" | "atencao";
}) {
  // Dia do mês vizinho: só mostra (é outro mês salvo), não arrasta.
  const ativo = doMes && arrastavel;
  const drag = useDraggable({ id, disabled: !ativo });
  const drop = useDroppable({ id, disabled: !ativo });
  const estilo = drag.transform
    ? {
        transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)`,
        zIndex: 20,
      }
    : undefined;
  return (
    <td ref={drop.setNodeRef} className={cn("p-0.5 text-center", drop.isOver && "bg-primary/10")}>
      <span
        ref={drag.setNodeRef}
        style={estilo}
        {...(ativo ? drag.listeners : {})}
        {...(ativo ? drag.attributes : {})}
        title={doMes ? (turno ? `${turno.entrada}–${turno.saida}` : "Folga") : "Dia do mês vizinho"}
        className={cn(
          "relative block rounded px-0.5 py-1 tabular-nums leading-tight",
          turno ? "bg-primary/10" : "bg-muted font-semibold text-muted-foreground",
          ativo && "cursor-grab touch-none active:cursor-grabbing",
          !doMes && "opacity-40",
          gravidade === "erro" && "bg-destructive/15 text-destructive ring-1 ring-destructive",
          gravidade === "atencao" && "ring-1 ring-amber-500",
          drag.isDragging && "opacity-70 shadow-lg",
        )}
      >
        {ativo && <GripVertical className="absolute left-0 top-1/2 hidden h-3 w-3 -translate-y-1/2 text-muted-foreground/50 sm:block" />}
        {turno ? (
          <>
            {hora(turno.entrada)}
            <span className="block">{hora(turno.saida)}</span>
          </>
        ) : (
          "Folga"
        )}
      </span>
    </td>
  );
}
