import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, BellOff, CalendarClock, CircleDollarSign, Search, Users, X } from "lucide-react";
import { PortalPage } from "@/components/PortalPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type VacationItem, type VacationSituacao } from "@/lib/api";
import { formatDateBR } from "@/lib/licenses";
import { useAuth } from "@/hooks/useAuth";

const SITUACAO: Record<VacationSituacao, { rotulo: string; badge: "destructive" | "secondary" | "outline" | "default" }> = {
  vencida: { rotulo: "Vencida", badge: "destructive" },
  a_vencer: { rotulo: "Vence em breve", badge: "secondary" },
  ok: { rotulo: "No prazo", badge: "outline" },
  sem_limite: { rotulo: "Sem data", badge: "outline" },
};

function reais(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Filtro = "todos" | VacationSituacao;
type FiltroFaltas = "todas" | "com_faltas" | "em_risco" | "sem_faltas";
type Ordem = "faltas" | "limite" | "nome" | "custo";

const ORDEM_ROTULO: Record<Ordem, string> = {
  faltas: "Mais faltas primeiro",
  limite: "Tirar até (mais urgente)",
  nome: "Nome (A–Z)",
  custo: "Maior custo",
};

/** Ignora acento e caixa: "joao" acha "JOÃO". */
function normalizar(t: string) {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function emRiscoFaltas(p: VacationItem) {
  return !!p.alerta_faltas && p.alerta_faltas.faltasRestantes <= 3;
}

function limiteMs(p: VacationItem) {
  return p.limite_gozo ? new Date(p.limite_gozo).getTime() : Number.POSITIVE_INFINITY;
}

const FeriasPage = () => {
  const { company } = useAuth();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [filtroFaltas, setFiltroFaltas] = useState<FiltroFaltas>("todas");
  const [busca, setBusca] = useState("");
  // Por padrão quem tem mais faltas vem primeiro: é quem está mais perto de perder dias.
  const [ordem, setOrdem] = useState<Ordem>("faltas");

  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["ferias"],
    queryFn: () => api.ferias.listar(),
    enabled: !!company,
  });

  // O que este cliente já dispensou. É o que o WhatsApp manda ele vir marcar aqui —
  // ver o passo a passo no fim do alerta de férias (api/src/alertasRegras.js).
  const prefs = useQuery({
    queryKey: ["preferencias"],
    queryFn: () => api.preferencias.ler(),
    enabled: !!company,
  });

  const dispensados = useMemo(
    () =>
      new Set(
        (prefs.data?.ferias_dispensadas ?? []).map((d) => `${d.codigo}|${d.limite_gozo}`)
      ),
    [prefs.data]
  );

  const salvarPrefs = useMutation({
    mutationFn: (ativo: boolean) => api.preferencias.salvar(ativo),
    onSuccess: (r) => {
      toast.success(
        r.avisos_documentos_ativos
          ? "Você voltará a receber aviso de documento novo."
          : "Pronto. Não enviaremos mais aviso de documento novo."
      );
      queryClient.invalidateQueries({ queryKey: ["preferencias"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dispensar = useMutation({
    mutationFn: (v: { codigo: string; funcionario: string; limite: string; dispensar: boolean }) =>
      v.dispensar
        ? api.preferencias.feriasVisto(v.codigo, v.limite, v.funcionario)
        : api.preferencias.desfazerFeriasVisto(v.codigo, v.limite),
    onSuccess: (_r, v) => {
      toast.success(
        v.dispensar
          ? `Pronto. Você não recebe mais o aviso de ${v.funcionario} para este período.`
          : `Você voltará a receber o aviso de ${v.funcionario}.`
      );
      queryClient.invalidateQueries({ queryKey: ["preferencias"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const periodos = useMemo(() => {
    const termo = normalizar(busca);
    const filtrada = (data?.periodos ?? []).filter((p) => {
      if (filtro !== "todos" && p.situacao !== filtro) return false;
      if (filtroFaltas === "com_faltas" && !(p.faltas > 0)) return false;
      if (filtroFaltas === "sem_faltas" && p.faltas > 0) return false;
      if (filtroFaltas === "em_risco" && !emRiscoFaltas(p)) return false;
      if (termo && !normalizar(p.nome).includes(termo)) return false;
      return true;
    });
    return [...filtrada].sort((a, b) => {
      switch (ordem) {
        case "faltas":
          // Empate: o mais urgente primeiro.
          return (b.faltas ?? 0) - (a.faltas ?? 0) || limiteMs(a) - limiteMs(b);
        case "nome":
          return a.nome.localeCompare(b.nome, "pt-BR");
        case "custo":
          return (b.custo?.total ?? -1) - (a.custo?.total ?? -1);
        default:
          // O mais urgente primeiro: quem não tem data vai para o fim.
          return limiteMs(a) - limiteMs(b);
      }
    });
  }, [data, filtro, filtroFaltas, busca, ordem]);

  const temFiltro = filtro !== "todos" || filtroFaltas !== "todas" || busca.trim() !== "";
  const limparFiltros = () => {
    setFiltro("todos");
    setFiltroFaltas("todas");
    setBusca("");
  };

  const resumo = data?.resumo;

  return (
    <PortalPage title="Férias" subtitle={company?.name} wide>
      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Erro ao carregar"}
        </p>
      ) : isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : !data?.upload ? (
        <div className="rounded-2xl border border-dashed bg-card/40 px-4 py-10 text-center">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Ainda não há programação de férias</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Assim que a contabilidade enviar, você verá aqui quem tem direito, quando e quanto vai
            custar.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Os três números que respondem a pergunta do dia a dia */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Resumo
              icone={<Users className="h-4 w-4" />}
              rotulo="Funcionários"
              valor={String(resumo?.funcionarios ?? 0)}
              detalhe={`${resumo?.periodos ?? 0} período(s)`}
              onClick={limparFiltros}
              ativo={!temFiltro}
            />
            <Resumo
              icone={<AlertTriangle className="h-4 w-4" />}
              rotulo="Vencidas"
              valor={String(resumo?.vencidas ?? 0)}
              detalhe="passou do limite"
              onClick={() => setFiltro("vencida")}
              ativo={filtro === "vencida"}
              alerta={(resumo?.vencidas ?? 0) > 0}
            />
            <Resumo
              icone={<CalendarClock className="h-4 w-4" />}
              rotulo="Vencem em breve"
              valor={String(resumo?.a_vencer ?? 0)}
              detalhe="nos próximos 30 dias"
              onClick={() => setFiltro("a_vencer")}
              ativo={filtro === "a_vencer"}
            />
            <Resumo
              icone={<CircleDollarSign className="h-4 w-4" />}
              rotulo="Custo estimado"
              valor={reais(resumo?.custo.total)}
              detalhe="férias + 1/3 + FGTS"
            />
          </div>

          {(resumo?.em_risco_faltas ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => {
                setFiltro("todos");
                setFiltroFaltas("em_risco");
                setOrdem("faltas");
              }}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-amber-500/50 bg-amber-500/10 px-4 py-3 text-left"
            >
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
              <span className="flex-1 text-sm">
                <strong>{resumo?.em_risco_faltas}</strong> funcionário(s) a 3 faltas ou menos de
                perder dias de férias. Vale avisar antes que aconteça.
              </span>
            </button>
          )}

          {(resumo?.custo.semSalario ?? 0) > 0 && (
            <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              O custo de <strong>{resumo?.custo.semSalario}</strong> período(s) não entrou na conta:
              esses funcionários não têm salário na folha mais recente. O total acima está
              incompleto.
            </p>
          )}

          <div className="flex flex-col gap-2 rounded-xl border bg-card/40 p-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar funcionário"
                className="pl-9"
                aria-label="Buscar funcionário"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex">
              <Select value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
                <SelectTrigger className="lg:w-44" aria-label="Situação">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas as situações</SelectItem>
                  {(Object.keys(SITUACAO) as VacationSituacao[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {SITUACAO[k].rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filtroFaltas} onValueChange={(v) => setFiltroFaltas(v as FiltroFaltas)}>
                <SelectTrigger className="lg:w-48" aria-label="Faltas">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Qualquer nº de faltas</SelectItem>
                  <SelectItem value="com_faltas">Com faltas</SelectItem>
                  <SelectItem value="em_risco">Perto de perder dias</SelectItem>
                  <SelectItem value="sem_faltas">Sem faltas</SelectItem>
                </SelectContent>
              </Select>
              <Select value={ordem} onValueChange={(v) => setOrdem(v as Ordem)}>
                <SelectTrigger className="lg:w-52" aria-label="Ordenar">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ORDEM_ROTULO) as Ordem[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {ORDEM_ROTULO[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {temFiltro && (
              <Button variant="ghost" size="sm" onClick={limparFiltros} className="shrink-0">
                <X className="mr-1 h-3.5 w-3.5" /> Limpar
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {temFiltro && periodos.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {periodos.length} de {data.periodos.length} período(s)
              </p>
            )}
            {periodos.length === 0 ? (
              <p className="rounded-xl border border-dashed bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
                Ninguém nesse filtro.
              </p>
            ) : (
              periodos.map((p) => (
                <LinhaFerias
                  key={p.id}
                  p={p}
                  dispensado={dispensados.has(`${p.codigo}|${(p.limite_gozo ?? "").slice(0, 10)}`)}
                  onDispensar={(v) =>
                    dispensar.mutate({
                      codigo: p.codigo ?? "",
                      funcionario: p.nome,
                      limite: (p.limite_gozo ?? "").slice(0, 10),
                      dispensar: v,
                    })
                  }
                />
              ))
            )}
          </div>

          {/* Preferência geral do cliente. Fica junto de Férias porque é aqui que ele
              chega vindo do WhatsApp — e é o momento em que pensa no assunto. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/40 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Avisos de documento novo</p>
              <p className="text-xs text-muted-foreground">
                Mensagem no WhatsApp quando enviamos guia, folha ou documento. Os avisos de
                vencimento continuam — eles evitam multa.
              </p>
            </div>
            <Button
              variant={prefs.data?.avisos_documentos_ativos === false ? "default" : "outline"}
              size="sm"
              disabled={salvarPrefs.isPending || prefs.isLoading}
              onClick={() =>
                salvarPrefs.mutate(!(prefs.data?.avisos_documentos_ativos ?? true))
              }
            >
              {prefs.data?.avisos_documentos_ativos === false
                ? "Voltar a receber"
                : "Não quero receber"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Base: programação de {formatDateBR(data.upload.emissao)}
            {data.upload.data_base ? ` · data base ${formatDateBR(data.upload.data_base)}` : ""}. O
            custo é uma estimativa sobre o salário da última folha.
          </p>
        </div>
      )}
    </PortalPage>
  );
};

function Resumo({
  icone,
  rotulo,
  valor,
  detalhe,
  onClick,
  ativo,
  alerta,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: string;
  detalhe?: string;
  onClick?: () => void;
  ativo?: boolean;
  alerta?: boolean;
}) {
  const conteudo = (
    <CardContent className="pt-4 pb-4 text-left">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icone}
        {rotulo}
      </p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${alerta ? "text-destructive" : ""}`}>
        {valor}
      </p>
      {detalhe && <p className="text-[11px] text-muted-foreground">{detalhe}</p>}
    </CardContent>
  );
  return (
    <Card
      onClick={onClick}
      className={`${onClick ? "cursor-pointer transition-colors hover:border-primary/40" : ""} ${
        ativo ? "border-primary" : ""
      }`}
    >
      {conteudo}
    </Card>
  );
}

function LinhaFerias({
  p,
  dispensado,
  onDispensar,
}: {
  p: VacationItem;
  dispensado: boolean;
  onDispensar: (dispensar: boolean) => void;
}) {
  const s = SITUACAO[p.situacao];
  return (
    <div className="rounded-2xl border bg-card/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{p.nome}</p>
          <p className="text-xs text-muted-foreground">
            Período {formatDateBR(p.inicio_aquisitivo)} a {formatDateBR(p.fim_aquisitivo)}
            {p.admissao ? ` · admitido em ${formatDateBR(p.admissao)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dispensado && (
            <Badge variant="outline" className="gap-1">
              <BellOff className="h-3 w-3" /> aviso dispensado
            </Badge>
          )}
          <Badge variant={s.badge}>{s.rotulo}</Badge>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-[11px] text-muted-foreground">Dias de direito</p>
          <p className="font-semibold tabular-nums">{p.dias_direito}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Tirar até</p>
          <p className="font-semibold">{formatDateBR(p.limite_gozo)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Faltas</p>
          <p className="font-semibold tabular-nums">{p.faltas}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Custo estimado</p>
          <p className="font-semibold tabular-nums">
            {p.origem_salario === "media_folha" ? "~" : ""}{reais(p.custo?.total)}
          </p>
          {p.origem_salario === "media_folha" && (
            <p className="text-[10px] text-muted-foreground">pela média da folha</p>
          )}
        </div>
      </div>

      {/* O alerta que chega a tempo: ainda dá para evitar a perda. */}
      {p.alerta_faltas && p.alerta_faltas.faltasRestantes <= 3 && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            Com <strong>{p.alerta_faltas.faltasAtuais} falta(s)</strong>, mais{" "}
            <strong>{p.alerta_faltas.faltasRestantes}</strong> e as férias caem de{" "}
            {p.alerta_faltas.diasAtuais} para <strong>{p.alerta_faltas.diasDepois} dias</strong>.
          </span>
        </p>
      )}

      {!p.custo && !p.origem_salario && (
        <p className="mt-3 text-xs text-muted-foreground">
          Sem salário na folha mais recente — não dá para estimar o custo deste período.
        </p>
      )}

      {/* A saída que o WhatsApp promete. Só aparece quando há limite: sem data não há
          aviso para dispensar. Dispensar vale só para ESTE período — quando surgir um
          limite novo, o aviso volta sozinho, sem ninguém ter de religar nada. */}
      {p.limite_gozo && (
        <div className="mt-3 border-t pt-3">
          {dispensado ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Você não recebe aviso deste período no WhatsApp.
              </p>
              <Button variant="ghost" size="sm" onClick={() => onDispensar(false)}>
                Voltar a receber
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onDispensar(true)}>
              <BellOff className="mr-2 h-3.5 w-3.5" />
              Já recebi este aviso
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default FeriasPage;
