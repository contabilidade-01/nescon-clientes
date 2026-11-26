import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ChevronLeft,
  ChevronRight,
  Settings2,
  CheckCircle2,
  Gavel,
  Lock,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  Wand2,
  Bot,
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
import { BarraLote, type AtalhoDias, type MarcarPessoas } from "@/components/escala/BarraLote";
import { DialogoPessoa } from "@/components/escala/DialogoPessoa";
import { agruparOcorrencias } from "@/lib/escala/ocorrencias";
import { DiasFechados, EscolherAtividade, type EscolhaAtividade } from "@/components/escala/EscolherAtividade";
import { FeriadosLocais } from "@/components/escala/FeriadosLocais";
import { PainelCenarios } from "@/components/escala/PainelCenarios";
import { PainelContingente } from "@/components/escala/PainelContingente";
import { PainelDistribuicao } from "@/components/escala/PainelDistribuicao";
import { PainelAssistente } from "@/components/escala/PainelAssistente";
import type { EstadoEscala } from "@/lib/escala/assistenteFerramentas";
import { PainelPorPessoa } from "@/components/escala/PainelPorPessoa";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { MODOS_BLOQUEIO, motivoBloqueio, type ModoBloqueio } from "@/lib/escala/bloqueio";
import { avaliarEscalaAtual, simularCenarios, type ResultadoCenario } from "@/lib/escala/cenarios";
import { diaDaSemana, somarDias } from "@/lib/escala/datas";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";
import type { Turno } from "@/lib/escala/modelos";
import {
  MODELOS,
  fraseDaPessoa,
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
  trocarCelulas,
  ultimoDiaDa6x1,
  unidadesDa,
  type Ajustes,
  type CadastroJornada,
  type ConfigEmpresa,
  type ConfigPessoa,
  type PlanoMes,
} from "@/lib/escala/planejamento";
import { CaminhoGuiado } from "@/components/escala/CaminhoGuiado";
import { BotoesBaixar } from "@/components/escala/BotoesBaixar";
import { baixarEscalaPdf, baixarEscalaXlsx, type EscalaExportada } from "@/lib/escala/exportarEscala";
import { SEGMENTOS, VIGENCIAS, mesInicialDaSimulacao, viradaNoMes, vigenciaEm } from "@/lib/escala/regras";
import type { Ocorrencia } from "@/lib/escala/validar";

const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const NOMES_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
/** O que mexe no desenho das folgas da pessoa e invalida os ajustes feitos à mão. */
const CAMPOS_DO_MODELO: Array<keyof ConfigPessoa> = ["modelo", "folga6x1", "seisPorUmAteVirada", "folgas5x2", "turma", "folgaFixa", "rodizio", "semanasRodizio", "diaFechado"];

function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Abre na próxima etapa da emenda (dez/2026, depois dez/2027); passadas as duas, no mês de hoje. */
function mesInicial(): string {
  return mesInicialDaSimulacao(`${mesAtual()}-${String(new Date().getDate()).padStart(2, "0")}`);
}

function dataBR(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
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

/** "08:00" vira "08" na célula, para o mês caber na tela; "16:20" fica inteiro. */
function horaCurta(hhmm: string) {
  return hhmm.endsWith(":00") ? hhmm.slice(0, 2) + "h" : hhmm;
}

function abrev(d: number) {
  return NOMES_DIA[d].slice(0, 3).toLowerCase();
}

type Pessoa = { id: string; name: string; cadastro?: CadastroJornada };
/** Simples: caminho guiado em 3 passos. Avançado: as abas completas (grade, contingente…). */
type Modo = "simples" | "avancado";
type Aba = "cenarios" | "automatica" | "assistente" | "escala" | "pessoa" | "contingente" | "regras";

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
  empresaNome,
}: {
  pessoas: Pessoa[];
  regime12x36Padrao?: boolean;
  /** Vai no cabeçalho e no nome do arquivo baixado. */
  empresaNome?: string;
  companyId?: string;
}) {
  const qc = useQueryClient();
  const chave = companyId || "minha";
  const [mes, setMes] = useState(mesInicial);
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
  // Simulação por funcionário: a pessoa aberta.
  const [foco, setFoco] = useState<string | null>(null);
  // Caixa de personalização de um funcionário (clique no nome).
  const [aberta, setAberta] = useState<string | null>(null);
  /** Filtro da grade por unidade (loja/filial com o mesmo CNPJ); "" = todas. */
  const [unidade, setUnidade] = useState("");
  // O cliente começa no caminho guiado; o escritório, nas abas completas. A escolha fica no navegador.
  const chaveModo = `escala-modo-${companyId ? "escritorio" : "portal"}`;
  const [modo, setModoEstado] = useState<Modo>(() => {
    const salvo = typeof localStorage !== "undefined" ? localStorage.getItem(chaveModo) : null;
    return salvo === "simples" || salvo === "avancado" ? salvo : companyId ? "avancado" : "simples";
  });
  function setModo(m: Modo) {
    setModoEstado(m);
    try {
      localStorage.setItem(chaveModo, m);
    } catch {
      /* navegador sem armazenamento: vale só nesta visita */
    }
  }

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

  // O caminho guiado decide o passo inicial pela configuração: espera ela chegar ao estado.
  const [cfgPronta, setCfgPronta] = useState(false);
  useEffect(() => {
    if (configQuery.data) setCfg(normalizarConfigEmpresa(configQuery.data.dados));
    if (!configQuery.isLoading) setCfgPronta(true);
  }, [configQuery.data, configQuery.isLoading]);

  // Modelo de quem entra sem escala salva: o que já nasce dentro da regra do mês.
  const modeloPadrao = modeloPadraoDoMes(mes, cfg.atividadeDefinida ? cfg.usa12x36 : regime12x36Padrao);

  // Mês salvo (ou o modelo padrão) mesclado com o quadro atual de funcionários. Espera a
  // configuração da empresa para saber o modelo padrão (12x36 ou não).
  // O modelo padrão sai da configuração CARREGADA, não do estado `cfg`: os dois efeitos
  // rodam no mesmo ciclo e o `cfg` ainda estaria no padrão (empresa 12x36 abria em 5x2).
  const cfgCarregada = configQuery.data ? normalizarConfigEmpresa(configQuery.data.dados) : null;
  const usa12x36Carregado = cfgCarregada?.atividadeDefinida ? cfgCarregada.usa12x36 : regime12x36Padrao;
  useEffect(() => {
    if (planoQuery.isLoading || configQuery.isLoading) return;
    const salvo = planoQuery.data?.dados as PlanoMes | undefined;
    const plano = mesclarPlano(salvo && Array.isArray(salvo.configs) ? salvo : null, pessoas, modeloPadraoDoMes(mes, usa12x36Carregado), {
      permite6x1: vigenciaEm(diasDoMes(mes).at(-1)!).repousosSemanais < 2,
      temAcordo: Boolean(cfgCarregada?.temAcordoColetivo),
    });
    setConfigs(plano.configs);
    setAjustes(plano.ajustes);
    setAlterado(false);
    setCenarioAtual(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planoQuery.data, planoQuery.isLoading, configQuery.isLoading, pessoas, usa12x36Carregado]);

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
  // Mês em que uma etapa da emenda começa no meio (16/12): a regra muda nesse dia.
  const virada = viradaNoMes(mes);
  const anterior = virada ? vigenciaEm(`${mes}-01`) : null;
  const viradaComFolgas = Boolean(virada && anterior && virada.repousosSemanais > anterior.repousosSemanais);

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

  // Rolagem lateral da grade: setas por semana e "arrastar para o lado" pelo cabeçalho ou
  // pelo fundo (as células continuam sendo do arrastar e soltar).
  const gradeRef = useRef<HTMLDivElement>(null);
  const [rolagem, setRolagem] = useState({ temMais: false, esquerda: false, direita: false });
  const medirRolagem = useCallback(() => {
    const el = gradeRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setRolagem({ temMais: max > 2, esquerda: el.scrollLeft > 2, direita: el.scrollLeft < max - 2 });
  }, []);
  useEffect(() => {
    const el = gradeRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medirRolagem);
    ro.observe(el);
    medirRolagem();
    return () => ro.disconnect();
  }, [aba, configs.length, mes, medirRolagem]);
  function rolar(direcao: 1 | -1) {
    const el = gradeRef.current;
    if (!el) return;
    const dia = el.querySelector<HTMLElement>("thead th:nth-child(2)")?.offsetWidth || 40;
    el.scrollBy({ left: direcao * dia * 7, behavior: "smooth" });
  }
  function iniciarPan(e: React.PointerEvent<HTMLDivElement>) {
    const el = gradeRef.current;
    const alvo = e.target as HTMLElement;
    if (!el || e.button !== 0 || alvo.closest("button, input, select, label, [role=checkbox], [data-sem-pan]")) return;
    const x0 = e.clientX;
    const s0 = el.scrollLeft;
    let moveu = false;
    el.style.scrollBehavior = "auto";
    const mover = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 4) moveu = true;
      if (moveu) {
        el.scrollLeft = s0 - dx;
        el.style.cursor = "grabbing";
      }
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      el.style.scrollBehavior = "";
      el.style.cursor = "";
      // Arrastou: o clique que vem junto não marca o dia do cabeçalho.
      if (moveu) {
        const engolir = (ev: MouseEvent) => ev.stopPropagation();
        el.addEventListener("click", engolir, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", engolir, { capture: true }), 0);
      }
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

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

  function atualizar(id: string, patch: Partial<ConfigPessoa>): boolean {
    const atual = configs.find((c) => c.id === id);
    if (!atual) return false;
    const nova = { ...atual, ...patch };
    const motivo = motivoBloqueio({ entrada: nova.entrada, saida: nova.saida, intervaloMin: nova.intervaloMin }, cfg.bloqueio, nova.modelo === "12x36");
    if (motivo) {
      toast.error(`${nova.nome}: ${motivo}`);
      return false;
    }
    // Mudar o desenho das folgas descarta os ajustes da pessoa: eram em cima do anterior.
    const mudouModelo = CAMPOS_DO_MODELO.some((k) => k in patch);
    return aplicarSeguro(
      configs.map((c) => (c.id === id ? nova : c)),
      mudouModelo ? { ...ajustes, [id]: {} } : ajustes,
      [id],
    );
  }

  /** Muda dias de uma pessoa só (caixa do funcionário), com bloqueio e trava das regras. */
  function diasDaPessoa(id: string, datas: string[], acao: AcaoDia): boolean {
    if (!datas.length) return false;
    if (acao.tipo === "horario" && !liberado(id, acao.turno)) return false;
    const ok = aplicarSeguro(configs, { ...ajustes, [id]: ajustesEmLote(ajustes[id] || {}, datas, acao) }, [id]);
    if (ok) toast.success(`${acao.tipo === "folga" ? "Folga" : acao.tipo === "horario" ? `Horário ${acao.turno.entrada}–${acao.turno.saida}` : "Volta ao modelo"} em ${datas.length} dia(s).`);
    return ok;
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

  function marcarPessoas(filtro: MarcarPessoas) {
    if (filtro === "nenhuma") return setSelPessoas(new Set());
    const passa = (c: ConfigPessoa) =>
      filtro === "todas" ? true : filtro === "turmaA" ? c.modelo === "12x36" && c.turma === "A" : filtro === "turmaB" ? c.modelo === "12x36" && c.turma === "B" : c.modelo === filtro;
    setSelPessoas(new Set(configs.filter(passa).map((c) => c.id)));
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
    // Sem pessoa marcada, vale para todos (como nos dias).
    const ids = selPessoas.size ? configs.filter((c) => selPessoas.has(c.id)).map((c) => c.id) : configs.map((c) => c.id);
    if (!ids.length) return toast.error("Nenhuma pessoa na escala.");
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

  // Assistente de IA: aplica na tela o que as ferramentas mudaram e grava quando pedido.
  function aplicarEstadoDaIa(e: EstadoEscala) {
    setConfigs(e.configs);
    setAjustes(e.ajustes);
    setCfg(e.cfg);
    setCenarioAtual(null);
    setAlterado(true);
  }

  async function salvarPelaIa(e: EstadoEscala) {
    await api.escalas.salvarConfig(e.cfg, companyId);
    await api.escalas.salvarPlano(e.mes, { configs: e.configs, ajustes: e.ajustes } as PlanoMes, companyId);
    setAlterado(false);
    toast.success(`Escala de ${nomeMes(e.mes)} salva pelo assistente.`);
    qc.invalidateQueries({ queryKey: ["escala-planos", chave] });
    qc.invalidateQueries({ queryKey: ["escala-config", chave] });
    qc.invalidateQueries({ queryKey: ["escala-plano", chave, e.mes] });
  }

  function aplicarCenario(c: ResultadoCenario, ficarNaTela = false) {
    setConfigs(c.configs);
    setAjustes({});
    setAlterado(true);
    setCenarioAtual(c.id);
    if (ficarNaTela) {
      toast.success("Escala escolhida. Confira a semana de cada pessoa e salve.");
      return;
    }
    setAba("escala");
    toast.success(`Cenário aplicado: ${c.nome}.`, { description: "Ajuste na grade; o que sair da regra é recusado." });
  }

  function adicionarVaga() {
    const n = configs.filter((c) => c.id.startsWith("vaga-")).length + 1;
    const i = configs.length;
    setConfigs((cs) => [
      ...cs,
      {
        ...configPadrao(`vaga-${Date.now()}`, `Vaga simulada ${n}`, modeloPadrao),
        turma: i % 2 ? "B" : "A",
        folgaFixa: (i % 6) + 1,
        rodizio: i % 2,
        unidade: filtroUnidade || undefined,
      },
    ]);
    setAlterado(true);
  }

  function confirmarAtividade(e: EscolhaAtividade) {
    const novo: ConfigEmpresa = {
      ...cfg,
      ...e,
      atividadeDefinida: true,
      // Quem confirma pelo painel do escritório responde pelo cliente: some o "Não sei".
      atividadePeloEscritorio: Boolean(companyId) || cfg.atividadePeloEscritorio,
      naoSabe: companyId ? [] : cfg.naoSabe,
    };
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

  /**
   * Passo 1 do caminho guiado: grava a empresa sem refazer a escala de ninguém (quem já
   * veio do cadastro continua igual; as sugestões do passo 3 é que trocam a equipe toda).
   */
  function confirmarEmpresaGuiada(patch: Partial<ConfigEmpresa>) {
    const novo: ConfigEmpresa = { ...cfg, ...patch, atividadeDefinida: true };
    if (companyId) {
      novo.atividadePeloEscritorio = true;
      novo.naoSabe = [];
    }
    const mudou12x36 = cfg.atividadeDefinida ? novo.usa12x36 !== cfg.usa12x36 : novo.usa12x36 !== regime12x36Padrao;
    setCfg(novo);
    if (mudou12x36) {
      const modelo = modeloPadraoDoMes(mes, novo.usa12x36);
      setConfigs((cs) => cs.map((c, i) => ({ ...configPadrao(c.id, c.nome, modelo), turma: i % 2 ? "B" : "A", folgaFixa: (i % 6) + 1, rodizio: i % 2 })));
      setAjustes({});
      setCenarioAtual(null);
      setAlterado(true);
    }
    salvarAtividade.mutate(novo);
  }

  // As datas da emenda: cada etapa abre no mês em que começa.
  const atalhos = [
    { rotulo: "Hoje", valor: mesAtual() },
    ...VIGENCIAS.slice(1).map((v, i) => ({ rotulo: `Etapa ${i + 1}: ${dataBR(v.inicio)} (${v.limiteSemanalHoras}h)`, valor: v.inicio.slice(0, 7) })),
  ];
  const salvos = planosQuery.data || [];
  const salvoEsteMes = salvos.find((p) => p.mes === mes);
  const unidades = unidadesDa(configs);
  const filtroUnidade = unidade && unidades.includes(unidade) ? unidade : "";
  /** Linhas da grade: a equipe toda ou só a unidade escolhida. As regras são por pessoa, então não mudam. */
  const linhasVisiveis = filtroUnidade ? linhas.filter((l) => l.config.unidade === filtroUnidade) : linhas;
  const pessoasPorDia = (d: string) => linhasVisiveis.filter((l) => l.dias.find((x) => x.data === d)?.turno).length;
  const temDemanda = cfg.demanda.some((n) => n > 0);

  if (configQuery.isLoading || !cfgPronta) return <Skeleton className="h-64 w-full" />;

  // No portal, atividade e acordo marcados pelo escritório ficam só para leitura.
  const travadoPeloEscritorio = !companyId && cfg.atividadeDefinida && cfg.atividadePeloEscritorio;

  if (trocandoAtividade || (!cfg.atividadeDefinida && modo === "avancado")) {
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

  const regraFrase =
    virada && anterior
      ? `A partir de ${dataBR(virada.inicio)}: no máximo ${virada.limiteSemanalHoras}h por semana e ${virada.repousosSemanais} folgas para cada pessoa.`
      : `Neste mês: no máximo ${vigencia.limiteSemanalHoras}h por semana e ${vigencia.repousosSemanais === 1 ? "1 folga" : `${vigencia.repousosSemanais} folgas`} para cada pessoa.`;

  /** A escala que está na tela (salva ou só simulada), para baixar em PDF ou Excel. */
  function baixar(tipo: "pdf" | "xlsx") {
    if (!linhasVisiveis.length) return toast.error("Não há ninguém na escala para baixar.");
    const escala: EscalaExportada = {
      mes,
      empresa: [empresaNome, filtroUnidade && `Unidade ${filtroUnidade}`].filter(Boolean).join(" · ") || undefined,
      regra: regraFrase,
      pessoas: linhasVisiveis.map((l) => ({ nome: l.config.nome, descricao: fraseDaPessoa(l.config), dias: l.dias, doze36: l.config.modelo === "12x36" })),
      feriados: new Map(feriadosDoMes),
      erros: filtroUnidade
        ? linhasVisiveis.reduce((a, l) => a + l.ocorrencias.filter((o) => o.gravidade === "erro").length, 0)
        : totalErros,
    };
    try {
      if (tipo === "pdf") baixarEscalaPdf(escala);
      else baixarEscalaXlsx(escala);
    } catch (e) {
      toast.error("Não foi possível gerar o arquivo.", { description: (e as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">Escala de {nomeMes(mes)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
              {cfg.atividadeDefinida && (
                <>
                  <Badge variant="secondary">{SEGMENTOS[cfg.segmento].nome}</Badge>
                  <Badge variant="outline">{cfg.temAcordoColetivo ? "Com acordo coletivo" : "Sem acordo coletivo"}</Badge>
                  {cfg.usa12x36 && <Badge variant="outline">Usa 12x36</Badge>}
                  <Badge variant="outline">{cfg.abreNosFeriados ? "Abre nos feriados" : "Fecha nos feriados"}</Badge>
                  {cfg.diasFechados.length > 0 && (
                    <Badge variant="outline">Fecha {cfg.diasFechados.map((d) => abrev(d)).join(", ")}</Badge>
                  )}
                </>
              )}
              {companyId && cfg.atividadeDefinida && !cfg.atividadePeloEscritorio && (
                <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">
                  Marcado pelo cliente{cfg.naoSabe.length ? ` (não soube: ${cfg.naoSabe.map((x) => (x === "acordo" ? "acordo coletivo" : x)).join(" e ")})` : ""}: confira
                </Badge>
              )}
              {modo === "avancado" && !travadoPeloEscritorio && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setTrocandoAtividade(true)}>
                  <Pencil className="mr-1 h-3 w-3" /> {companyId ? "Confirmar atividade" : "Trocar atividade"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setModo(modo === "simples" ? "avancado" : "simples")}
              >
                <Settings2 className="mr-1 h-3 w-3" /> {modo === "simples" ? "Modo avançado" : "Voltar ao modo simples"}
              </Button>
            </div>
          </div>
          {/* No caminho guiado, salvar e situação ficam no passo 3. */}
          {modo === "avancado" && (
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
            <BotoesBaixar onBaixar={baixar} />
          </div>
          )}
        </div>
        {unidades.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t px-4 pt-3" role="group" aria-label="Unidade">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Unidade:</span>
            {["", ...unidades].map((u) => {
              const n = u ? configs.filter((c) => c.unidade === u).length : configs.length;
              return (
                <Button
                  key={u || "todas"}
                  size="sm"
                  variant={filtroUnidade === u ? "default" : "outline"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setUnidade(u)}
                  aria-pressed={filtroUnidade === u}
                >
                  {u || "Todas"} ({n})
                </Button>
              );
            })}
            <span className="text-[11px] text-muted-foreground">
              A grade, a contagem de pessoas por dia e o PDF/Excel seguem a unidade escolhida. Para trocar a unidade de alguém, clique no nome.
            </span>
          </div>
        )}
        <CardContent className={cn("grid gap-4 p-4", modo === "avancado" ? "md:grid-cols-3" : "md:grid-cols-2")}>
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
            <p className="text-sm font-medium">{regraFrase}</p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none text-primary">Saiba mais</summary>
              <div className="mt-1 space-y-1">
                {virada && anterior ? (
                  <>
                    <p className="text-sm">
                      <span className="text-muted-foreground">Até {ddmm(somarDias(virada.inicio, -1))}:</span> {anterior.nome}
                    </p>
                    <p className="text-sm font-medium">
                      <span className="font-normal text-muted-foreground">A partir de {ddmm(virada.inicio)}:</span> {virada.nome}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      A partir de {dataBR(virada.inicio)}, até {virada.limiteSemanalHoras}h por semana e {virada.repousosSemanais} folgas semanais (antes,{" "}
                      {anterior.limiteSemanalHoras}h e {anterior.repousosSemanais}). A semana que passa pelo dia {virada.inicio.slice(8)} já segue a regra nova.
                      {viradaComFolgas &&
                        ` Quem estava na 6x1 segue nela até o domingo ${ddmm(ultimoDiaDa6x1(virada.inicio))} e entra no modelo novo na segunda seguinte, para essa semana já ter as 2 folgas (dá para desligar por pessoa).`}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">{vigencia.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      Até {vigencia.limiteSemanalHoras}h por semana e {vigencia.repousosSemanais} folga(s) semanal(is). Domingo de folga ao menos a cada{" "}
                      {SEGMENTOS[cfg.segmento].domingoACadaSemanas} semanas.
                    </p>
                  </>
                )}
              </div>
            </details>
          </div>
          <div className={cn("space-y-1.5", modo === "simples" && "hidden")}>
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
        {modo === "avancado" && (
        <div className="flex items-start gap-2 border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            Regras travadas: a grade recusa qualquer mudança que deixe alguém sem as {vigencia.repousosSemanais} folga(s) da semana, sem o domingo de
            folga no prazo, acima da jornada do dia, sem as 11h entre turnos ou trabalhando em feriado sem permissão. Os cenários variam à vontade
            dentro disso.
          </span>
        </div>
        )}
      </Card>

      {modo === "simples" ? (
        <CaminhoGuiado
          mes={mes}
          cfg={cfg}
          travadoPeloEscritorio={travadoPeloEscritorio}
          regime12x36Padrao={regime12x36Padrao}
          linhas={linhas}
          cenarios={cenarios}
          escalaAtual={escalaAtual}
          cenarioAtual={cenarioAtual}
          totalErros={totalErros}
          totalAvisos={totalAvisos}
          alterado={alterado}
          salvo={Boolean(salvoEsteMes)}
          salvando={salvar.isPending}
          onEmpresa={confirmarEmpresaGuiada}
          onAbrirPessoa={setAberta}
          onVaga={adicionarVaga}
          onRemoverVaga={(id) => {
            setConfigs((cs) => cs.filter((x) => x.id !== id));
            setAlterado(true);
          }}
          onEscolher={(c) => aplicarCenario(c, true)}
          onSalvar={() => salvar.mutate()}
          onBaixar={baixar}
          limiteSemanal={vigencia.limiteSemanalHoras}
          pode42h={cfg.bloqueio === "sem_hora_extra" ? false : cfg.temAcordoColetivo ? "acordo" : "hora_extra"}
          onHorario={mudarHorario}
          onMaisOpcoes={() => {
            setModo("avancado");
            setAba("cenarios");
          }}
        />
      ) : (
      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
          <TabsTrigger value="cenarios" className="gap-1.5">
            <Sparkles className="h-4 w-4" /> Cenários
          </TabsTrigger>
          <TabsTrigger value="automatica" className="gap-1.5">
            <Wand2 className="h-4 w-4" /> Automática
          </TabsTrigger>
          <TabsTrigger value="assistente" className="gap-1.5">
            <Bot className="h-4 w-4" /> Assistente IA
          </TabsTrigger>
          <TabsTrigger value="escala" className="gap-1.5">
            <CalendarDays className="h-4 w-4" /> Escala do mês
            {totalErros > 0 && <span className="ml-1 rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">{totalErros}</span>}
          </TabsTrigger>
          <TabsTrigger value="pessoa" className="gap-1.5">
            <UserRound className="h-4 w-4" /> Por funcionário
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

        <TabsContent value="automatica" className="mt-4">
          {configs.length === 0 ? (
            <SemEquipe onVaga={adicionarVaga} />
          ) : (
            <PainelDistribuicao
              pessoas={equipe}
              mes={mes}
              empresa={cfg}
              feriados={feriadosSet}
              modeloPadrao={modeloPadrao}
              onAplicar={aplicarCenario}
            />
          )}
        </TabsContent>

        <TabsContent value="assistente" className="mt-4">
          <PainelAssistente
            estado={{ mes, cfg, configs, ajustes, feriados: feriadosSet }}
            companyId={companyId}
            onEstado={aplicarEstadoDaIa}
            onSalvar={salvarPelaIa}
          />
        </TabsContent>

        <TabsContent value="escala" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={adicionarVaga}>
              <Plus className="mr-1 h-4 w-4" /> Vaga simulada
            </Button>
            {unidades.length > 0 && (
              <select
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value={filtroUnidade}
                onChange={(e) => setUnidade(e.target.value)}
                aria-label="Unidade"
                title="Mostrar e baixar só a escala de uma unidade"
              >
                <option value="">Todas as unidades ({configs.length})</option>
                {unidades.map((u) => (
                  <option key={u} value={u}>
                    Unidade {u} ({configs.filter((c) => c.unidade === u).length})
                  </option>
                ))}
                {configs.some((c) => !c.unidade) && <option value="" disabled>Sem unidade: {configs.filter((c) => !c.unidade).length}</option>}
              </select>
            )}
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
              modelos={[...new Set(configs.map((c) => c.modelo))]}
              onMarcarPessoas={marcarPessoas}
              onDias={loteDias}
              onPessoas={lotePessoas}
            />
          )}

          {configs.length === 0 ? (
            <SemEquipe onVaga={adicionarVaga} />
          ) : (
            <Card>
              <CardContent className="relative p-0">
                {rolagem.temMais && (
                  <div className="flex items-center justify-end gap-1 border-b px-2 py-1 text-xs text-muted-foreground">
                    <span className="mr-auto">Arraste o cabeçalho ou o fundo da grade para o lado, ou use as setas, para ver os outros dias.</span>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => rolar(-1)} disabled={!rolagem.esquerda} aria-label="Semana anterior">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => rolar(1)} disabled={!rolagem.direita} aria-label="Próxima semana">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <div
                  ref={gradeRef}
                  onScroll={medirRolagem}
                  onPointerDown={iniciarPan}
                  className="overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:thin]"
                >
                <DndContext sensors={sensors} onDragEnd={aoSoltar}>
                  <table className="w-full min-w-[960px] table-fixed border-collapse text-xs">
                    <colgroup>
                      <col className="w-[190px]" />
                      {dias.map((d) => (
                        <col key={d} />
                      ))}
                      <col className="w-[58px]" />
                      <col className="w-[62px]" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-card p-2 text-left font-medium">
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
                                "cursor-pointer select-none rounded-t px-0 py-1 text-center text-[11px] font-normal hover:bg-primary/10",
                                dow === 0 && "border-l",
                                d === virada?.inicio && "border-l-2 border-l-primary",
                                (dow === 0 || feriados.has(d)) && "text-primary font-semibold",
                                selDias.has(d) && "bg-primary text-primary-foreground hover:bg-primary/90",
                              )}
                            >
                              <div>{DIAS_SEMANA[dow]}</div>
                              <div>{d.slice(8)}</div>
                              {feriados.has(d) && <div className="text-[9px]">fer.</div>}
                              {d === virada?.inicio && (
                                <div className="text-[9px] font-semibold text-primary" title={`${virada.nome} começa hoje`}>
                                  EC
                                </div>
                              )}
                            </th>
                          );
                        })}
                        <th className="p-1 text-right text-[11px] font-medium leading-tight">Horas no mês</th>
                        <th className="p-1 text-right text-[11px] font-medium leading-tight" title="Semana mais carregada que toca o mês, contra o limite da regra">
                          Maior semana
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhasVisiveis.map(({ config: c, dias: ds, porDia, ocorrencias, horas, maiorSemana, limiteSemana, semanaAcima }) => {
                        const erros = ocorrencias.filter((o) => o.gravidade === "erro").length;
                        return (
                          <tr key={c.id} className="border-t">
                            <td className="sticky left-0 z-10 bg-card px-2 py-1 align-middle">
                              <LinhaConfig
                                c={c}
                                erros={erros}
                                selecionado={selPessoas.has(c.id)}
                                onSelecionar={() => setSelPessoas((s) => alternar(s, c.id))}
                                onAbrir={() => setAberta(c.id)}
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
                                virada={d.data === virada?.inicio}
                                gravidade={porDia.get(d.data)}
                                ajustado={Boolean(ajustes[c.id] && d.data in ajustes[c.id])}
                                marcado={selDias.has(d.data) && (selPessoas.size === 0 || selPessoas.has(c.id))}
                                onClick={() => setEditando({ pessoa: c, data: d.data })}
                              />
                            ))}
                            <td className="p-1 text-right tabular-nums">{horas.toFixed(1).replace(".", ",")}h</td>
                            <td
                              className={cn(
                                "p-1 text-right tabular-nums",
                                semanaAcima === "erro" && "bg-destructive/15 font-semibold text-destructive",
                                semanaAcima === "atencao" && "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
                              )}
                              title={c.modelo === "12x36" ? `Média semanal da 12x36 (duas semanas seguidas). Limite: ${limiteSemana}h` : `Limite: ${limiteSemana}h`}
                            >
                              {maiorSemana.toFixed(1).replace(".", ",")}h
                              <span className="block text-[10px] font-normal opacity-70">
                                {c.modelo === "12x36" ? "média · " : ""}de {limiteSemana}h
                              </span>
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
                </div>
              </CardContent>
            </Card>
          )}

          <ListaOcorrencias linhas={linhas.map((l) => ({ nome: l.config.nome, ocorrencias: l.ocorrencias }))} />
        </TabsContent>

        <TabsContent value="pessoa" className="mt-4">
          {configs.length === 0 ? (
            <SemEquipe onVaga={adicionarVaga} />
          ) : (
            <PainelPorPessoa
              mes={mes}
              dias={dias}
              empresa={cfg}
              feriados={feriados}
              feriadosSet={feriadosSet}
              linhas={linhas}
              ajustes={ajustes}
              repousos={vigencia.repousosSemanais}
              viradaEm={viradaComFolgas ? virada?.inicio : undefined}
              foco={foco}
              onFoco={setFoco}
              onChange={atualizar}
              onEditarDia={(pessoa, data) => setEditando({ pessoa, data })}
              onVaga={adicionarVaga}
            />
          )}
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
                  <Switch checked={cfg.temAcordoColetivo} disabled={travadoPeloEscritorio} onCheckedChange={(v) => mudarCfg({ temAcordoColetivo: v })} />
                  Tem acordo/convenção coletiva de compensação
                </label>
                <div className="space-y-1.5">
                  <Label>Dias em que a casa fecha</Label>
                  <DiasFechados valor={cfg.diasFechados} onChange={(d) => mudarCfg({ diasFechados: d })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Bloqueio de jornada diária</Label>
                  <Select value={cfg.bloqueio} disabled={travadoPeloEscritorio} onValueChange={(v) => mudarCfg({ bloqueio: v as ModoBloqueio })}>
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
                  <p className="text-xs text-muted-foreground">
                    Com bloqueio, o sistema recusa o horário que passa do limite do dia.
                    {travadoPeloEscritorio && " Acordo coletivo e bloqueio são definidos pelo escritório."}
                  </p>
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
                Os feriados nacionais já entram sozinhos. Inclua aqui os municipais e estaduais da empresa e diga se a casa abre neles.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <Switch checked={cfg.abreNosFeriados} onCheckedChange={(v) => mudarCfg({ abreNosFeriados: v })} />
                <span>
                  A empresa abre nos feriados
                  <span className="block text-xs text-muted-foreground">
                    Ligado: no feriado trabalha quem a escala põe para trabalhar naquele dia (pagar em dobro ou dar outra folga na semana).
                    Desligado: todo mundo folga no feriado. Não vale para a 12x36, que já segue o plantão.
                  </span>
                </span>
              </label>
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
      )}

      {aberta &&
        (() => {
          const linha = linhas.find((l) => l.config.id === aberta);
          if (!linha) return null;
          return (
            <DialogoPessoa
              linha={linha}
              mes={mes}
              ajustes={ajustes}
              feriados={feriados}
              feriadosSet={feriadosSet}
              repousos={vigencia.repousosSemanais}
              viradaEm={viradaComFolgas ? virada?.inicio : undefined}
              unidades={unidades}
              abreNosFeriados={cfg.abreNosFeriados}
              onChange={(p) => atualizar(linha.config.id, p)}
              onDias={(datas, acao) => diasDaPessoa(linha.config.id, datas, acao)}
              onFechar={() => setAberta(null)}
            />
          );
        })()}

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

function LinhaConfig({
  c,
  erros,
  selecionado,
  onSelecionar,
  onAbrir,
  onRemover,
}: {
  c: ConfigPessoa;
  erros: number;
  selecionado: boolean;
  onSelecionar: () => void;
  onAbrir: () => void;
  onRemover?: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <Checkbox checked={selecionado} onCheckedChange={onSelecionar} aria-label={`Marcar ${c.nome}`} />
        {erros ? <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
        <button
          type="button"
          onClick={onAbrir}
          className="truncate text-left text-xs font-medium hover:text-primary hover:underline"
          title={`Personalizar a escala de ${c.nome}`}
        >
          {c.nome}
        </button>
        {c.unidade && (
          <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px] font-normal" title={`Unidade ${c.unidade}`}>
            {c.unidade}
          </Badge>
        )}
        {onRemover && (
          <button type="button" className="ml-auto text-muted-foreground hover:text-destructive" onClick={onRemover} aria-label="Remover vaga">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onAbrir}
        className="flex w-full items-center gap-1 truncate rounded border border-dashed px-1.5 py-0.5 text-left text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
        aria-label={`Configurar escala de ${c.nome}`}
      >
        <Settings2 className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {MODELOS[c.modelo]}
          {c.modelo === "12x36" ? ` ${c.turma}` : ""} · {c.entrada}–{c.saida}
        </span>
      </button>
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
  virada,
  onClick,
}: {
  id: string;
  turno: Turno | null;
  domingo: boolean;
  virada?: boolean;
  gravidade?: "erro" | "atencao";
  ajustado: boolean;
  marcado: boolean;
  onClick: () => void;
}) {
  const drag = useDraggable({ id });
  const drop = useDroppable({ id });
  const estilo = drag.transform ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)`, zIndex: 20 } : undefined;
  return (
    <td ref={drop.setNodeRef} className={cn("p-px", domingo && "border-l", virada && "border-l-2 border-l-primary", drop.isOver && "bg-primary/10")}>
      <button
        type="button"
        ref={drag.setNodeRef}
        style={estilo}
        {...drag.listeners}
        {...drag.attributes}
        onClick={onClick}
        className={cn(
          "relative flex h-9 w-full min-w-0 cursor-grab flex-col items-center justify-center overflow-hidden rounded border text-[9px] leading-tight tracking-tighter tabular-nums active:cursor-grabbing",
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
            <span>{horaCurta(turno.entrada)}</span>
            <span>{horaCurta(turno.saida)}</span>
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
              {agruparOcorrencias(l.ocorrencias).map((g, i) => (
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
