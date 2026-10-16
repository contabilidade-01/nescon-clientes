import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, RotateCcw, Shuffle, Sparkles, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ResultadoCenario } from "@/lib/escala/cenarios";
import type { Demanda } from "@/lib/escala/contingente";
import type { Turno } from "@/lib/escala/modelos";

const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
const DIAS_ABREV = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function num(n: number, casas = 1) {
  return n.toFixed(casas).replace(".", ",").replace(/,0$/, "");
}

/**
 * Cenários prontos para o mês. Todos passam pelo motor de regras: os que cumprem a lei
 * podem ser aplicados; os outros mostram o motivo e ficam travados. O horário de cada
 * cenário pode ser trocado; se o horário novo passar de algum limite, o cartão fica
 * vermelho e não aplica.
 */
export function PainelCenarios({
  cenarios,
  escalaAtual,
  demanda,
  emUso,
  onAplicar,
  onVariar,
  onHorario,
}: {
  cenarios: ResultadoCenario[];
  /** A escala que está na grade, medida com a mesma régua, para comparar. */
  escalaAtual?: ResultadoCenario;
  demanda: Demanda;
  /** Id do cenário aplicado por último, se a escala ainda é ele. */
  emUso?: string | null;
  onAplicar: (c: ResultadoCenario) => void;
  onVariar: () => void;
  /** Horário personalizado de um cenário; null volta ao padrão do modelo. */
  onHorario: (id: string, turno: Turno | null) => void;
}) {
  const temDemanda = demanda.some((n) => n > 0);
  // Cenário com horário personalizado continua na grade de cartões mesmo com erro, para o
  // cliente ver em vermelho o que passou e corrigir ali mesmo.
  const visiveis = cenarios.filter((c) => c.podeAplicar || (c.personalizado && !c.indisponivel));
  const travados = cenarios.filter((c) => !visiveis.includes(c));
  const validos = cenarios.filter((c) => c.podeAplicar).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 font-semibold">
            <Sparkles className="h-4 w-4 text-primary" /> Cenários para o mês
          </h3>
          <p className="text-sm text-muted-foreground">
            {validos} de {cenarios.length} cumprem a lei neste mês. Troque o horário de qualquer cenário; o que passar do limite fica em vermelho.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onVariar}>
          <Shuffle className="mr-1.5 h-4 w-4" /> Outra variação de folgas
        </Button>
      </div>

      {escalaAtual && escalaAtual.configs.length > 0 && (
        <EscalaAtual c={escalaAtual} demanda={demanda} temDemanda={temDemanda} />
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visiveis.map((c) => (
          <CardCenario
            key={c.id}
            c={c}
            demanda={demanda}
            temDemanda={temDemanda}
            ativo={emUso === c.id}
            comparar={escalaAtual?.configs.length ? escalaAtual.mediaPorDia : undefined}
            onAplicar={() => onAplicar(c)}
            onHorario={(t) => onHorario(c.id, t)}
          />
        ))}
      </div>

      {travados.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fora da regra neste mês</p>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {travados.map((c) => (
              <div key={c.id} className="flex items-start gap-2 rounded-lg border border-dashed border-destructive/40 p-3 text-sm">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{c.nome}</p>
                  <p className="text-xs text-destructive">{c.motivos[0] || "Tem erro de regra neste mês."}</p>
                  {!c.indisponivel && (
                    <EditorHorario turno={c.turno} personalizado={c.personalizado} onHorario={(t) => onHorario(c.id, t)} compacto />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Barras({ media, demanda, temDemanda }: { media: number[]; demanda: Demanda; temDemanda: boolean }) {
  const max = Math.max(1, ...media, ...demanda);
  return (
    <div className="flex h-16 items-end gap-1" aria-label="Pessoas por dia da semana">
      {media.map((m, i) => {
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
  );
}

/** Selos de horas: vermelho quando passa do limite, âmbar quando é hora extra/aviso. */
function SelosHoras({ c }: { c: ResultadoCenario }) {
  const semanaAcima = c.semanaAcima !== null;
  const semanaErro = c.semanaAcima === "erro";
  return (
    <>
      <Badge
        variant={semanaErro ? "destructive" : "secondary"}
        className={cn(semanaAcima && !semanaErro && "bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200")}
        title={`Semana mais carregada: ${num(c.maiorSemana)}h; limite ${c.limiteSemana}h`}
      >
        {semanaAcima ? `${num(c.maiorSemana)}h na semana (limite ${c.limiteSemana}h)` : `${num(c.horasSemana)}h/semana por pessoa`}
      </Badge>
      {c.horasDia > 8 && c.modelo !== "12x36" && (
        <Badge variant={c.horasDia > 10 ? "destructive" : "outline"} className={cn(c.horasDia <= 10 && "border-amber-500 text-amber-700")}>
          {num(c.horasDia)}h por dia
        </Badge>
      )}
    </>
  );
}

function EscalaAtual({ c, demanda, temDemanda }: { c: ResultadoCenario; demanda: Demanda; temDemanda: boolean }) {
  return (
    <Card className={cn("border-dashed", c.erros > 0 && "border-destructive")}>
      <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_260px] md:items-center">
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            {c.erros ? <XCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            Escala de hoje, para comparar
          </p>
          <p className="text-xs text-muted-foreground">{c.descricao}</p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <SelosHoras c={c} />
            <Badge variant="secondary">{num(c.domingosDeFolga)} domingo(s) de folga</Badge>
            {c.erros > 0 && <Badge variant="destructive">{c.erros} erro(s) neste mês</Badge>}
          </div>
          {c.erros > 0 && <p className="text-xs text-destructive">{c.motivos[0]}</p>}
        </div>
        <Barras media={c.mediaPorDia} demanda={demanda} temDemanda={temDemanda} />
      </CardContent>
    </Card>
  );
}

function CardCenario({
  c,
  demanda,
  temDemanda,
  ativo,
  comparar,
  onAplicar,
  onHorario,
}: {
  c: ResultadoCenario;
  demanda: Demanda;
  temDemanda: boolean;
  ativo: boolean;
  comparar?: number[];
  onAplicar: () => void;
  onHorario: (t: Turno | null) => void;
}) {
  const diferencas = comparar
    ? c.mediaPorDia
        .map((m, i) => ({ dia: DIAS_ABREV[i], d: m - comparar[i] }))
        .filter((x) => Math.abs(x.d) >= 0.5)
    : [];
  const vermelho = !c.podeAplicar;
  return (
    <Card
      className={cn(
        "flex flex-col transition hover:shadow-md",
        ativo && "border-primary ring-2 ring-primary/30",
        vermelho && "border-destructive bg-destructive/5",
      )}
    >
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="flex items-start justify-between gap-2 text-sm">
          <span>{c.nome}</span>
          {ativo ? (
            <Badge>Em uso</Badge>
          ) : vermelho ? (
            <XCircle className="h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{c.descricao}</p>
      </CardHeader>
      <CardContent className="mt-auto space-y-3">
        <Barras media={c.mediaPorDia} demanda={demanda} temDemanda={temDemanda} />
        {diferencas.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Contra a escala de hoje:{" "}
            {diferencas.map((x, i) => (
              <span key={x.dia} className={cn(x.d < 0 ? "font-medium text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
                {i > 0 && ", "}
                {x.dia} {x.d > 0 ? "+" : "−"}
                {num(Math.abs(x.d))}
              </span>
            ))}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5 text-xs">
          <SelosHoras c={c} />
          <Badge variant="secondary">{num(c.domingosDeFolga)} domingo(s) de folga</Badge>
          {c.avisos > 0 && (
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              <AlertTriangle className="mr-1 h-3 w-3" /> {c.avisos} aviso(s)
            </Badge>
          )}
          {temDemanda && (
            <Badge variant={c.diasDescobertos ? "destructive" : "outline"}>
              {c.diasDescobertos ? `${c.diasDescobertos} dia(s) sem cobertura` : "Cobre a demanda"}
            </Badge>
          )}
        </div>
        {vermelho && (
          <ul className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {c.motivos.map((m) => (
              <li key={m} className="flex gap-1">
                <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> {m}
              </li>
            ))}
          </ul>
        )}
        <EditorHorario turno={c.turno} personalizado={c.personalizado} onHorario={onHorario} />
        <Button className="w-full" size="sm" variant={ativo ? "secondary" : "default"} onClick={onAplicar} disabled={vermelho}>
          {vermelho ? "Fora do limite: ajuste o horário" : ativo ? "Aplicar de novo (desfaz ajustes)" : "Usar este cenário"}
        </Button>
      </CardContent>
    </Card>
  );
}

function EditorHorario({
  turno,
  personalizado,
  onHorario,
  compacto,
}: {
  turno: Turno;
  personalizado: boolean;
  onHorario: (t: Turno | null) => void;
  compacto?: boolean;
}) {
  const [aberto, setAberto] = useState(personalizado);
  if (!aberto) {
    return (
      <button type="button" className="flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setAberto(true)}>
        <Clock className="h-3 w-3" /> {turno.entrada}–{turno.saida}, intervalo {turno.intervaloMin}min · personalizar horário
      </button>
    );
  }
  const campo = "h-7 rounded border bg-background px-1 text-xs";
  return (
    <div className={cn("flex flex-wrap items-center gap-1 rounded-md bg-muted/50 p-1.5", compacto && "mt-1.5")}>
      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
      <input type="time" className={campo} value={turno.entrada} onChange={(e) => e.target.value && onHorario({ ...turno, entrada: e.target.value })} aria-label="Entrada do cenário" />
      <span className="text-xs">às</span>
      <input type="time" className={campo} value={turno.saida} onChange={(e) => e.target.value && onHorario({ ...turno, saida: e.target.value })} aria-label="Saída do cenário" />
      <input
        type="number"
        min={0}
        step={15}
        className={cn(campo, "w-14")}
        value={turno.intervaloMin}
        onChange={(e) => onHorario({ ...turno, intervaloMin: Math.max(0, Number(e.target.value) || 0) })}
        aria-label="Intervalo do cenário em minutos"
        title="Intervalo (min)"
      />
      <span className="text-xs text-muted-foreground">min</span>
      {personalizado && (
        <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => onHorario(null)} aria-label="Voltar ao horário padrão" title="Voltar ao horário padrão">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
