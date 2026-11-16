import { useState } from "react";
import { AlertTriangle, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ControlesPessoa } from "@/components/escala/ControlesPessoa";
import { CalendarioPessoa } from "@/components/escala/PainelPorPessoa";
import { cn } from "@/lib/utils";
import { diaDaSemana } from "@/lib/escala/datas";
import type { Turno } from "@/lib/escala/modelos";
import { agruparOcorrencias } from "@/lib/escala/ocorrencias";
import { MODELOS, type AcaoDia, type Ajustes, type AvaliacaoPessoa, type ConfigPessoa } from "@/lib/escala/planejamento";

const LETRAS = ["D", "S", "T", "Q", "Q", "S", "S"];
const NOMES_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function ddmm(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function num(n: number) {
  return n.toFixed(1).replace(".", ",");
}

function CamposTurno({ t, onChange, rotulo }: { t: Turno; onChange: (t: Turno) => void; rotulo: string }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="space-y-1">
        <Label className="text-xs">Entrada</Label>
        <Input type="time" value={t.entrada} onChange={(e) => e.target.value && onChange({ ...t, entrada: e.target.value })} aria-label={`Entrada ${rotulo}`} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Saída</Label>
        <Input type="time" value={t.saida} onChange={(e) => e.target.value && onChange({ ...t, saida: e.target.value })} aria-label={`Saída ${rotulo}`} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Intervalo (min)</Label>
        <Input
          type="number"
          min={0}
          step={15}
          value={t.intervaloMin}
          onChange={(e) => onChange({ ...t, intervaloMin: Math.max(0, Number(e.target.value) || 0) })}
          aria-label={`Intervalo ${rotulo}`}
        />
      </div>
    </div>
  );
}

/**
 * Caixa de um funcionário: tudo da escala só dele num lugar (modelo, horário padrão,
 * horário diferente em alguns dias da semana, um dia solto pelo calendário, desfazer os
 * ajustes). Toda mudança passa pela trava do planejador: `onChange` e `onDias` devolvem
 * false quando a regra recusa.
 */
export function DialogoPessoa({
  linha,
  mes,
  ajustes,
  feriados,
  feriadosSet,
  repousos,
  viradaEm,
  onChange,
  onDias,
  onFechar,
}: {
  linha: AvaliacaoPessoa;
  mes: string;
  ajustes: Ajustes;
  feriados: Map<string, string>;
  feriadosSet: Set<string>;
  repousos: number;
  viradaEm?: string;
  onChange: (patch: Partial<ConfigPessoa>) => boolean;
  onDias: (datas: string[], acao: AcaoDia) => boolean;
  onFechar: () => void;
}) {
  const c = linha.config;
  const padrao: Turno = { entrada: c.entrada, saida: c.saida, intervaloMin: c.intervaloMin };
  const [semana, setSemana] = useState<Set<number>>(new Set());
  const [acao, setAcao] = useState<"horario" | "folga" | "modelo">("horario");
  const [turnoSemana, setTurnoSemana] = useState<Turno>(padrao);
  const [dia, setDia] = useState<string | null>(null);
  const [folgaDia, setFolgaDia] = useState(false);
  const [turnoDia, setTurnoDia] = useState<Turno>(padrao);

  const meus = ajustes[c.id] || {};
  const ajustados = Object.keys(meus).filter((d) => d.startsWith(mes)).sort();
  const erros = linha.ocorrencias.filter((o) => o.gravidade === "erro").length;
  const grupos = agruparOcorrencias(linha.ocorrencias);

  const datasDaSemana = linha.dias.filter((d) => semana.has(diaDaSemana(d.data)));
  // Horário diferente mexe só nos dias em que a pessoa trabalha: folga continua folga.
  const alvo = acao === "horario" ? datasDaSemana.filter((d) => d.turno) : datasDaSemana;

  function escolherDia(data: string) {
    const t = linha.dias.find((d) => d.data === data)?.turno ?? null;
    setDia(data);
    setFolgaDia(!t);
    setTurnoDia(t ?? padrao);
  }

  function aplicarSemana() {
    if (!alvo.length) return;
    const a: AcaoDia = acao === "horario" ? { tipo: "horario", turno: turnoSemana } : { tipo: acao };
    onDias(
      alvo.map((d) => d.data),
      a,
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Escala de {c.nome}
            {erros ? (
              <Badge variant="destructive">
                <XCircle className="mr-1 h-3 w-3" /> {erros} erro(s)
              </Badge>
            ) : (
              <Badge className="bg-emerald-600 hover:bg-emerald-600">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Dentro da lei
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {MODELOS[c.modelo]} · {num(linha.horas)}h no mês · {c.modelo === "12x36" ? "média semanal" : "maior semana"} {num(linha.maiorSemana)}h de{" "}
            {linha.limiteSemana}h. O que mudar aqui vale só para esta pessoa; o que sair da regra é recusado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <section className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Modelo, horário padrão e folgas</p>
              <ControlesPessoa c={c} repousos={repousos} viradaEm={viradaEm} onChange={(p) => void onChange(p)} />
              <p className="text-[11px] text-muted-foreground">Trocar o modelo ou as folgas desfaz os ajustes feitos à mão nesta pessoa.</p>
            </section>

            <section className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Dias da semana com horário diferente</p>
              <p className="text-[11px] text-muted-foreground">Ex.: sábado das 08h às 12h, ou folga em todas as quartas do mês.</p>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Dias da semana">
                {LETRAS.map((l, i) => (
                  <button
                    key={i}
                    type="button"
                    title={NOMES_DIA[i]}
                    aria-pressed={semana.has(i)}
                    aria-label={NOMES_DIA[i]}
                    onClick={() =>
                      setSemana((s) => {
                        const n = new Set(s);
                        if (n.has(i)) n.delete(i);
                        else n.add(i);
                        return n;
                      })
                    }
                    className={cn(
                      "h-8 w-8 rounded-full border text-xs font-medium",
                      semana.has(i) ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                {(
                  [
                    ["horario", "Horário"],
                    ["folga", "Folga"],
                    ["modelo", "Voltar ao modelo"],
                  ] as const
                ).map(([v, r]) => (
                  <label key={v} className="flex items-center gap-1">
                    <input type="radio" name={`acao-${c.id}`} checked={acao === v} onChange={() => setAcao(v)} />
                    {r}
                  </label>
                ))}
              </div>
              {acao === "horario" && <CamposTurno t={turnoSemana} onChange={setTurnoSemana} rotulo="dos dias da semana" />}
              <Button size="sm" className="w-full" disabled={!alvo.length} onClick={aplicarSemana}>
                {semana.size ? `Aplicar em ${alvo.length} dia(s) do mês` : "Escolha os dias da semana"}
              </Button>
            </section>

            {grupos.length > 0 && (
              <section className="space-y-1 rounded-lg border p-3">
                <p className="text-sm font-medium">O que ajustar</p>
                <ul className="space-y-0.5">
                  {grupos.map((g, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs">
                      {g.gravidade === "erro" ? (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      )}
                      <span>
                        <span className="text-muted-foreground">{g.quando}:</span> {g.mensagem}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="space-y-3">
            <CalendarioPessoa c={c} mes={mes} ajustes={ajustes} feriados={feriados} feriadosSet={feriadosSet} avaliacao={linha} previa={false} onDia={escolherDia} />
            {dia && (
              <section className="space-y-2 rounded-lg border border-primary/40 p-3">
                <p className="text-sm font-medium">
                  {NOMES_DIA[diaDaSemana(dia)]}, {ddmm(dia)}
                  {feriados.get(dia) && <span className="ml-1 text-xs text-primary">· {feriados.get(dia)}</span>}
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={folgaDia} onCheckedChange={(v) => setFolgaDia(Boolean(v))} aria-label="Folga neste dia" />
                  Folga neste dia
                </label>
                {!folgaDia && <CamposTurno t={turnoDia} onChange={setTurnoDia} rotulo="do dia" />}
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setDia(null)}>
                    Cancelar
                  </Button>
                  {dia in meus && (
                    <Button size="sm" variant="outline" onClick={() => onDias([dia], { tipo: "modelo" }) && setDia(null)}>
                      Voltar ao modelo
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="ml-auto"
                    onClick={() => onDias([dia], folgaDia ? { tipo: "folga" } : { tipo: "horario", turno: turnoDia }) && setDia(null)}
                  >
                    Aplicar no dia
                  </Button>
                </div>
              </section>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" disabled={!ajustados.length} onClick={() => onDias(ajustados, { tipo: "modelo" })}>
            <RotateCcw className="mr-1 h-4 w-4" /> Desfazer ajustes à mão ({ajustados.length})
          </Button>
          <Button onClick={onFechar}>Concluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
