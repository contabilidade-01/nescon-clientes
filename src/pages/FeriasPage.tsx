import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CircleDollarSign, Users } from "lucide-react";
import { PortalPage } from "@/components/PortalPage";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

type Filtro = "todos" | "vencida" | "a_vencer" | "faltas";

const FeriasPage = () => {
  const { company } = useAuth();
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const { data, isLoading, error } = useQuery({
    queryKey: ["ferias"],
    queryFn: () => api.ferias.listar(),
    enabled: !!company,
  });

  const periodos = useMemo(() => {
    const lista = data?.periodos ?? [];
    const filtrada =
      filtro === "todos"
        ? lista
        : filtro === "faltas"
          ? lista.filter((p) => p.alerta_faltas && p.alerta_faltas.faltasRestantes <= 3)
          : lista.filter((p) => p.situacao === filtro);
    // O mais urgente primeiro: quem não tem data vai para o fim.
    return [...filtrada].sort((a, b) => {
      const da = a.limite_gozo ? new Date(a.limite_gozo).getTime() : Number.POSITIVE_INFINITY;
      const db = b.limite_gozo ? new Date(b.limite_gozo).getTime() : Number.POSITIVE_INFINITY;
      return da - db;
    });
  }, [data, filtro]);

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
              onClick={() => setFiltro("todos")}
              ativo={filtro === "todos"}
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
              onClick={() => setFiltro("faltas")}
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

          <div className="space-y-3">
            {periodos.length === 0 ? (
              <p className="rounded-xl border border-dashed bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
                Ninguém nesse filtro.
              </p>
            ) : (
              periodos.map((p) => <LinhaFerias key={p.id} p={p} />)
            )}
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

function LinhaFerias({ p }: { p: VacationItem }) {
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
        <Badge variant={s.badge}>{s.rotulo}</Badge>
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
          <p className="font-semibold tabular-nums">{reais(p.custo?.total)}</p>
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

      {!p.custo && (
        <p className="mt-3 text-xs text-muted-foreground">
          Sem salário na folha mais recente — não dá para estimar o custo deste período.
        </p>
      )}
    </div>
  );
}

export default FeriasPage;
