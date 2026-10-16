import { useState } from "react";
import { CalendarCheck, Layers, RotateCcw, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Turno } from "@/lib/escala/modelos";
import { MODELOS, configPadrao, type AcaoDia, type ConfigPessoa, type ModeloChave } from "@/lib/escala/planejamento";

export type AtalhoDias = "todos" | "uteis" | "sabados" | "domingos" | "limpar";

const campo = "h-8 rounded border bg-background px-1.5 text-xs";

/**
 * Barra da edição em lote: diz quantas pessoas e quantos dias estão marcados e aplica,
 * de uma vez, folga, horário ou modelo. A conferência das regras é do planejador.
 */
export function BarraLote({
  pessoas,
  totalPessoas,
  dias,
  repousos,
  onAtalho,
  onLimparPessoas,
  onDias,
  onPessoas,
}: {
  pessoas: number;
  totalPessoas: number;
  dias: number;
  repousos: number;
  onAtalho: (a: AtalhoDias) => void;
  onLimparPessoas: () => void;
  onDias: (acao: AcaoDia) => void;
  onPessoas: (patch: Partial<ConfigPessoa>) => void;
}) {
  const [turno, setTurno] = useState<Turno>({ entrada: "08:00", saida: "17:00", intervaloMin: 60 });
  const [modelo, setModelo] = useState<ModeloChave | "">("");
  const alvoPessoas = pessoas || totalPessoas;
  return (
    <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Layers className="h-4 w-4 text-primary" />
        <span className="font-medium">Edição em lote</span>
        <span className="text-xs text-muted-foreground">
          Marque pessoas na caixa ao lado do nome e dias clicando no cabeçalho do dia. Sem pessoa marcada, vale para todos.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-full bg-background px-2 py-1 text-xs">
          <Users className="h-3.5 w-3.5" /> {pessoas ? `${pessoas} pessoa(s)` : `Todos (${totalPessoas})`}
          {pessoas > 0 && (
            <button type="button" onClick={onLimparPessoas} aria-label="Desmarcar pessoas" className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
        <span className="flex items-center gap-1 rounded-full bg-background px-2 py-1 text-xs">
          <CalendarCheck className="h-3.5 w-3.5" /> {dias} dia(s)
        </span>
        <span className="text-xs text-muted-foreground">Marcar:</span>
        {(
          [
            ["todos", "Mês todo"],
            ["uteis", "Seg a sex"],
            ["sabados", "Sábados"],
            ["domingos", "Domingos"],
            ["limpar", "Limpar dias"],
          ] as Array<[AtalhoDias, string]>
        ).map(([a, r]) => (
          <Button key={a} size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onAtalho(a)}>
            {r}
          </Button>
        ))}
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <div className={cn("flex flex-wrap items-center gap-1.5 rounded-lg border bg-background p-2", !dias && "opacity-60")}>
          <span className="text-xs font-medium">Nos {dias || "—"} dia(s) marcados:</span>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!dias} onClick={() => onDias({ tipo: "folga" })}>
            Dar folga
          </Button>
          <input type="time" className={campo} value={turno.entrada} onChange={(e) => e.target.value && setTurno({ ...turno, entrada: e.target.value })} aria-label="Entrada em lote" />
          <span className="text-xs">às</span>
          <input type="time" className={campo} value={turno.saida} onChange={(e) => e.target.value && setTurno({ ...turno, saida: e.target.value })} aria-label="Saída em lote" />
          <input
            type="number"
            min={0}
            step={15}
            className={cn(campo, "w-14")}
            value={turno.intervaloMin}
            onChange={(e) => setTurno({ ...turno, intervaloMin: Math.max(0, Number(e.target.value) || 0) })}
            aria-label="Intervalo em lote"
            title="Intervalo (min)"
          />
          <Button size="sm" className="h-8 text-xs" disabled={!dias} onClick={() => onDias({ tipo: "horario", turno })}>
            Aplicar horário
          </Button>
          <span className="w-full text-[11px] text-muted-foreground">O horário muda só nos dias trabalhados; folga continua folga.</span>
          <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={!dias} onClick={() => onDias({ tipo: "modelo" })}>
            <RotateCcw className="mr-1 h-3 w-3" /> Voltar ao modelo
          </Button>
        </div>

        <div className={cn("flex flex-wrap items-center gap-1.5 rounded-lg border bg-background p-2", !pessoas && "opacity-60")}>
          <span className="text-xs font-medium">Nas {pessoas || "—"} pessoa(s) marcadas, o mês todo:</span>
          <select className={campo} value={modelo} onChange={(e) => setModelo(e.target.value as ModeloChave)} aria-label="Modelo em lote">
            <option value="">Manter modelo</option>
            {(Object.keys(MODELOS) as ModeloChave[]).map((m) => (
              <option key={m} value={m} disabled={m === "6x1" && repousos > 1}>
                {MODELOS[m]}
                {m === "6x1" && repousos > 1 ? " (proibida)" : ""}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={!pessoas}
            onClick={() => {
              if (!modelo) return onPessoas({ entrada: turno.entrada, saida: turno.saida, intervaloMin: turno.intervaloMin });
              const p = configPadrao("x", "x", modelo);
              onPessoas({ modelo, entrada: p.entrada, saida: p.saida, intervaloMin: p.intervaloMin });
            }}
          >
            {modelo ? `Trocar para ${MODELOS[modelo]}` : "Usar o horário acima como padrão"}
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {alvoPessoas} pessoa(s) entram na conta. Quem ficaria fora da regra (folgas, domingo, jornada) é deixado como estava, e o sistema avisa quem foi.
      </p>
    </div>
  );
}
