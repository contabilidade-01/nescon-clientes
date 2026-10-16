import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Gavel,
  Lock,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarraLote, type AtalhoDias } from "@/components/escala/BarraLote";
import { DiasFechados, EscolherAtividade, type EscolhaAtividade } from "@/components/escala/EscolherAtividade";
import { FeriadosLocais } from "@/components/escala/FeriadosLocais";
import { PainelCenarios } from "@/components/escala/PainelCenarios";
import { PainelContingente } from "@/components/escala/PainelContingente";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { MODOS_BLOQUEIO, motivoBloqueio, type ModoBloqueio } from "@/lib/escala/bloqueio";
import { avaliarEscalaAtual, simularCenarios, type ResultadoCenario } from "@/lib/escala/cenarios";
import { diaDaSemana } from "@/lib/escala/datas";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";
import type { Turno } from "@/lib/escala/modelos";
import {
  MODELOS,
  REGRAS_DO_DIA,
  ajustesEmLote,
  aplicarLote,
  type AcaoDia,
  avaliarPessoa,
  configEmpresaPadrao,
  configPadrao,
  definirCelula,
  diasDoMes,
  errosNovos,
  mesclarPlano,
  modeloPadraoDoMes,
  normalizarConfigEmpresa,
  proximaFolga,
  segundaFolga,
  trocarCelulas,
  type Ajustes,
  type ConfigEmpresa,
  type ConfigPessoa,
  type ModeloChave,
  type PlanoMes,
} from "@/lib/escala/planejamento";
import { SEGMENTOS, vigenciaEm } from "@/lib/escala/regras";
import type { Ocorrencia } from "@/lib/escala/validar";

const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const NOMES_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
/** Pares de folga do 5x2 fixo. */
const PARES_5X2: number[][] = [[6, 0], [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]];
/** O que mexe no desenho das folgas da pessoa e invalida os ajustes feitos à mão. */
const CAMPOS_DO_MODELO: Array<keyof ConfigPessoa> = ["modelo", "folga6x1", "folgas5x2", "turma", "folgaFixa", "rodizio", "semanasRodizio", "diaFechado"];

function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ddmm(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function nomeMes(mes: string) {
  const [a, m] = mes.split("-");
  return `${m}/${a}`;
}

function quando(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function abrev(d: number) {
  return NOMES_DIA[d].slice(0, 3).toLowerCase();
}

type Pessoa = { id: string; name: string };
type Aba = "cenarios" | "escala" | "contingente" | "regras";

/**
 * Planejador de escalas. O escritório passa `companyId` (simula qualquer cliente); no
 * portal ele fica vazio e a API usa a empresa da sessão.
 *
 * Rígido nas regras: arrastar, editar um dia, trocar o modelo ou o horário de alguém só
 * passa se não criar erro novo (domingo, duas folgas, jornada, interjornada, feriado), e
 * não se salva escala com erro. Flexível nas simulações: cenários prontos e variações
 * de folga, todos conferidos pelo mesmo motor.
 */
export function PlanejadorEscala({
  pessoas,
  regime12x36Padrao = false,
  companyId,
}: {
  pessoas: Pessoa[];
  regime12x36Padrao?: boolean;
  companyId?: string;
}) {
  const qc = useQueryClient();
  const chave = companyId || "minha";
  const [mes, setMes] = useState(mesAtual);
  const [cfg, setCfg] = useState<ConfigEmpresa>(configEmpresaPadrao);
  const [configs, setConfigs] = useState<ConfigPessoa[]>([]);
  const [ajustes, setAjustes] = useState<Ajustes>({});
  const [alterado, setAlterado] = useState(false);
  const [editando, setEditando] = useState<{ pessoa: ConfigPessoa; data: string } | null>(null);
  const [aba, setAba] = useState<Aba>("cenarios");
  const [variacao, setVariacao] = useState(0);
  const [cenarioAtual, setCenarioAtual] = useState<string | null>(null);
  const [horarios, setHorarios] = useState<Record<string, Turno>>({});
  // Edição em lote: pessoas e dias marcados.
  const [selPessoas, setSelPessoas] = useState<Set<string>>(new Set());
  const [selDias, setSelDias] = useState<Set<string>>(new Set());
  const [trocandoAtividade, setTrocandoAtividade] = useState(false);

  const configQuery = useQuery({
    queryKey: ["escala-config", chave],
    queryFn: () => api.escalas.config(companyId),
    retry: false,
  });
  const planosQuery = useQuery({
    queryKey: ["escala-planos", chave],
    queryFn: () => api.escalas.planos(companyId),
    retry: false,
  });
  const planoQuery = useQuery({
    queryKey: ["escala-plano", chave, mes],
    queryFn: () => api.escalas.plano(mes, companyId),
    retry: false,
  });

  useEffect(() => {
    if (configQuery.data) setCfg(normalizarConfigEmpresa(configQuery.data.dados));
  }, [configQuery.data]);

  // Modelo de quem entra sem escala salva: o que já nasce dentro da regra do mês.
  const modeloPadrao = modeloPadraoDoMes(mes, cfg.atividadeDefinida ? cfg.usa12x36 : regime12x36Padrao);
  const modeloPadraoRef = useRef(modeloPadrao);
  modeloPadraoRef.current = modeloPadrao;

  // Mês salvo (ou o modelo padrão) mesclado com o quadro atual de funcionários. Espera a
  // configuração da empresa para saber o modelo padrão (12x36 ou não).
  useEffect(() => {
    if (planoQuery.isLoading || configQuery.isLoading) return;
    const salvo = planoQuery.data?.dados as PlanoMes | undefined;
    const plano = mesclarPlano(salvo && Array.isArray(salvo.configs) ? salvo : null, pessoas, modeloPadraoRef.current);
    setConfigs(plano.configs);
    setAjustes(plano.ajustes);
    setAlterado(false);
    setCenarioAtual(null);
  }, [planoQuery.data, planoQuery.isLoading, configQuery.isLoading, pessoas]);

  const salvar = useMutation({
    mutationFn: async () => {
      await api.escalas.salvarConfig(cfg, companyId);
      const dados: PlanoMes = { configs, ajustes };
      return api.escalas.salvarPlano(mes, dados, companyId);
    },
    onSuccess: () => {
      setAlterado(false);
      toast.success(`Escala de ${nomeMes(mes)} salva.`);
      qc.invalidateQueries({ queryKey: ["escala-planos", chave] });
      qc.invalidateQueries({ queryKey: ["escala-config", chave] });
      qc.invalidateQueries({ queryKey: ["escala-plano", chave, mes] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar."),
  });

  const salvarAtividade = useMutation({
    mutationFn: (novo: ConfigEmpresa) => api.escalas.salvarConfig(novo, companyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["escala-config", chave] }),
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar a atividade."),
  });

  const excluir = useMutation({
    mutationFn: () => api.escalas.excluirPlano(mes, companyId),
    onSuccess: () => {
      toast.success(`Escala de ${nomeMes(mes)} excluída.`);
      qc.invalidateQueries({ queryKey: ["escala-planos", chave] });
      qc.invalidateQueries({ queryKey: ["escala-plano", chave, mes] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível excluir."),
  });

  function mudarCfg(patch: Partial<ConfigEmpresa>) {
    setCfg((c) => ({ ...c, ...patch }));
    setAlterado(true);
  }

  function trocarMes(novo: string) {
    if (novo === mes) return;
    if (alterado && !window.confirm("Há mudanças não salvas neste mês. Trocar de mês mesmo assim?")) return;
    setMes(novo);
  }

  const dias = useMemo(() => diasDoMes(mes), [mes]);
  // Os dias marcados são do mês aberto; trocar de mês desmarca.
  useEffect(() => setSelDias(new Set()), [mes]);
  const ultimoDia = dias[dias.length - 1];
  const vigencia = vigenciaEm(ultimoDia);

  const feriados = useMemo(() => {
    const ano = Number(dias[0].slice(0, 4));
    // O ano anterior entra porque a validação olha a semana que começa no fim de dezembro.
    return feriadosDaEmpresa([ano - 1, ano], cfg.feriadosLocais, cfg.incluirFacultativos);
  }, [dias, cfg.feriadosLocais, cfg.incluirFacultativos]);
  const feriadosSet = useMemo(() => new Set(feriados.keys()), [feriados]);
  const feriadosDoMes = [...feriados].filter(([d]) => d.startsWith(mes));

  const linhas = useMemo(
    () => configs.map((c) => avaliarPessoa(c, mes, ajustes, cfg, feriadosSet)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configs, mes, ajustes, feriadosSet, cfg.segmento, cfg.temAcordoColetivo],
  );

  const equipe = useMemo(() => configs.map((c) => ({ id: c.id, nome: c.nome })), [configs]);
  const equipeChave = equipe.map((p) => `${p.id}:${p.nome}`).join("|");
  const cenarios = useMemo(
    () => simularCenarios(equipe, mes, cfg, feriadosSet, variacao, horarios),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [equipeChave, mes, feriadosSet, variacao, horarios, cfg.segmento, cfg.temAcordoColetivo, cfg.bloqueio, cfg.demanda, cfg.diasFechados],
  );
  const escalaAtual = useMemo(
    () => avaliarEscalaAtual(configs, ajustes, mes, cfg, feriadosSet),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configs, ajustes, mes, feriadosSet, cfg.segmento, cfg.temAcordoColetivo, cfg.bloqueio, cfg.demanda, cfg.diasFechados],
  );

  function mudarHorario(id: string, t: Turno | null) {
    setHorarios((h) => {
      const novo = { ...h };
      if (t) novo[id] = t;
      else delete novo[id];
      return novo;
    });
  }

  const totalErros = linhas.reduce((a, l) => a + l.ocorrencias.filter((o) => o.gravidade === "erro").length, 0);
  const totalAvisos = linhas.reduce((a, l) => a + l.ocorrencias.filter((o) => o.gravidade === "atencao").length, 0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function turnoEm(pessoaId: string, data: string): Turno | null {
    return linhas.find((l) => l.config.id === pessoaId)?.dias.find((d) => d.data === data)?.turno ?? null;
  }

  function eh12x36(pessoaId: string) {
    return configs.find((c) => c.id === pessoaId)?.modelo === "12x36";
  }

  /** Bloqueio de jornada: recusa a mudança e diz por quê. true = pode seguir. */
  function liberado(pessoaId: string, turno: Turno | null): boolean {
    const motivo = motivoBloqueio(turno, cfg.bloqueio, eh12x36(pessoaId));
    if (!motivo) return true;
    const nome = configs.find((c) => c.id === pessoaId)?.nome || "";
    toast.error(`${nome}: ${motivo}`);
    return false;
  }

  /**
   * Trava das regras: aplica a mudança só se nenhuma das pessoas afetadas ganhar erro
   * novo. Erro que já existia (escala salva antes da emenda, por exemplo) não impede
   * mexer; impede só piorar.
   */
  function aplicarSeguro(novasConfigs: ConfigPessoa[], novosAjustes: Ajustes, afetados: string[]): boolean {
    for (const id of new Set(afetados)) {
      const antes = linhas.find((l) => l.config.id === id);
      const nova = novasConfigs.find((c) => c.id === id);
      if (!antes || !nova) continue;
      const depois = avaliarPessoa(nova, mes, novosAjustes, cfg, feriadosSet);
      const novos = errosNovos(antes.ocorrencias, depois.ocorrencias);
      if (novos.length) {
        toast.error(`${nova.nome}: mudança recusada`, {
          description: `${novos[0].mensagem} As regras de domingo, folgas e jornada estão travadas.`,
        });
        return false;
      }
    }
    setConfigs(novasConfigs);
    setAjustes(novosAjustes);
    setAlterado(true);
    setCenarioAtual(null);
    return true;
  }

  function aoSoltar(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const [pa, da] = String(e.active.id).split("|");
    const [pb, db] = String(e.over.id).split("|");
    const ta = turnoEm(pa, da);
    const tb = turnoEm(pb, db);
    // Cada pessoa recebe o turno da outra célula: confere o bloqueio de quem recebe.
    if (!liberado(pa, tb) || !liberado(pb, ta)) return;
    aplicarSeguro(configs, trocarCelulas(ajustes, { pessoa: pa, data: da, turno: ta }, { pessoa: pb, data: db, turno: tb }), [pa, pb]);
  }

  function atualizar(id: string, patch: Partial<ConfigPessoa>) {
    const atual = configs.find((c) => c.id === id);
    if (!atual) return;
    const nova = { ...atual, ...patch };
    const motivo = motivoBloqueio({ entrada: nova.entrada, saida: nova.saida, intervaloMin: nova.intervaloMin }, cfg.bloqueio, nova.modelo === "12x36");
    if (motivo) {
      toast.error(`${nova.nome}: ${motivo}`);
      return;
    }
    // Mudar o desenho das folgas descarta os ajustes da pessoa: eram em cima do anterior.
    const mudouModelo = CAMPOS_DO_MODELO.some((k) => k in patch);
    aplicarSeguro(
      configs.map((c) => (c.id === id ? nova : c)),
      mudouModelo ? { ...ajustes, [id]: {} } : ajustes,
      [id],
    );
  }

  function alternar<T>(set: Set<T>, v: T): Set<T> {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  }

  function atalhoDias(a: AtalhoDias) {
    if (a === "limpar") return setSelDias(new Set());
    const filtro = (d: string) => {
      const dow = diaDaSemana(d);
      if (a === "uteis") return dow >= 1 && dow <= 5;
      if (a === "sabados") return dow === 6;
      if (a === "domingos") return dow === 0;
      return true;
    };
    setSelDias(new Set(dias.filter(filtro)));
  }

  /** Aplica a edição em lote pessoa a pessoa, com a trava das regras, e diz quem ficou de fora. */
  function aplicarEmLote(ids: string[], mudar: Parameters<typeof aplicarLote>[3], rotulo: string) {
    const r = aplicarLote(configs, ajustes, ids, mudar, mes, cfg, feriadosSet);
    if (r.aceitos.length) {
      setConfigs(r.configs);
      setAjustes(r.ajustes);
      setAlterado(true);
      setCenarioAtual(null);
      toast.success(`${rotulo}: aplicado a ${r.aceitos.length} pessoa(s).`);
    }
    if (r.recusados.length) {
      toast.error(`Recusado para ${r.recusados.length} pessoa(s): ficariam fora da regra.`, {
        description: r.recusados
          .slice(0, 4)
          .map((x) => `${x.nome}: ${x.motivo}`)
          .join(" "),
        duration: 10000,
      });
    }
  }

  function loteDias(acao: AcaoDia) {
    const datas = [...selDias].sort();
    if (!datas.length) return toast.error("Marque os dias clicando no cabeçalho da grade.");
    const ids = selPessoas.size ? configs.filter((c) => selPessoas.has(c.id)).map((c) => c.id) : configs.map((c) => c.id);
    if (acao.tipo === "horario") {
      for (const id of ids) if (!liberado(id, acao.turno)) return;
    }
    const rotulo = acao.tipo === "folga" ? "Folga" : acao.tipo === "horario" ? `Horário ${acao.turno.entrada}–${acao.turno.saida}` : "Volta ao modelo";
    // Trocar o horário mexe só nos dias em que a pessoa trabalha: folga continua folga.
    const trabalhados = (id: string) => {
      const ds = linhas.find((l) => l.config.id === id)?.dias || [];
      return datas.filter((d) => ds.find((x) => x.data === d)?.turno);
    };
    aplicarEmLote(
      ids,
      (c, aj) => ({ config: c, ajustes: ajustesEmLote(aj, acao.tipo === "horario" ? trabalhados(c.id) : datas, acao) }),
      rotulo,
    );
  }

  function lotePessoas(patch: Partial<ConfigPessoa>) {
    const ids = configs.filter((c) => selPessoas.has(c.id)).map((c) => c.id);
    if (!ids.length) return toast.error("Marque as pessoas na caixa ao lado do nome.");
    const mudaModelo = CAMPOS_DO_MODELO.some((k) => k in patch);
    for (const id of ids) {
      const c = configs.find((x) => x.id === id)!;
      const n = { ...c, ...patch };
      const motivo = motivoBloqueio({ entrada: n.entrada, saida: n.saida, intervaloMin: n.intervaloMin }, cfg.bloqueio, n.modelo === "12x36");
      if (motivo) return toast.error(`${c.nome}: ${motivo}`);
    }
    // Trocando o modelo de várias pessoas, espalha folgas e turmas para não folgarem todas juntas.
    const posicao = new Map(ids.map((id, i) => [id, i]));
    aplicarEmLote(
      ids,
      (c, aj) => {
        const i = posicao.get(c.id) ?? 0;
        const espalha: Partial<ConfigPessoa> = mudaModelo
          ? { folgaFixa: (i % 6) + 1, rodizio: i, turma: i % 2 ? "B" : "A", diaFechado: c.diaFechado }
          : {};
        return { config: { ...c, ...espalha, ...patch }, ajustes: mudaModelo ? {} : aj };
      },
      patch.modelo ? `Modelo ${MODELOS[patch.modelo]}` : `Horário padrão ${patch.entrada}–${patch.saida}`,
    );
  }

  function aplicarCenario(c: ResultadoCenario) {
    setConfigs(c.configs);
    setAjustes({});
    setAlterado(true);
    setCenarioAtual(c.id);
    setAba("escala");
    toast.success(`Cenário aplicado: ${c.nome}.`, { description: "Ajuste na grade; o que sair da regra é recusado." });
  }

  function adicionarVaga() {
    const n = configs.filter((c) => c.id.startsWith("vaga-")).length + 1;
    const i = configs.length;
    setConfigs((cs) => [
      ...cs,
      { ...configPadrao(`vaga-${Date.now()}`, `Vaga simulada ${n}`, modeloPadrao), turma: i % 2 ? "B" : "A", folgaFixa: (i % 6) + 1, rodizio: i % 2 },
    ]);
    setAlterado(true);
  }

  function confirmarAtividade(e: EscolhaAtividade) {
    const novo: ConfigEmpresa = { ...cfg, ...e, atividadeDefinida: true };
    const mudou =
      !cfg.atividadeDefinida ||
      e.segmento !== cfg.segmento ||
      e.usa12x36 !== cfg.usa12x36 ||
      e.temAcordoColetivo !== cfg.temAcordoColetivo ||
      e.diasFechados.join() !== cfg.diasFechados.join();
    setCfg(novo);
    setTrocandoAtividade(false);
    if (mudou) {
      const modelo = modeloPadraoDoMes(mes, e.usa12x36);
      setConfigs((cs) =>
        cs.map((c, i) => ({ ...configPadrao(c.id, c.nome, modelo), turma: i % 2 ? "B" : "A", folgaFixa: (i % 6) + 1, rodizio: i % 2 })),
      );
      setAjustes({});
      setCenarioAtual(null);
      setAlterado(true);
      setAba("cenarios");
    }
    salvarAtividade.mutate(novo);
  }

  const atalhos = [
    { rotulo: "Mês atual", valor: mesAtual() },
    { rotulo: "Jan/2027 (42h)", valor: "2027-01" },
    { rotulo: "Jan/2028 (40h)", valor: "2028-01" },
  ];
  const salvos = planosQuery.data || [];
  const salvoEsteMes = salvos.find((p) => p.mes === mes);
  const pessoasPorDia = (d: string) => linhas.filter((l) => l.dias.find((x) => x.data === d)?.turno).length;
  const temDemanda = cfg.demanda.some((n) => n > 0);

  if (configQuery.isLoading) return <Skeleton className="h-64 w-full" />;

  if (!cfg.atividadeDefinida || trocandoAtividade) {
    return (
      <EscolherAtividade
        inicial={{
          segmento: cfg.segmento,
          temAcordoColetivo: cfg.temAcordoColetivo,
          usa12x36: cfg.atividadeDefinida ? cfg.usa12x36 : regime12x36Padrao,
          diasFechados: cfg.diasFechados,
        }}
        salvando={salvarAtividade.isPending}
        onConfirmar={confirmarAtividade}
        onCancelar={cfg.atividadeDefinida ? () => setTrocandoAtividade(false) : undefined}
      />
    );
  }

  const podeSalvar = totalErros === 0 && !salvar.isPending;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">Escala de {nomeMes(mes)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
              <Badge variant="secondary">{SEGMENTOS[cfg.segmento].nome}</Badge>
              <Badge variant="outline">{cfg.temAcordoColetivo ? "Com acordo coletivo" : "Sem acordo coletivo"}</Badge>
              {cfg.usa12x36 && <Badge variant="outline">Usa 12x36</Badge>}
              {cfg.diasFechados.length > 0 && (
                <Badge variant="outline">Fecha {cfg.diasFechados.map((d) => abrev(d)).join(", ")}</Badge>
              )}
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setTrocandoAtividade(true)}>
                <Pencil className="mr-1 h-3 w-3" /> Trocar atividade
              </Button>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={() => salvar.mutate()} disabled={!podeSalvar}>
              {totalErros ? <Lock className="mr-1.5 h-4 w-4" /> : <Save className="mr-1.5 h-4 w-4" />}
              {salvar.isPending ? "Salvando..." : `Salvar escala de ${nomeMes(mes)}`}
            </Button>
            {totalErros ? (
              <span className="text-xs text-destructive">Corrija {totalErros} erro(s) para salvar</span>
            ) : alterado ? (
              <Badge variant="secondary">Mudanças não salvas</Badge>
            ) : salvoEsteMes ? (
              <span className="text-xs text-muted-foreground">Salva em {quando(salvoEsteMes.atualizado_em)}</span>
            ) : (
              <span className="text-xs text-muted-foreground">Este mês ainda não foi salvo</span>
            )}
          </div>
        </div>
        <CardContent className="grid gap-4 p-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Mês planejado</Label>
            <Input type="month" value={mes} onChange={(e) => e.target.value && trocarMes(e.target.value)} />
            <div className="flex flex-wrap gap-1">
              {atalhos.map((a) => (
                <Button key={a.valor + a.rotulo} size="sm" variant={mes === a.valor ? "secondary" : "ghost"} className="h-6 px-2 text-xs" onClick={() => trocarMes(a.valor)}>
                  {a.rotulo}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              <Gavel className="h-3.5 w-3.5" /> Regra deste mês
            </Label>
            <p className="text-sm font-medium">{vigencia.nome}</p>
            <p className="text-xs text-muted-foreground">
              Até {vigencia.limiteSemanalHoras}h por semana e {vigencia.repousosSemanais} folga(s) semanal(is). Domingo de folga ao menos a cada{" "}
              {SEGMENTOS[cfg.segmento].domingoACadaSemanas} semanas.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Situação</Label>
            <div className="flex flex-wrap items-center gap-2">
              {totalErros ? (
                <Badge variant="destructive">
                  <XCircle className="mr-1 h-3 w-3" /> {totalErros} erro(s)
                </Badge>
              ) : (
                <Badge className="bg-emerald-600 hover:bg-emerald-600">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Dentro da lei
                </Badge>
              )}
              <Badge variant="secondary">{totalAvisos} aviso(s)</Badge>
              {salvoEsteMes && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-destructive"
                  disabled={excluir.isPending}
                  onClick={() => window.confirm(`Excluir a escala salva de ${nomeMes(mes)}?`) && excluir.mutate()}
                >
                  <Trash2 className="mr-1 h-3 w-3" /> Excluir mês salvo
                </Button>
              )}
            </div>
            {salvos.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="text-muted-foreground">Meses salvos:</span>
                {salvos.map((p) => (
                  <Button key={p.mes} size="sm" variant={p.mes === mes ? "secondary" : "ghost"} className="h-6 px-2 text-xs" onClick={() => trocarMes(p.mes)}>
                    {nomeMes(p.mes)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
        <div className="flex items-start gap-2 border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            Regras travadas: a grade recusa qualquer mudança que deixe alguém sem as {vigencia.repousosSemanais} folga(s) da semana, sem o domingo de
            folga no prazo, acima da jornada do dia, sem as 11h entre turnos ou trabalhando em feriado sem permissão. Os cenários variam à vontade
            dentro disso.
          </span>
        </div>
      </Card>

      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
          <TabsTrigger value="cenarios" className="gap-1.5">
            <Sparkles className="h-4 w-4" /> Cenários
          </TabsTrigger>
          <TabsTrigger value="escala" className="gap-1.5">
            <CalendarDays className="h-4 w-4" /> Escala do mês
            {totalErros > 0 && <span className="ml-1 rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">{totalErros}</span>}
          </TabsTrigger>
          <TabsTrigger value="contingente" className="gap-1.5">
            <Users className="h-4 w-4" /> Contingente
          </TabsTrigger>
          <TabsTrigger value="regras" className="gap-1.5">
            <Gavel className="h-4 w-4" /> Feriados e regras
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cenarios" className="mt-4">
          {configs.length === 0 ? (
            <SemEquipe onVaga={adicionarVaga} />
          ) : (
            <PainelCenarios
              cenarios={cenarios}
              escalaAtual={escalaAtual}
              demanda={cfg.demanda}
              emUso={cenarioAtual}
              onAplicar={aplicarCenario}
              onVariar={() => setVariacao((v) => v + 1)}
              onHorario={mudarHorario}
            />
          )}
        </TabsContent>

        <TabsContent value="escala" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={adicionarVaga}>
              <Plus className="mr-1 h-4 w-4" /> Vaga simulada
            </Button>
            <p className="text-xs text-muted-foreground">
              Arraste uma célula sobre outra para trocar (mesma pessoa move a folga; outra pessoa troca o turno). Clique para editar o dia; clique no
              cabeçalho do dia para marcar vários.
            </p>
          </div>

          {configs.length > 0 && (
            <BarraLote
              pessoas={selPessoas.size}
              totalPessoas={configs.length}
              dias={selDias.size}
              repousos={vigencia.repousosSemanais}
              onAtalho={atalhoDias}
              onLimparPessoas={() => setSelPessoas(new Set())}
              onDias={loteDias}
              onPessoas={lotePessoas}
            />
          )}

          {configs.length === 0 ? (
            <SemEquipe onVaga={adicionarVaga} />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <DndContext sensors={sensors} onDragEnd={aoSoltar}>
                  <table className="w-max border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 min-w-[280px] bg-card p-2 text-left font-medium">
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={selPessoas.size === configs.length ? true : selPessoas.size ? "indeterminate" : false}
                              onCheckedChange={(v) => setSelPessoas(v === true ? new Set(configs.map((c) => c.id)) : new Set())}
                              aria-label="Marcar todas as pessoas"
                            />
                            Pessoa e modelo
                          </label>
                        </th>
                        {dias.map((d) => {
                          const dow = diaDaSemana(d);
                          return (
                            <th
                              key={d}
                              title={`${feriados.get(d) || NOMES_DIA[dow]} · clique para marcar o dia`}
                              aria-pressed={selDias.has(d)}
                              onClick={() => setSelDias((s) => alternar(s, d))}
                              className={cn(
                                "w-11 cursor-pointer select-none rounded-t p-1 text-center font-normal hover:bg-primary/10",
                                dow === 0 && "border-l",
                                (dow === 0 || feriados.has(d)) && "text-primary font-semibold",
                                selDias.has(d) && "bg-primary text-primary-foreground hover:bg-primary/90",
                              )}
                            >
                              <div>{DIAS_SEMANA[dow]}</div>
                              <div>{d.slice(8)}</div>
                              {feriados.has(d) && <div className="text-[9px]">fer.</div>}
                            </th>
                          );
                        })}
                        <th className="p-2 text-right font-medium">Horas no mês</th>
                        <th className="p-2 text-right font-medium" title="Semana mais carregada que toca o mês, contra o limite da regra">
                          Maior semana
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map(({ config: c, dias: ds, porDia, ocorrencias, horas, maiorSemana, limiteSemana, semanaAcima }) => {
                        const erros = ocorrencias.filter((o) => o.gravidade === "erro").length;
                        return (
                          <tr key={c.id} className="border-t">
                            <td className="sticky left-0 z-10 bg-card p-2 align-top">
                              <LinhaConfig
                                c={c}
                                erros={erros}
                                repousos={vigencia.repousosSemanais}
                                selecionado={selPessoas.has(c.id)}
                                onSelecionar={() => setSelPessoas((s) => alternar(s, c.id))}
                                onChange={(p) => atualizar(c.id, p)}
                                onRemover={
                                  c.id.startsWith("vaga-")
                                    ? () => {
                                        setConfigs((cs) => cs.filter((x) => x.id !== c.id));
                                        setAlterado(true);
                                      }
                                    : undefined
                                }
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
                                marcado={selDias.has(d.data) && (selPessoas.size === 0 || selPessoas.has(c.id))}
                                onClick={() => setEditando({ pessoa: c, data: d.data })}
                              />
                            ))}
                            <td className="p-2 text-right tabular-nums">{horas.toFixed(1).replace(".", ",")}h</td>
                            <td
                              className={cn(
                                "p-2 text-right tabular-nums",
                                semanaAcima === "erro" && "bg-destructive/15 font-semibold text-destructive",
                                semanaAcima === "atencao" && "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
                              )}
                              title={`Limite: ${limiteSemana}h`}
                            >
                              {maiorSemana.toFixed(1).replace(".", ",")}h
                              <span className="block text-[10px] font-normal opacity-70">de {limiteSemana}h</span>
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t bg-muted/40">
                        <td className="sticky left-0 z-10 bg-muted p-2 font-medium">Pessoas trabalhando</td>
                        {dias.map((d) => {
                          const n = pessoasPorDia(d);
                          const falta = temDemanda && n < cfg.demanda[diaDaSemana(d)];
                          return (
                            <td
                              key={d}
                              className={cn("p-1 text-center tabular-nums", diaDaSemana(d) === 0 && "border-l", falta && "font-semibold text-destructive")}
                            >
                              {n}
                            </td>
                          );
                        })}
                        <td />
                        <td />
                      </tr>
                      {temDemanda && (
                        <tr className="bg-muted/40">
                          <td className="sticky left-0 z-10 bg-muted p-2 text-muted-foreground">Necessário (demanda)</td>
                          {dias.map((d) => (
                            <td key={d} className={cn("p-1 text-center tabular-nums text-muted-foreground", diaDaSemana(d) === 0 && "border-l")}>
                              {cfg.demanda[diaDaSemana(d)]}
                            </td>
                          ))}
                          <td />
                          <td />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </DndContext>
              </CardContent>
            </Card>
          )}

          <ListaOcorrencias linhas={linhas.map((l) => ({ nome: l.config.nome, ocorrencias: l.ocorrencias }))} />
        </TabsContent>

        <TabsContent value="contingente" className="mt-4">
          <PainelContingente
            demanda={cfg.demanda}
            horasPorDia={cfg.horasPorDia}
            salarioMedio={cfg.salarioMedio}
            quadroAtual={configs.length}
            onChange={(p) => mudarCfg(p)}
          />
        </TabsContent>

        <TabsContent value="regras" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-base">
                  <Lock className="h-4 w-4" /> Travas da empresa
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={cfg.temAcordoColetivo} onCheckedChange={(v) => mudarCfg({ temAcordoColetivo: v })} />
                  Tem acordo/convenção coletiva de compensação
                </label>
                <div className="space-y-1.5">
                  <Label>Dias em que a casa fecha</Label>
                  <DiasFechados valor={cfg.diasFechados} onChange={(d) => mudarCfg({ diasFechados: d })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Bloqueio de jornada diária</Label>
                  <Select value={cfg.bloqueio} onValueChange={(v) => mudarCfg({ bloqueio: v as ModoBloqueio })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(MODOS_BLOQUEIO) as ModoBloqueio[]).map((m) => (
                        <SelectItem key={m} value={m}>
                          {MODOS_BLOQUEIO[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Com bloqueio, o sistema recusa o horário que passa do limite do dia.</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-base">
                  <ShieldCheck className="h-4 w-4" /> O que a grade não deixa fazer
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                  <li>Menos de {vigencia.repousosSemanais} folga(s) na semana{cfg.temAcordoColetivo ? " (com acordo, pela média do mês)" : ""}.</li>
                  <li>Passar de {SEGMENTOS[cfg.segmento].domingoACadaSemanas} semanas sem folga no domingo.</li>
                  <li>Mais de 6 dias seguidos de trabalho e menos de 11h entre um turno e outro.</li>
                  <li>Jornada acima do teto do dia e intervalo menor que o mínimo.</li>
                  <li>{SEGMENTOS[cfg.segmento].feriadoExigeConvencao ? "Trabalho em feriado sem convenção coletiva." : "Feriado trabalhado vira aviso de pagamento em dobro ou folga."}</li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Feriados</CardTitle>
              <p className="text-xs text-muted-foreground">
                Os feriados nacionais já entram sozinhos e nascem de folga na escala. Inclua aqui os municipais e estaduais da empresa.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <FeriadosLocais feriados={cfg.feriadosLocais} onChange={(f) => mudarCfg({ feriadosLocais: f })} />
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={cfg.incluirFacultativos} onCheckedChange={(v) => mudarCfg({ incluirFacultativos: v })} />
                Tratar Carnaval e Corpus Christi como feriado (são ponto facultativo nacional)
              </label>
              <p className="text-xs text-muted-foreground">
                Neste mês: {feriadosDoMes.length ? feriadosDoMes.map(([d, n]) => `${ddmm(d)} ${n}`).join(" · ") : "nenhum feriado"}
              </p>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Regras conforme o texto da EC 141/2026 publicado no DOU de 16/10/2026: 42h e duas folgas a partir de 16/12/2026, 40h a partir de
            16/12/2027. O domingo é preferencial; o mínimo de domingos segue a lei de cada segmento.
          </p>
        </TabsContent>
      </Tabs>

      {editando && (
        <EditarDia
          nome={editando.pessoa.nome}
          data={editando.data}
          feriado={feriados.get(editando.data)}
          turno={turnoEm(editando.pessoa.id, editando.data)}
          padrao={{ entrada: editando.pessoa.entrada, saida: editando.pessoa.saida, intervaloMin: editando.pessoa.intervaloMin }}
          onFechar={() => setEditando(null)}
          onSalvar={(t) => {
            if (!liberado(editando.pessoa.id, t)) return;
            if (aplicarSeguro(configs, definirCelula(ajustes, editando.pessoa.id, editando.data, t), [editando.pessoa.id])) setEditando(null);
          }}
        />
      )}
    </div>
  );
}

function SemEquipe({ onVaga }: { onVaga: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
        Nenhum funcionário ativo nesta empresa. Acrescente vagas simuladas para montar a escala mesmo assim.
        <Button variant="outline" size="sm" onClick={onVaga}>
          <Plus className="mr-1 h-4 w-4" /> Vaga simulada
        </Button>
      </CardContent>
    </Card>
  );
}

const sel = "h-7 rounded border bg-background px-1";

function LinhaConfig({
  c,
  erros,
  repousos,
  selecionado,
  onSelecionar,
  onChange,
  onRemover,
}: {
  c: ConfigPessoa;
  erros: number;
  repousos: number;
  selecionado: boolean;
  onSelecionar: () => void;
  onChange: (p: Partial<ConfigPessoa>) => void;
  onRemover?: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Checkbox checked={selecionado} onCheckedChange={onSelecionar} aria-label={`Marcar ${c.nome}`} />
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
          className={sel}
          value={c.modelo}
          onChange={(e) => {
            const modelo = e.target.value as ModeloChave;
            const p = configPadrao(c.id, c.nome, modelo);
            onChange({ modelo, entrada: p.entrada, saida: p.saida });
          }}
          aria-label="Modelo de escala"
        >
          {(Object.keys(MODELOS) as ModeloChave[]).map((m) => (
            <option key={m} value={m} disabled={m === "6x1" && repousos > 1 && c.modelo !== "6x1"}>
              {MODELOS[m]}
              {m === "6x1" && repousos > 1 ? " (proibida)" : ""}
            </option>
          ))}
        </select>
        <input type="time" className={sel} value={c.entrada} onChange={(e) => onChange({ entrada: e.target.value })} aria-label="Entrada" />
        <input type="time" className={sel} value={c.saida} onChange={(e) => onChange({ saida: e.target.value })} aria-label="Saída" />
        <input
          type="number"
          min={0}
          step={15}
          className={cn(sel, "w-14")}
          value={c.intervaloMin}
          onChange={(e) => onChange({ intervaloMin: Math.max(0, Number(e.target.value) || 0) })}
          aria-label="Intervalo em minutos"
          title="Intervalo (min)"
        />
        {c.modelo === "6x1" && (
          <select className={sel} value={c.folga6x1} onChange={(e) => onChange({ folga6x1: Number(e.target.value) })} aria-label="Dia da folga">
            {NOMES_DIA.map((n, i) => (
              <option key={n} value={i}>
                Folga {abrev(i)}
              </option>
            ))}
          </select>
        )}
        {c.modelo === "5x2" && (
          <select
            className={sel}
            value={c.folgas5x2.join(",")}
            onChange={(e) => onChange({ folgas5x2: e.target.value.split(",").map(Number) })}
            aria-label="Dias de folga"
          >
            {PARES_5X2.map((p) => (
              <option key={p.join(",")} value={p.join(",")}>
                Folga {abrev(p[0])}+{abrev(p[1])}
              </option>
            ))}
          </select>
        )}
        {c.modelo === "5x2_fechado" && (
          <>
            <select className={sel} value={c.diaFechado} onChange={(e) => onChange({ diaFechado: Number(e.target.value) })} aria-label="Dia em que a casa fecha">
              {NOMES_DIA.map((n, i) => (
                <option key={n} value={i}>
                  Fecha {abrev(i)}
                </option>
              ))}
            </select>
            <select
              className={sel}
              value={segundaFolga(c.diaFechado, c.folgaFixa)}
              onChange={(e) => onChange({ folgaFixa: Number(e.target.value) })}
              aria-label="Segunda folga"
            >
              {[1, 2, 3, 4, 5, 6]
                .filter((d) => d !== c.diaFechado)
                .map((d) => (
                  <option key={d} value={d}>
                    + folga {abrev(d)}
                  </option>
                ))}
            </select>
            {c.diaFechado !== 0 && (
              <>
                <select
                  className={sel}
                  value={c.semanasRodizio}
                  onChange={(e) => onChange({ semanasRodizio: Number(e.target.value), rodizio: 0 })}
                  aria-label="Domingo de folga a cada"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "Dom. toda semana" : `Dom. a cada ${n} sem.`}
                    </option>
                  ))}
                </select>
                {c.semanasRodizio > 1 && (
                  <select className={sel} value={c.rodizio % c.semanasRodizio} onChange={(e) => onChange({ rodizio: Number(e.target.value) })} aria-label="Grupo do rodízio">
                    {Array.from({ length: c.semanasRodizio }, (_, i) => (
                      <option key={i} value={i}>
                        Grupo {i + 1}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
          </>
        )}
        {(c.modelo === "5x2_rev" || c.modelo === "4x3") && (
          <select className={sel} value={c.folgaFixa} onChange={(e) => onChange({ folgaFixa: Number(e.target.value) })} aria-label="Folga da semana">
            {[1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {c.modelo === "4x3" ? `Folga dom+${abrev(d)}+${abrev(proximaFolga(d))}` : `Folga ${abrev(d)}`}
              </option>
            ))}
          </select>
        )}
        {c.modelo === "5x2_rev" && (
          <>
            <select
              className={sel}
              value={c.semanasRodizio}
              onChange={(e) => onChange({ semanasRodizio: Number(e.target.value), rodizio: 0 })}
              aria-label="Domingo de folga a cada"
            >
              <option value={2}>Dom. a cada 2 sem.</option>
              <option value={3}>Dom. a cada 3 sem.</option>
            </select>
            <select className={sel} value={c.rodizio % c.semanasRodizio} onChange={(e) => onChange({ rodizio: Number(e.target.value) })} aria-label="Grupo do rodízio">
              {Array.from({ length: c.semanasRodizio }, (_, i) => (
                <option key={i} value={i}>
                  Grupo {i + 1}
                </option>
              ))}
            </select>
          </>
        )}
        {c.modelo === "12x36" && (
          <select className={sel} value={c.turma} onChange={(e) => onChange({ turma: e.target.value as "A" | "B" })} aria-label="Turma">
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
  marcado,
  onClick,
}: {
  id: string;
  turno: Turno | null;
  domingo: boolean;
  gravidade?: "erro" | "atencao";
  ajustado: boolean;
  marcado: boolean;
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
          marcado && "ring-2 ring-primary ring-offset-1 ring-offset-background",
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
