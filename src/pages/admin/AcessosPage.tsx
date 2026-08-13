import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, ChevronRight, Download, Eye, Loader2, Search, Users } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMPANY_TOOL_LABELS, type CompanyToolKey } from "@/lib/companyTools";
import { api, type AcessoCliente } from "@/lib/api";

/** ISO 'YYYY-MM-DDTHH:MM:SS' em UTC → data/hora em São Paulo. */
function fmtDataHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function labelFerramenta(key: string): string {
  return COMPANY_TOOL_LABELS[key as CompanyToolKey]?.title ?? key;
}

const PERIODOS = [
  { valor: "30", label: "Últimos 30 dias" },
  { valor: "90", label: "Últimos 90 dias" },
  { valor: "365", label: "Último ano" },
  { valor: "0", label: "Desde sempre" },
];

type StatusFiltro = "todos" | "ativos" | "nunca";

function StatCard({ icon: Icon, label, valor, destaque }: {
  icon: typeof Users;
  label: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <Card className={destaque && valor > 0 ? "border-amber-500/50" : undefined}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-lg p-2 ${destaque && valor > 0 ? "bg-amber-500/15 text-amber-600" : "bg-muted text-muted-foreground"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-semibold leading-none">{valor}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

const AcessosPage = () => {
  const [dias, setDias] = useState("90");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<StatusFiltro>("todos");
  const [expandida, setExpandida] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-acessos", dias],
    queryFn: () => api.acessos.dados(Number(dias)),
  });

  const rankingMax = useMemo(
    () => Math.max(1, ...(data?.ranking ?? []).map((r) => r.usos)),
    [data]
  );

  const clientesFiltrados = useMemo(() => {
    let lista: AcessoCliente[] = data?.clientes ?? [];
    const q = busca.trim().toLowerCase();
    if (q) {
      lista = lista.filter(
        (c) => c.name.toLowerCase().includes(q) || c.cnpj.replace(/\D/g, "").includes(q.replace(/\D/g, ""))
      );
    }
    if (status === "ativos") lista = lista.filter((c) => !c.nunca_acessou);
    if (status === "nunca") lista = lista.filter((c) => c.nunca_acessou);
    return lista;
  }, [data, busca, status]);

  return (
    <AdminLayout
      title="Controle de acessos"
      description="Quem realmente usa o portal, o que mais acessam e o que baixam. Os números de ranking e documentos respeitam o período; os 'últimos 5 acessos' são sempre os mais recentes."
    >
      <div className="space-y-6">
        {/* Período */}
        <div className="flex items-center justify-end">
          <Select value={dias} onValueChange={setDias}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODOS.map((p) => (
                <SelectItem key={p.valor} value={p.valor}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading || !data ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Dashboard */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={Users} label="Clientes no total" valor={data.totais.total} />
              <StatCard icon={Activity} label="Já acessaram o portal" valor={data.totais.acessaram} />
              <StatCard icon={Users} label="Nunca acessaram" valor={data.totais.nunca_acessaram} destaque />
              <StatCard icon={Activity} label="Ativos nos últimos 30 dias" valor={data.totais.ativos_30d} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Ranking de opções mais usadas */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Opções mais utilizadas</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.ranking.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Ainda sem registros de uso no período. Os dados aparecem conforme os clientes navegam.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {data.ranking.map((r) => (
                        <div key={r.ferramenta} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 truncate text-sm">{labelFerramenta(r.ferramenta)}</span>
                          <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
                            <div
                              className="h-full rounded bg-primary/70"
                              style={{ width: `${(r.usos / rankingMax) * 100}%` }}
                            />
                          </div>
                          <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                            {r.usos}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Documentos: visualizados x baixados */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Documentos</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-around py-6">
                  <div className="flex flex-col items-center gap-1">
                    <Eye className="h-6 w-6 text-muted-foreground" />
                    <span className="text-3xl font-semibold">{data.documentos.visualizados}</span>
                    <span className="text-xs text-muted-foreground">Visualizados</span>
                  </div>
                  <div className="h-14 w-px bg-border" />
                  <div className="flex flex-col items-center gap-1">
                    <Download className="h-6 w-6 text-muted-foreground" />
                    <span className="text-3xl font-semibold">{data.documentos.baixados}</span>
                    <span className="text-xs text-muted-foreground">Baixados</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Filtros + tabela */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Clientes ({clientesFiltrados.length})</CardTitle>
                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar por nome ou CNPJ"
                      className="pl-8"
                    />
                  </div>
                  <div className="flex gap-1">
                    {([
                      { v: "todos", l: "Todos" },
                      { v: "ativos", l: "Já acessaram" },
                      { v: "nunca", l: "Nunca acessaram" },
                    ] as const).map((o) => (
                      <Button
                        key={o.v}
                        size="sm"
                        variant={status === o.v ? "default" : "outline"}
                        onClick={() => setStatus(o.v)}
                      >
                        {o.l}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {clientesFiltrados.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Nenhum cliente para este filtro.</p>
                ) : (
                  <div className="divide-y">
                    {/* Cabeçalho */}
                    <div className="hidden gap-2 px-2 pb-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1.5fr_1fr_repeat(3,0.6fr)_auto]">
                      <span>Cliente</span>
                      <span>Último acesso</span>
                      <span className="text-right">Logins</span>
                      <span className="text-right">Views</span>
                      <span className="text-right">Downloads</span>
                      <span />
                    </div>
                    {clientesFiltrados.map((c) => {
                      const aberta = expandida === c.id;
                      return (
                        <div key={c.id}>
                          <button
                            type="button"
                            onClick={() => setExpandida(aberta ? null : c.id)}
                            className="grid w-full grid-cols-[1fr_auto] items-center gap-2 px-2 py-2.5 text-left hover:bg-muted/50 sm:grid-cols-[1.5fr_1fr_repeat(3,0.6fr)_auto]"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-medium">{c.name}</span>
                                {c.nunca_acessou && (
                                  <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                                    nunca acessou
                                  </Badge>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground">{c.cnpj}</span>
                            </div>
                            <span className="hidden text-sm text-muted-foreground sm:block">
                              {fmtDataHora(c.ultimo_acesso)}
                            </span>
                            <span className="hidden text-right text-sm tabular-nums sm:block">{c.num_logins}</span>
                            <span className="hidden text-right text-sm tabular-nums sm:block">{c.views}</span>
                            <span className="hidden text-right text-sm tabular-nums sm:block">{c.downloads}</span>
                            {aberta ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>

                          {aberta && (
                            <div className="grid gap-4 bg-muted/30 px-4 py-3 sm:grid-cols-2">
                              <div>
                                <p className="mb-1 text-xs font-medium text-muted-foreground">Últimos 5 acessos</p>
                                {c.ultimos_acessos.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">
                                    Sem logins registrados desde a ativação do controle.
                                  </p>
                                ) : (
                                  <ul className="space-y-0.5 text-sm">
                                    {c.ultimos_acessos.map((a, i) => (
                                      <li key={i} className="flex justify-between gap-2">
                                        <span>{fmtDataHora(a.em)}</span>
                                        <span className="text-xs text-muted-foreground">{a.ip || "—"}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-medium text-muted-foreground">Ferramentas mais usadas</p>
                                {c.top_ferramentas.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">Sem uso registrado no período.</p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5">
                                    {c.top_ferramentas.map((t) => (
                                      <Badge key={t.ferramenta} variant="secondary">
                                        {labelFerramenta(t.ferramenta)} · {t.usos}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
};

export default AcessosPage;
