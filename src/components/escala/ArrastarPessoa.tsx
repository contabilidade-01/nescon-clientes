import type { ReactNode } from "react";
import { useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { FORA } from "@/components/escala/TimesPorUnidade";

/**
 * Arrastar a PESSOA (não o dia) para outra unidade, nas grades da escala (simples e
 * avançada). O nome tem um pegador; enquanto ele é arrastado, aparece embaixo da tela uma
 * barra com as unidades para soltar (vale também com a grade filtrada numa unidade só), e as
 * faixas de unidade da grade também aceitam soltar. Mudar a unidade é o mesmo que escolher
 * o destino em "Times por unidade".
 */

const PREFIXO_PESSOA = "pessoa:";
const PREFIXO_UNIDADE = "unidade:";

export function ehArrasteDePessoa(id: unknown): boolean {
  return String(id).startsWith(PREFIXO_PESSOA);
}

/** Pessoa e unidade de destino de um arraste de pessoa; null se não for um (ou se soltou fora). */
export function destinoDoArraste(e: DragEndEvent): { pessoa: string; destino: string } | null {
  const a = String(e.active.id);
  if (!a.startsWith(PREFIXO_PESSOA) || !e.over) return null;
  const o = String(e.over.id);
  if (!o.startsWith(PREFIXO_UNIDADE)) return null;
  // O alvo pode levar um sufixo "|<algo>" para ser único (uma faixa por grade).
  return { pessoa: a.slice(PREFIXO_PESSOA.length), destino: o.slice(PREFIXO_UNIDADE.length).split("|")[0] };
}

export function PegadorPessoa({ id, nome }: { id: string; nome: string }) {
  const drag = useDraggable({ id: `${PREFIXO_PESSOA}${id}` });
  const estilo = drag.transform ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)`, zIndex: 40 } : undefined;
  return (
    <span
      ref={drag.setNodeRef}
      style={estilo}
      {...drag.listeners}
      data-sem-pan
      title={`Arraste ${nome} para outra unidade`}
      aria-label={`Arrastar ${nome} para outra unidade`}
      className={cn(
        "inline-flex shrink-0 cursor-grab touch-none items-center rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground active:cursor-grabbing",
        drag.isDragging && "bg-background text-primary shadow-lg ring-1 ring-primary",
      )}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </span>
  );
}

/** Faixa (ou qualquer área) que recebe a pessoa arrastada e a põe na unidade `chave`. */
export function AlvoUnidade({ chave, sufixo, className, children }: { chave: string; sufixo: string; className?: string; children: ReactNode }) {
  const drop = useDroppable({ id: `${PREFIXO_UNIDADE}${chave}|${sufixo}` });
  return (
    <div ref={drop.setNodeRef} className={cn(className, drop.isOver && "rounded bg-primary/20 ring-2 ring-primary")}>
      {children}
    </div>
  );
}

/** Barra fixa embaixo da tela, só enquanto uma pessoa é arrastada: uma caixa por destino. */
export function BarraDeUnidades({ ativa, unidades, atual }: { ativa: boolean; unidades: string[]; atual?: string }) {
  if (!ativa) return null;
  const destinos = [...unidades.map((u) => ({ chave: u, nome: u })), { chave: "", nome: "Sem unidade" }, { chave: FORA, nome: "Fora da escala" }];
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-xl backdrop-blur">
        <span className="px-1 text-xs font-medium text-muted-foreground">Soltar em:</span>
        {destinos.map((d) => (
          <AlvoUnidade
            key={d.chave || "sem"}
            chave={d.chave}
            sufixo="barra"
            className={cn(
              "rounded border border-dashed px-3 py-2 text-sm",
              d.chave === FORA ? "text-muted-foreground" : "border-primary/50",
              d.chave === (atual ?? "") && "opacity-50",
            )}
          >
            {d.nome}
          </AlvoUnidade>
        ))}
      </div>
    </div>
  );
}
