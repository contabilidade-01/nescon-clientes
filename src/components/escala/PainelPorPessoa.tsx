import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft, ChevronRight, Lock, Plus, UserRound, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ControlesPessoa } from "@/components/escala/ControlesPessoa";
import { cn } from "@/lib/utils";
import { diaDaSemana } from "@/lib/escala/datas";
import { minutosTrabalhados, type DiaEscala } from "@/lib/escala/modelos";
import {
  MODELOS,
  diasParaValidar,
  type Ajustes,
  type AvaliacaoPessoa,
  type ConfigEmpresa,
  type ConfigPessoa,
  type ModeloChave,
} from "@/lib/escala/planejamento";
import { opcoesDaPessoa, resumoFolgas, type OpcaoPessoa } from "@/lib/escala/porPessoa";
import { vigenciaEm } from "@/lib/escala/regras";

const LETRAS = ["D", "S", "T", "Q", "Q", "S", "S"];
const NOMES_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function num(n: number, casas = 1) {
  return n.toFixed(casas).replace(".", ",");
}

function horaCurta(hhmm: string) {
  return hhmm.endsWith(":00") ? hhmm.slice(0, 2) + "h" : hhmm;
}

/**
 * Simulação por funcionário: escolhe uma pessoa, configura o modelo dela e compara as
 * opções que cabem na regra, vendo na mesma tela como a equipe inteira fica em cada dia.
 * Toda mudança passa pela trava da grade (`onChange` devolve false quando recusa).
 */
export function PainelPorPessoa({
  mes,
  dias,
  empresa,
  feriados,
  feriadosSet,
  linhas,
  ajustes,
  repousos,
  viradaEm,
  foco,
  onFoco,
  onChange,
  onEditarDia,
  onVaga,
}: {
  mes: string;
  dias: string[];
  empresa: ConfigEmpresa;
  feriados: Map<string, string>;
  feriadosSet: Set<string>;
  linhas: AvaliacaoPessoa[];
  ajustes: Ajustes;
  repousos: number;
  viradaEm?: string;
  foco: string | null;
  onFoco: (id: string) => void;
  onChange: (id: string, patch: Partial<ConfigPessoa>) => boolean;
  onEditarDia: (c: ConfigPessoa, data: string) => void;
  onVaga: () => void;
}) {
  const linha = linhas.find((l) => l.config.id === foco) ?? linhas[0];
  const c = linha?.config;
  // Variação mostrada em cada modelo e a opção sob o mouse (prévia na equipe e no calendário).
  const [indice, setIndice] = useState<Partial<Record<ModeloChave, number>>>({});
  const [previa, setPrevia] = useState<OpcaoPessoa | null>(null);

  const grupos = useMemo(
    () => (c ? opcoesDaPessoa(c, linhas, ajustes, mes, empresa, feriadosSet) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, linhas, ajustes, mes, feriadosSet, empresa.segmento, empresa.temAcordoColetivo, empresa.bloqueio, empresa.demanda, empresa.diasFechados],
  );
  const atual = grupos.find((g) => g.modelo === c?.modelo)?.opcoes.find((o) => o.atual);
  const temDemanda = empresa.demanda.some((n) => n > 0);

  function escolher(id: string) {
    onFoco(id);
    setIndice({});
    setPrevia(null);
  }

  function usar(o: OpcaoPessoa) {
    if (!c) return;
    const { id: _id, nome: _nome, ...patch } = o.config;
    if (onChange(c.id, patch)) {
      setIndice({});
      setPrevia(null);
      toast.success(`${c.nome}: ${MODELOS[o.modelo]}, ${o.resumo}.`);
    }
  }

  if (!c || !linha) return null;
  const erros = linha.ocorrencias.filter((o) => o.gravidade === "erro").length;
  const mostrada = previa && previa.config.id === c.id ? previa : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <UserRound className="h-4 w-4" /> Funcionários
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2 pt-0">
            {linhas.map((l) => {
              const e = l.ocorrencias.filter((o) => o.gravidade === "erro").length;
              const ativo = l.config.id === c.id;
              return (
                <button
                  key={l.config.id}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => escolher(l.config.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:bg-muted",
                    ativo && "border-primary bg-primary/5",
                  )}
                >
                  {e ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{l.config.nome}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {MODELOS[l.config.modelo]} · {num(l.horas / (dias.length / 7))}h/sem
                    </span>
                  </span>
                </button>
              );
            })}
            <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-xs" onClick={onVaga}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Vaga simulada
            </Button>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-base font-semibold">{c.nome}</h3>
                {erros ? (
                  <Badge variant="destructive">
                    <XCircle className="mr-1 h-3 w-3" /> {erros} erro(s)
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-600 hover:bg-emerald-600">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Dentro da lei
                  </Badge>
                )}
                <Badge variant="secondary">{num(linha.horas)}h no mês</Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    linha.semanaAcima === "erro" && "border-destructive text-destructive",
                    linha.semanaAcima === "atencao" && "border-amber-500 text-amber-700 dark:text-amber-300",
                  )}
                >
                  Maior semana {num(linha.maiorSemana)}h de {linha.limiteSemana}h
                </Badge>
                <Badge variant="outline">{atual?.domingosDeFolga ?? 0} domingo(s) de folga</Badge>
              </div>
              <div className="rounded-lg border bg-muted/30 p-2">
                <p className="mb-1.5 text-xs text-muted-foreground">Configuração de {c.nome} (só dele; o resto da equipe fica como está)</p>
                <ControlesPessoa c={c} repousos={repousos} viradaEm={viradaEm} onChange={(p) => onChange(c.id, p)} />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <CalendarioPessoa
              c={mostrada?.config ?? c}
              mes={mes}
              ajustes={mostrada ? {} : ajustes}
              feriados={feriados}
              feriadosSet={feriadosSet}
              avaliacao={mostrada?.avaliacao ?? linha}
              previa={Boolean(mostrada)}
              onDia={(d) => onEditarDia(c, d)}
            />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Opções para {c.nome}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Só aparecem variações dentro da regra. Passe o mouse para ver a prévia no calendário e na equipe.
                </p>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {grupos.map((g) => {
                  if (!g.opcoes.length) {
                    return (
                      <div key={g.modelo} className="flex flex-col gap-1 rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1 font-medium">
                          <Lock className="h-3.5 w-3.5" /> {g.nome}
                        </span>
                        <span>{g.indisponivel}</span>
                      </div>
                    );
                  }
                  const i = Math.min(indice[g.modelo] ?? 0, g.opcoes.length - 1);
                  const o = g.opcoes[i];
                  return (
                    <CartaoOpcao
                      key={g.modelo}
                      nome={g.nome}
                      opcao={o}
                      atual={atual}
                      posicao={i}
                      total={g.opcoes.length}
                      temDemanda={temDemanda}
                      fechados={empresa.diasFechados}
                      onMover={(d) => {
                        const n = (i + d + g.opcoes.length) % g.opcoes.length;
                        setIndice((x) => ({ ...x, [g.modelo]: n }));
                        setPrevia(g.opcoes[n]);
                      }}
                      onPrevia={(on) => setPrevia(on ? o : null)}
                      onUsar={() => usar(o)}
                    />
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <VisaoEquipe
        dias={dias}
        linhas={linhas}
        foco={c.id}
        previa={mostrada}
        demanda={empresa.demanda}
        fechados={empresa.diasFechados}
        feriados={feriados}
        onFoco={escolher}
      />
    </div>
  );
}

function CartaoOpcao({
  nome,
  opcao: o,
  atual,
  posicao,
  total,
  temDemanda,
  fechados,
  onMover,
  onPrevia,
  onUsar,
}: {
  nome: string;
  opcao: OpcaoPessoa;
  atual?: OpcaoPessoa;
  posicao: number;
  total: number;
  temDemanda: boolean;
  fechados: number[];
  onMover: (d: 1 | -1) => void;
  onPrevia: (on: boolean) => void;
  onUsar: () => void;
}) {
  const turno = o.config;
  return (
    <div
      onMouseEnter={() => onPrevia(true)}
      onMouseLeave={() => onPrevia(false)}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs transition hover:border-primary/60 hover:shadow-sm",
        o.atual && "border-primary bg-primary/5",
        !o.podeUsar && "border-destructive bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-1">
        <span className="font-medium">{nome}</span>
        {o.atual && <Badge className="h-4 px-1.5 text-[10px]">Atual</Badge>}
        {total > 1 && (
          <span className="ml-auto flex items-center gap-0.5 text-[11px] text-muted-foreground">
            <button type="button" className="rounded p-0.5 hover:bg-muted" onClick={() => onMover(-1)} aria-label={`Variação anterior de ${nome}`}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            {posicao + 1}/{total}
            <button type="button" className="rounded p-0.5 hover:bg-muted" onClick={() => onMover(1)} aria-label={`Próxima variação de ${nome}`}>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
      <span className="text-muted-foreground">
        {turno.entrada}–{turno.saida} · {o.resumo}
      </span>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span className={cn(o.avaliacao.semanaAcima === "erro" && "font-semibold text-destructive", o.avaliacao.semanaAcima === "atencao" && "text-amber-700 dark:text-amber-300")}>
          {num(o.horasSemana)}h/sem (maior {num(o.avaliacao.maiorSemana)}h de {o.avaliacao.limiteSemana}h)
        </span>
        <span>{o.domingosDeFolga} dom. de folga</span>
        {temDemanda && <span className={cn(o.diasDescobertos > 0 && "text-destructive")}>{o.diasDescobertos} dia(s) descoberto(s)</span>}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center" title="Média de pessoas trabalhando em cada dia da semana, com esta opção">
        {o.mediaPorDia.map((m, d) => {
          const delta = atual ? m - atual.mediaPorDia[d] : 0;
          return (
            <div key={d} className={cn("rounded bg-muted px-0.5 py-0.5", fechados.includes(d) && "opacity-40")}>
              <div className="text-[9px] text-muted-foreground">{LETRAS[d]}</div>
              <div className="tabular-nums">{num(m)}</div>
              {Math.abs(delta) > 0.05 && (
                <div className={cn("text-[9px] tabular-nums", delta > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300")}>
                  {delta > 0 ? "+" : "−"}
                  {num(Math.abs(delta))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {o.motivos.length > 0 && <span className="text-destructive">{o.motivos[0]}</span>}
      <Button size="sm" variant={o.atual ? "secondary" : "default"} className="mt-auto h-7 text-xs" disabled={o.atual || !o.podeUsar} onClick={onUsar}>
        {o.atual ? "Em uso" : "Usar esta"}
      </Button>
    </div>
  );
}

/** O mês da pessoa em semanas de domingo a sábado, com as horas de cada semana. */
function CalendarioPessoa({
  c,
  mes,
  ajustes,
  feriados,
  feriadosSet,
  avaliacao,
  previa,
  onDia,
}: {
  c: ConfigPessoa;
  mes: string;
  ajustes: Ajustes;
  feriados: Map<string, string>;
  feriadosSet: Set<string>;
  avaliacao: AvaliacaoPessoa;
  previa: boolean;
  onDia: (data: string) => void;
}) {
  const todos = useMemo(() => diasParaValidar(c, mes, ajustes, feriadosSet), [c, mes, ajustes, feriadosSet]);
  const semanas: DiaEscala[][] = [];
  for (let i = 0; i < todos.length; i += 7) semanas.push(todos.slice(i, i + 7));
  return (
    <Card className={cn(previa && "border-primary border-dashed")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{previa ? `Prévia: ${MODELOS[c.modelo]}, ${resumoFolgas(c)}` : `Mês de ${c.nome}`}</CardTitle>
        <p className="text-xs text-muted-foreground">{previa ? "Ainda não aplicada." : "Clique num dia para mudar só ele."}</p>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <table className="w-full table-fixed border-collapse text-[11px]">
          <thead>
            <tr>
              {LETRAS.map((l, i) => (
                <th key={i} className={cn("pb-1 font-normal text-muted-foreground", i === 0 && "text-primary font-semibold")}>
                  {l}
                </th>
              ))}
              <th className="w-14 pb-1 text-right font-normal text-muted-foreground">Semana</th>
            </tr>
          </thead>
          <tbody>
            {semanas.map((s) => {
              const horas = s.reduce((a, d) => a + (d.turno ? minutosTrabalhados(d.turno) : 0), 0) / 60;
              const limite = vigenciaEm(s[s.length - 1].data).limiteSemanalHoras;
              const acima = horas > limite + 0.01;
              return (
                <tr key={s[0].data}>
                  {s.map((d) => {
                    const doMes = d.data.startsWith(mes);
                    const g = doMes ? avaliacao.porDia.get(d.data) : undefined;
                    return (
                      <td key={d.data} className="p-0.5">
                        <button
                          type="button"
                          disabled={!doMes || previa}
                          onClick={() => onDia(d.data)}
                          title={`${NOMES_DIA[diaDaSemana(d.data)]}${feriados.get(d.data) ? ` · ${feriados.get(d.data)}` : ""}`}
                          className={cn(
                            "flex h-11 w-full flex-col items-center justify-center rounded border leading-tight tabular-nums disabled:cursor-default",
                            d.turno ? "border-primary/30 bg-primary/10" : "bg-muted text-muted-foreground",
                            !doMes && "opacity-35",
                            g === "erro" && "border-destructive bg-destructive/15 text-destructive",
                            g === "atencao" && "border-amber-500 bg-amber-100 dark:bg-amber-950",
                            doMes && !previa && "hover:border-primary",
                          )}
                        >
                          <span className={cn("text-[10px]", feriados.has(d.data) && "font-semibold text-primary")}>{Number(d.data.slice(8))}</span>
                          <span className="text-[9px]">{d.turno ? `${horaCurta(d.turno.entrada)}–${horaCurta(d.turno.saida)}` : "Folga"}</span>
                        </button>
                      </td>
                    );
                  })}
                  <td
                    className={cn("p-0.5 text-right tabular-nums", acima && (avaliacao.semanaAcima === "erro" ? "font-semibold text-destructive" : "text-amber-700 dark:text-amber-300"))}
                    title={`Limite: ${limite}h`}
                  >
                    {num(horas)}h
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** A equipe inteira em faixas finas: quem trabalha em cada dia e quantos ficam na casa. */
function VisaoEquipe({
  dias,
  linhas,
  foco,
  previa,
  demanda,
  fechados,
  feriados,
  onFoco,
}: {
  dias: string[];
  linhas: AvaliacaoPessoa[];
  foco: string;
  previa: OpcaoPessoa | null;
  demanda: number[];
  fechados: number[];
  feriados: Map<string, string>;
  onFoco: (id: string) => void;
}) {
  const temDemanda = demanda.some((n) => n > 0);
  const diasDe = (l: AvaliacaoPessoa) => (previa && l.config.id === foco ? previa.avaliacao : l);
  const trabalhaEm = (l: AvaliacaoPessoa, d: string) => Boolean(diasDe(l).dias.find((x) => x.data === d)?.turno);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Visão da equipe{previa ? " (com a prévia)" : ""}</CardTitle>
        <p className="text-xs text-muted-foreground">Cada faixa é uma pessoa; clique para simular por ela. A última linha conta quem trabalha no dia.</p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-3 pt-0">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-[11px]">
          <colgroup>
            <col className="w-[150px]" />
            {dias.map((d) => (
              <col key={d} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th />
              {dias.map((d) => {
                const dow = diaDaSemana(d);
                return (
                  <th
                    key={d}
                    title={feriados.get(d) || NOMES_DIA[dow]}
                    className={cn("pb-1 text-center text-[10px] font-normal leading-tight text-muted-foreground", (dow === 0 || feriados.has(d)) && "font-semibold text-primary")}
                  >
                    <div>{LETRAS[dow]}</div>
                    <div>{d.slice(8)}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const a = diasDe(l);
              const ativo = l.config.id === foco;
              return (
                <tr
                  key={l.config.id}
                  onClick={() => onFoco(l.config.id)}
                  className={cn("cursor-pointer hover:bg-muted/60", ativo && "bg-primary/5")}
                >
                  <td className={cn("truncate py-0.5 pr-2", ativo && "font-semibold text-primary")} title={l.config.nome}>
                    {l.config.nome}
                  </td>
                  {dias.map((d) => {
                    const t = trabalhaEm(l, d);
                    const g = a.porDia.get(d);
                    return (
                      <td key={d} className="px-px py-0.5">
                        <div
                          className={cn(
                            "h-4 rounded-sm",
                            t ? "bg-primary/60" : "bg-muted",
                            ativo && previa && "outline outline-1 outline-dashed outline-primary",
                            g === "erro" && "bg-destructive/70",
                            g === "atencao" && "bg-amber-400",
                          )}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-t">
              <td className="py-1 pr-2 font-medium">Trabalhando</td>
              {dias.map((d) => {
                const n = linhas.filter((l) => trabalhaEm(l, d)).length;
                const dow = diaDaSemana(d);
                const falta = temDemanda && n < demanda[dow];
                const fechado = fechados.includes(dow);
                return (
                  <td
                    key={d}
                    title={temDemanda ? `Necessário: ${demanda[dow]}` : undefined}
                    className={cn("py-1 text-center tabular-nums", falta && !fechado && "font-semibold text-destructive", fechado && "text-muted-foreground")}
                  >
                    {n}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded-sm bg-primary/60" /> trabalha
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded-sm bg-muted" /> folga
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded-sm bg-destructive/70" /> fora da regra
          </span>
          {temDemanda && <span>Número em vermelho: menos gente que a demanda.</span>}
        </div>
      </CardContent>
    </Card>
  );
}
