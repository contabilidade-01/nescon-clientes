import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { AlertTriangle, CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { diaDaSemana } from "@/lib/escala/datas";
import { feriadosTrabalhistas } from "@/lib/escala/feriados";
import { minutosTrabalhados, type Turno } from "@/lib/escala/modelos";
import {
  configPadrao,
  definirCelula,
  diasDoMes,
  diasParaValidar,
  trocarCelulas,
  type Ajustes,
  type ConfigPessoa,
  type ModeloChave,
} from "@/lib/escala/planejamento";
import { SEGMENTOS, vigenciaEm, type PerfilJornada, type Segmento } from "@/lib/escala/regras";
import { validarEscala, type Ocorrencia } from "@/lib/escala/validar";

const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const NOMES_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
/** Regras que apontam um dia específico; as semanais vão só para a lista. */
const REGRAS_DO_DIA = new Set(["JORNADA_DIARIA", "HORA_EXTRA", "INTERVALO", "INTERJORNADA", "DIAS_SEGUIDOS", "DOMINGO", "FERIADO"]);

function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ddmm(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "02/11, 20/01" -> datas ISO do ano do mês planejado. */
function feriadosLocais(texto: string, ano: string): string[] {
  return texto
    .split(/[,;\s]+/)
    .map((t) => /^(\d{1,2})\/(\d{1,2})$/.exec(t.trim()))
    .filter(Boolean)
    .map((m) => `${ano}-${m![2].padStart(2, "0")}-${m![1].padStart(2, "0")}`);
}

type Pessoa = { id: string; name: string };

export function PlanejadorEscala({
  pessoas,
  regime12x36Padrao = false,
}: {
  pessoas: Pessoa[];
  regime12x36Padrao?: boolean;
}) {
  const [mes, setMes] = useState(mesAtual);
  const [segmento, setSegmento] = useState<Segmento>("comercio");
  const [temAcordoColetivo, setTemAcordoColetivo] = useState(false);
  const [feriadosTexto, setFeriadosTexto] = useState("");
  const [configs, setConfigs] = useState<ConfigPessoa[]>([]);
  const [ajustes, setAjustes] = useState<Ajustes>({});
  const [editando, setEditando] = useState<{ pessoa: ConfigPessoa; data: string } | null>(null);
  const [modeloTodos, setModeloTodos] = useState<ModeloChave>("5x2");

  // Trocar de empresa recomeça a simulação.
  useEffect(() => {
    const modelo: ModeloChave = regime12x36Padrao ? "12x36" : "6x1";
    setConfigs(
      pessoas.map((p, i) => ({
        ...configPadrao(p.id, p.name, modelo),
        turma: i % 2 === 0 ? "A" : "B",
      })),
    );
    setAjustes({});
  }, [pessoas, regime12x36Padrao]);

  const dias = useMemo(() => diasDoMes(mes), [mes]);
  const ultimoDia = dias[dias.length - 1];
  const vigencia = vigenciaEm(ultimoDia);

  const feriados = useMemo(() => {
    const anos = new Set([dias[0].slice(0, 4), ultimoDia.slice(0, 4), String(Number(dias[0].slice(0, 4)) - 1)]);
    const m = new Map<string, string>();
    for (const a of anos) for (const [d, n] of feriadosTrabalhistas(Number(a))) m.set(d, n);
    for (const a of anos) for (const d of feriadosLocais(feriadosTexto, a)) m.set(d, "Feriado local");
    return m;
  }, [dias, ultimoDia, feriadosTexto]);
  const feriadosSet = useMemo(() => new Set(feriados.keys()), [feriados]);

  const linhas = useMemo(
    () =>
      configs.map((c) => {
        const todos = diasParaValidar(c, mes, ajustes);
        const perfil: PerfilJornada = { segmento, temAcordoColetivo, regime12x36: c.modelo === "12x36" };
        const resultado = validarEscala(todos, perfil, feriadosSet);
        const doMes = todos.filter((d) => d.data.startsWith(mes));
        const porDia = new Map<string, "erro" | "atencao">();
        for (const o of resultado.ocorrencias) {
          if (!REGRAS_DO_DIA.has(o.regra)) continue;
          if (porDia.get(o.data) !== "erro") porDia.set(o.data, o.gravidade);
        }
        // Só conta o que cai no mês planejado (as semanas das pontas entram na conta, mas
        // o aviso de um dia do mês vizinho não é deste mês).
        const ocorrencias = resultado.ocorrencias.filter((o) => o.data.startsWith(mes) || !REGRAS_DO_DIA.has(o.regra));
        const horas = doMes.reduce((a, d) => a + (d.turno ? minutosTrabalhados(d.turno) : 0), 0) / 60;
        return { config: c, dias: doMes, porDia, ocorrencias, horas, semanas: resultado.semanas };
      }),
    [configs, mes, ajustes, feriadosSet, segmento, temAcordoColetivo],
  );

  const totalErros = linhas.reduce((a, l) => a + l.ocorrencias.filter((o) => o.gravidade === "erro").length, 0);
  const totalAvisos = linhas.reduce((a, l) => a + l.ocorrencias.filter((o) => o.gravidade === "atencao").length, 0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function turnoEm(pessoaId: string, data: string): Turno | null {
    return linhas.find((l) => l.config.id === pessoaId)?.dias.find((d) => d.data === data)?.turno ?? null;
  }

  function aoSoltar(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const [pa, da] = String(e.active.id).split("|");
    const [pb, db] = String(e.over.id).split("|");
    setAjustes((aj) =>
      trocarCelulas(aj, { pessoa: pa, data: da, turno: turnoEm(pa, da) }, { pessoa: pb, data: db, turno: turnoEm(pb, db) }),
    );
  }

  function atualizar(id: string, patch: Partial<ConfigPessoa>) {
    setConfigs((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    // Mudar o modelo da pessoa descarta os ajustes dela: eram em cima do modelo anterior.
    if (patch.modelo || patch.folga6x1 !== undefined || patch.turma) {
      setAjustes((aj) => ({ ...aj, [id]: {} }));
    }
  }

  function aplicarATodos() {
    setConfigs((cs) =>
      cs.map((c, i) => ({ ...configPadrao(c.id, c.nome, modeloTodos), turma: i % 2 === 0 ? "A" : "B" })),
    );
    setAjustes({});
  }

  function adicionarVaga() {
    const n = configs.filter((c) => c.id.startsWith("vaga-")).length + 1;
    setConfigs((cs) => [...cs, configPadrao(`vaga-${Date.now()}`, `Vaga simulada ${n}`, modeloTodos)]);
  }

  const atalhos = [
    { rotulo: "Mês atual", valor: mesAtual() },
    { rotulo: "Jan/2027 (42h)", valor: "2027-01" },
    { rotulo: "Jan/2028 (40h)", valor: "2028-01" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Mês planejado</Label>
            <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
            <div className="flex flex-wrap gap-1">
              {atalhos.map((a) => (
                <Button key={a.valor + a.rotulo} size="sm" variant={mes === a.valor ? "secondary" : "ghost"} className="h-6 px-2 text-xs" onClick={() => setMes(a.valor)}>
                  {a.rotulo}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Segmento</Label>
            <Select value={segmento} onValueChange={(v) => setSegmento(v as Segmento)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SEGMENTOS) as Segmento[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {SEGMENTOS[s].nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 pt-1 text-sm">
              <Switch checked={temAcordoColetivo} onCheckedChange={setTemAcordoColetivo} />
              Tem acordo/convenção coletiva
            </label>
          </div>
          <div className="space-y-1.5">
            <Label>Feriados locais (dd/mm)</Label>
            <Input placeholder="ex.: 20/01, 15/08" value={feriadosTexto} onChange={(e) => setFeriadosTexto(e.target.value)} />
            <p className="text-xs text-muted-foreground">Os nacionais já entram sozinhos.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Regra deste mês</Label>
            <p className="text-sm font-medium">{vigencia.nome}</p>
            <p className="text-xs text-muted-foreground">
              Até {vigencia.limiteSemanalHoras}h por semana, {vigencia.repousosSemanais} folga(s) semanal(is).
            </p>
            <div className="flex gap-2 pt-1">
              <Badge variant={totalErros ? "destructive" : "outline"}>{totalErros} erro(s)</Badge>
              <Badge variant="secondary">{totalAvisos} aviso(s)</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={modeloTodos} onValueChange={(v) => setModeloTodos(v as ModeloChave)}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="6x1">6x1</SelectItem>
            <SelectItem value="5x2">5x2</SelectItem>
            <SelectItem value="12x36">12x36</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={aplicarATodos} disabled={!configs.length}>
          Aplicar a todos
        </Button>
        <Button variant="outline" size="sm" onClick={adicionarVaga}>
          <Plus className="mr-1 h-4 w-4" /> Vaga simulada
        </Button>
        <p className="text-xs text-muted-foreground">
          Arraste uma célula sobre outra para trocar (mesma pessoa move a folga; outra pessoa troca o turno). Clique para editar o dia.
        </p>
      </div>

      {configs.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nenhum funcionário ativo nesta empresa. Use “Vaga simulada” para montar a escala mesmo assim.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <DndContext sensors={sensors} onDragEnd={aoSoltar}>
              <table className="w-max border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-[260px] bg-card p-2 text-left font-medium">Pessoa e modelo</th>
                    {dias.map((d) => {
                      const dow = diaDaSemana(d);
                      return (
                        <th
                          key={d}
                          title={feriados.get(d) || NOMES_DIA[dow]}
                          className={cn(
                            "w-11 p-1 text-center font-normal",
                            dow === 0 && "border-l",
                            (dow === 0 || feriados.has(d)) && "text-primary font-semibold",
                          )}
                        >
                          <div>{DIAS_SEMANA[dow]}</div>
                          <div>{d.slice(8)}</div>
                          {feriados.has(d) && <div className="text-[9px]">fer.</div>}
                        </th>
                      );
                    })}
                    <th className="p-2 text-right font-medium">Horas no mês</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(({ config: c, dias: ds, porDia, ocorrencias, horas }) => {
                    const erros = ocorrencias.filter((o) => o.gravidade === "erro").length;
                    return (
                      <tr key={c.id} className="border-t">
                        <td className="sticky left-0 z-10 bg-card p-2 align-top">
                          <LinhaConfig
                            c={c}
                            erros={erros}
                            onChange={(p) => atualizar(c.id, p)}
                            onRemover={c.id.startsWith("vaga-") ? () => setConfigs((cs) => cs.filter((x) => x.id !== c.id)) : undefined}
                          />
                        </td>
                        {ds.map((d) => (
                          <Celula
                            key={d.data}
                            id={`${c.id}|${d.data}`}
                            turno={d.turno}
                            domingo={diaDaSemana(d.data) === 0}
                            gravidade={porDia.get(d.data)}
                            ajustado={Boolean(ajustes[c.id] && d.data in ajustes[c.id])}
                            onClick={() => setEditando({ pessoa: c, data: d.data })}
                          />
                        ))}
                        <td className="p-2 text-right tabular-nums">{horas.toFixed(1).replace(".", ",")}h</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t bg-muted/40">
                    <td className="sticky left-0 z-10 bg-muted p-2 font-medium">Pessoas trabalhando</td>
                    {dias.map((d) => (
                      <td key={d} className={cn("p-1 text-center tabular-nums", diaDaSemana(d) === 0 && "border-l")}>
                        {linhas.filter((l) => l.dias.find((x) => x.data === d)?.turno).length}
                      </td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
            </DndContext>
          </CardContent>
        </Card>
      )}

      <ListaOcorrencias linhas={linhas.map((l) => ({ nome: l.config.nome, ocorrencias: l.ocorrencias }))} />

      <p className="text-xs text-muted-foreground">
        Simulação: nada aqui é salvo ainda. As regras da EC 141/2026 seguem o divulgado na promulgação (16/10/2026)
        e serão conferidas com o texto publicado no Diário Oficial.
      </p>

      {editando && (
        <EditarDia
          nome={editando.pessoa.nome}
          data={editando.data}
          feriado={feriados.get(editando.data)}
          turno={turnoEm(editando.pessoa.id, editando.data)}
          padrao={{ entrada: editando.pessoa.entrada, saida: editando.pessoa.saida, intervaloMin: editando.pessoa.intervaloMin }}
          onFechar={() => setEditando(null)}
          onSalvar={(t) => {
            setAjustes((aj) => definirCelula(aj, editando.pessoa.id, editando.data, t));
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

function LinhaConfig({
  c,
  erros,
  onChange,
  onRemover,
}: {
  c: ConfigPessoa;
  erros: number;
  onChange: (p: Partial<ConfigPessoa>) => void;
  onRemover?: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {erros ? <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
        <span className="truncate text-sm font-medium" title={c.nome}>
          {c.nome}
        </span>
        {onRemover && (
          <button type="button" className="ml-auto text-muted-foreground hover:text-destructive" onClick={onRemover} aria-label="Remover vaga">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <select
          className="h-7 rounded border bg-background px-1"
          value={c.modelo}
          onChange={(e) => {
            const modelo = e.target.value as ModeloChave;
            const p = configPadrao(c.id, c.nome, modelo);
            onChange({ modelo, entrada: p.entrada, saida: p.saida });
          }}
          aria-label="Modelo de escala"
        >
          <option value="6x1">6x1</option>
          <option value="5x2">5x2</option>
          <option value="12x36">12x36</option>
        </select>
        <input type="time" className="h-7 rounded border bg-background px-1" value={c.entrada} onChange={(e) => onChange({ entrada: e.target.value })} aria-label="Entrada" />
        <input type="time" className="h-7 rounded border bg-background px-1" value={c.saida} onChange={(e) => onChange({ saida: e.target.value })} aria-label="Saída" />
        <input
          type="number"
          min={0}
          step={15}
          className="h-7 w-14 rounded border bg-background px-1"
          value={c.intervaloMin}
          onChange={(e) => onChange({ intervaloMin: Math.max(0, Number(e.target.value) || 0) })}
          aria-label="Intervalo em minutos"
          title="Intervalo (min)"
        />
        {c.modelo === "6x1" && (
          <select className="h-7 rounded border bg-background px-1" value={c.folga6x1} onChange={(e) => onChange({ folga6x1: Number(e.target.value) })} aria-label="Dia da folga">
            {NOMES_DIA.map((n, i) => (
              <option key={n} value={i}>
                Folga {n.slice(0, 3).toLowerCase()}
              </option>
            ))}
          </select>
        )}
        {c.modelo === "12x36" && (
          <select className="h-7 rounded border bg-background px-1" value={c.turma} onChange={(e) => onChange({ turma: e.target.value as "A" | "B" })} aria-label="Turma">
            <option value="A">Turma A</option>
            <option value="B">Turma B</option>
          </select>
        )}
      </div>
    </div>
  );
}

function Celula({
  id,
  turno,
  domingo,
  gravidade,
  ajustado,
  onClick,
}: {
  id: string;
  turno: Turno | null;
  domingo: boolean;
  gravidade?: "erro" | "atencao";
  ajustado: boolean;
  onClick: () => void;
}) {
  const drag = useDraggable({ id });
  const drop = useDroppable({ id });
  const estilo = drag.transform ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)`, zIndex: 20 } : undefined;
  return (
    <td ref={drop.setNodeRef} className={cn("p-0.5", domingo && "border-l", drop.isOver && "bg-primary/10")}>
      <button
        type="button"
        ref={drag.setNodeRef}
        style={estilo}
        {...drag.listeners}
        {...drag.attributes}
        onClick={onClick}
        className={cn(
          "relative flex h-10 w-10 cursor-grab flex-col items-center justify-center rounded border text-[10px] leading-tight active:cursor-grabbing",
          turno ? "bg-primary/10 border-primary/30" : "bg-muted text-muted-foreground",
          gravidade === "erro" && "border-destructive bg-destructive/15 text-destructive",
          gravidade === "atencao" && "border-amber-500 bg-amber-100 dark:bg-amber-950",
          drag.isDragging && "opacity-70 shadow-lg",
        )}
        title={turno ? `${turno.entrada}–${turno.saida} (intervalo ${turno.intervaloMin}min)` : "Folga"}
      >
        {turno ? (
          <>
            <span>{turno.entrada}</span>
            <span>{turno.saida}</span>
          </>
        ) : (
          <span className="text-xs font-semibold">F</span>
        )}
        {ajustado && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}
      </button>
    </td>
  );
}

function EditarDia({
  nome,
  data,
  feriado,
  turno,
  padrao,
  onFechar,
  onSalvar,
}: {
  nome: string;
  data: string;
  feriado?: string;
  turno: Turno | null;
  padrao: Turno;
  onFechar: () => void;
  onSalvar: (t: Turno | null) => void;
}) {
  const [folga, setFolga] = useState(!turno);
  const [t, setT] = useState<Turno>(turno ?? padrao);
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {nome} — {ddmm(data)} ({NOMES_DIA[diaDaSemana(data)]})
          </DialogTitle>
        </DialogHeader>
        {feriado && <p className="text-sm text-primary">Feriado: {feriado}</p>}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={folga} onCheckedChange={(v) => setFolga(Boolean(v))} />
          Folga neste dia
        </label>
        {!folga && (
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label>Entrada</Label>
              <Input type="time" value={t.entrada} onChange={(e) => setT({ ...t, entrada: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Saída</Label>
              <Input type="time" value={t.saida} onChange={(e) => setT({ ...t, saida: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Intervalo</Label>
              <Input type="number" min={0} step={15} value={t.intervaloMin} onChange={(e) => setT({ ...t, intervaloMin: Math.max(0, Number(e.target.value) || 0) })} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => onSalvar(folga ? null : t)}>Aplicar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A mesma falha semanal se repete em todas as semanas do mês (um 6x1 de 44h estoura o
 * limite em cada uma). Agrupa por mensagem para a lista dizer uma vez, com as semanas.
 */
function agrupar(ocorrencias: Ocorrencia[]) {
  const grupos = new Map<string, { gravidade: Ocorrencia["gravidade"]; mensagem: string; datas: string[]; semanal: boolean }>();
  for (const o of ocorrencias) {
    const k = `${o.gravidade}|${o.mensagem}`;
    if (!grupos.has(k)) grupos.set(k, { gravidade: o.gravidade, mensagem: o.mensagem, datas: [], semanal: !REGRAS_DO_DIA.has(o.regra) });
    grupos.get(k)!.datas.push(o.data);
  }
  return [...grupos.values()].map((g) => ({
    ...g,
    quando: `${g.semanal ? (g.datas.length > 1 ? "semanas de " : "semana de ") : ""}${g.datas.map(ddmm).join(", ")}`,
  }));
}

function ListaOcorrencias({ linhas }: { linhas: Array<{ nome: string; ocorrencias: Ocorrencia[] }> }) {
  const comProblema = linhas.filter((l) => l.ocorrencias.length);
  if (!comProblema.length) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> Escala dentro das regras neste mês.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">O que ajustar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {comProblema.map((l) => (
          <div key={l.nome}>
            <p className="text-sm font-medium">{l.nome}</p>
            <ul className="mt-1 space-y-0.5">
              {agrupar(l.ocorrencias).map((g, i) => (
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
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
