import { CheckCircle2, Shuffle, Sparkles, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ResultadoCenario } from "@/lib/escala/cenarios";
import type { Demanda } from "@/lib/escala/contingente";

const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];

function num(n: number, casas = 1) {
  return n.toFixed(casas).replace(".", ",").replace(/,0$/, "");
}

/**
 * Cenários prontos para o mês. Todos passam pelo motor de regras: os que cumprem a lei
 * podem ser aplicados; os outros mostram o motivo e ficam travados.
 */
export function PainelCenarios({
  cenarios,
  demanda,
  atual,
  onAplicar,
  onVariar,
}: {
  cenarios: ResultadoCenario[];
  demanda: Demanda;
  /** Id do cenário aplicado por último, se a escala ainda é ele. */
  atual?: string | null;
  onAplicar: (c: ResultadoCenario) => void;
  onVariar: () => void;
}) {
  const temDemanda = demanda.some((n) => n > 0);
  const validos = cenarios.filter((c) => c.podeAplicar);
  const travados = cenarios.filter((c) => !c.podeAplicar);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 font-semibold">
            <Sparkles className="h-4 w-4 text-primary" /> Cenários para o mês
          </h3>
          <p className="text-sm text-muted-foreground">
            {validos.length} de {cenarios.length} cumprem a lei neste mês. Aplique um e ajuste na grade; a grade não deixa sair da regra.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onVariar}>
          <Shuffle className="mr-1.5 h-4 w-4" /> Outra variação de folgas
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {validos.map((c) => (
          <CardCenario key={c.id} c={c} demanda={demanda} temDemanda={temDemanda} ativo={atual === c.id} onAplicar={() => onAplicar(c)} />
        ))}
      </div>

      {travados.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fora da regra neste mês</p>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {travados.map((c) => (
              <div key={c.id} className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm opacity-80">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="font-medium">{c.nome}</p>
                  <p className="text-xs text-muted-foreground">{c.motivos[0] || "Tem erro de regra neste mês."}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CardCenario({
  c,
  demanda,
  temDemanda,
  ativo,
  onAplicar,
}: {
  c: ResultadoCenario;
  demanda: Demanda;
  temDemanda: boolean;
  ativo: boolean;
  onAplicar: () => void;
}) {
  const max = Math.max(1, ...c.mediaPorDia, ...demanda);
  return (
    <Card className={cn("flex flex-col transition hover:shadow-md", ativo && "border-primary ring-2 ring-primary/30")}>
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="flex items-start justify-between gap-2 text-sm">
          <span>{c.nome}</span>
          {ativo ? <Badge>Em uso</Badge> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{c.descricao}</p>
      </CardHeader>
      <CardContent className="mt-auto space-y-3">
        <div className="flex h-16 items-end gap-1" aria-label="Pessoas por dia da semana">
          {c.mediaPorDia.map((m, i) => {
            const falta = temDemanda && m < demanda[i];
            return (
              <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
                <div className="relative flex h-12 w-full items-end">
                  {temDemanda && demanda[i] > 0 && (
                    <div className="absolute inset-x-0 border-t border-dashed border-foreground/40" style={{ bottom: `${(demanda[i] / max) * 100}%` }} />
                  )}
                  <div
                    className={cn("w-full rounded-t", falta ? "bg-destructive/70" : "bg-primary/70")}
                    style={{ height: `${Math.max(4, (m / max) * 100)}%` }}
                    title={`${num(m)} pessoa(s)`}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">{DIAS[i]}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant="secondary">{num(c.horasSemana)}h/semana por pessoa</Badge>
          <Badge variant="secondary">{num(c.domingosDeFolga)} domingo(s) de folga</Badge>
          {c.avisos > 0 && <Badge variant="outline">{c.avisos} aviso(s)</Badge>}
          {temDemanda && (
            <Badge variant={c.diasDescobertos ? "destructive" : "outline"}>
              {c.diasDescobertos ? `${c.diasDescobertos} dia(s) sem cobertura` : "Cobre a demanda"}
            </Badge>
          )}
        </div>
        <Button className="w-full" size="sm" variant={ativo ? "secondary" : "default"} onClick={onAplicar}>
          {ativo ? "Aplicar de novo (desfaz ajustes)" : "Usar este cenário"}
        </Button>
      </CardContent>
    </Card>
  );
}
