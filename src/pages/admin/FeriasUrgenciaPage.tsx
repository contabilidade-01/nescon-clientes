import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CircleDollarSign, Users, Building2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

function formatDateBR(d: string | null | undefined) {
  if (!d) return "—";
  return d.slice(0, 10).split("-").reverse().join("/");
}

function reais(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Situacao = "vencida" | "a_vencer" | "ok" | "sem_limite";
const SITUACAO: Record<Situacao, { rotulo: string; badge: "destructive" | "secondary" | "outline" }> = {
  vencida: { rotulo: "Vencida", badge: "destructive" },
  a_vencer: { rotulo: "Vence em breve", badge: "secondary" },
  ok: { rotulo: "No prazo", badge: "outline" },
  sem_limite: { rotulo: "Sem data", badge: "outline" },
};

const FeriasUrgenciaPage = () => {
  const [busca, setBusca] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-ferias-urgencia"],
    queryFn: () => api.admin.feriasUrgencia(),
  });

  const empresas = (data?.empresas || []).filter(
    (e: any) =>
      !busca ||
      e.empresa_nome.toLowerCase().includes(busca.toLowerCase()) ||
      e.empresa_cnpj.includes(busca) ||
      e.funcionarios.some((f: any) => f.nome.toLowerCase().includes(busca.toLowerCase()))
  );

  return (
    <AdminLayout
      title="Férias — Urgência"
      description="Consolidado de todas as empresas: quem está prestes a perder dias de férias"
    >
      {/* Resumo geral da carteira */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /> Empresas
            </p>
            <p className="mt-1 text-2xl font-bold">{data?.total_empresas ?? "—"}</p>
            <p className="text-[11px] text-muted-foreground">com alerta ativo</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Funcionários
            </p>
            <p className="mt-1 text-2xl font-bold">{data?.total_funcionarios ?? "—"}</p>
            <p className="text-[11px] text-muted-foreground">em risco (120 dias)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" /> Vencidas
            </p>
            <p className="mt-1 text-2xl font-bold text-destructive">{data?.total_vencidos ?? "—"}</p>
            <p className="text-[11px] text-muted-foreground">passou do limite</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" /> Risco faltas
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{data?.total_em_risco_faltas ?? "—"}</p>
            <p className="text-[11px] text-muted-foreground">≤3 faltas p/ perder dias</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CircleDollarSign className="h-3.5 w-3.5" /> Custo carteira
            </p>
            <p className="mt-1 text-2xl font-bold">{reais(data?.custo_carteira)}</p>
            <p className="text-[11px] text-muted-foreground">férias + 1/3 + FGTS</p>
          </CardContent>
        </Card>
      </div>

      {/* Busca */}
      <Input
        placeholder="Buscar por empresa, CNPJ ou funcionário..."
        className="max-w-sm"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />

      {/* Lista por empresa */}
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : !empresas.length ? (
        <div className="rounded-2xl border border-dashed bg-card/40 px-4 py-10 text-center">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">
            {busca ? "Nenhuma empresa encontrada com esse filtro." : "Nenhum funcionário com férias prestes a vencer. 🎉"}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {empresas.map((emp: any) => {
            const emRiscoFaltas = emp.funcionarios.filter(
              (f: any) => f.alerta_faltas && f.alerta_faltas.faltasRestantes <= 3
            ).length;

            return (
              <Card key={emp.company_id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    {emp.empresa_nome}
                    <span className="text-xs text-muted-foreground font-normal ml-1">{emp.empresa_cnpj}</span>
                    <Badge variant="secondary" className="ml-auto">
                      {emp.funcionarios.length} funcionário(s) · {reais(emp.custo_total)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Alerta de faltas da empresa (igual ao cliente) */}
                  {emRiscoFaltas > 0 && (
                    <div className="flex items-center gap-3 rounded-xl border-2 border-amber-500/50 bg-amber-500/10 px-4 py-3">
                      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                      <span className="text-sm">
                        <strong>{emRiscoFaltas}</strong> funcionário(s) a 3 faltas ou menos de perder dias de férias.
                      </span>
                    </div>
                  )}

                  {/* Cards por funcionário — mesmo visual que o cliente */}
                  {emp.funcionarios.map((f: any) => {
                    const s = SITUACAO[f.situacao as Situacao] || SITUACAO.ok;
                    return (
                      <div key={f.id} className="rounded-2xl border bg-card/70 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{f.nome}</p>
                            <p className="text-xs text-muted-foreground">
                              Período {formatDateBR(f.inicio_aquisitivo)} a {formatDateBR(f.fim_aquisitivo)}
                              {f.admissao ? ` · admitido em ${formatDateBR(f.admissao)}` : ""}
                            </p>
                          </div>
                          <Badge variant={s.badge}>{s.rotulo}</Badge>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                          <div>
                            <p className="text-[11px] text-muted-foreground">Dias de direito</p>
                            <p className="font-semibold tabular-nums">{f.dias_direito}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground">Tirar até</p>
                            <p className="font-semibold">{formatDateBR(f.limite_gozo)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground">Faltas</p>
                            <p className="font-semibold tabular-nums">{f.faltas ?? "—"}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground">Custo estimado</p>
                            <p className="font-semibold tabular-nums">
                              {f.origem_salario === "media_folha" ? "~" : ""}{reais(f.custo?.total)}
                            </p>
                          </div>
                        </div>

                        {/* Alerta de faltas individual (igual ao cliente) */}
                        {f.alerta_faltas && f.alerta_faltas.faltasRestantes <= 3 && (
                          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                            <span>
                              Com <strong>{f.alerta_faltas.faltasAtuais} falta(s)</strong>, mais{" "}
                              <strong>{f.alerta_faltas.faltasRestantes}</strong> e as férias caem de{" "}
                              {f.alerta_faltas.diasAtuais} para <strong>{f.alerta_faltas.diasDepois} dias</strong>.
                            </span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AdminLayout>
  );
};

export default FeriasUrgenciaPage;
