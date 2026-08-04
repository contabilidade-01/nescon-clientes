import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, ShieldCheck, X } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { LicenseDialog, type LicenseDialogValue } from "@/components/admin/LicenseDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type LicenseStatus, type LicenseType } from "@/lib/api";
import {
  LICENSE_STATUS_LABELS,
  LICENSE_STATUSES,
  LICENSE_TYPES,
  LICENSE_TYPE_LABELS,
  diasLabel,
  formatDateBR,
} from "@/lib/licenses";

function isStatus(v: string | null): v is LicenseStatus {
  return !!v && (LICENSE_STATUSES as string[]).includes(v);
}
function isTipo(v: string | null): v is LicenseType {
  return !!v && (LICENSE_TYPES as string[]).includes(v);
}

const LicencasPage = () => {
  // O estado do filtro vive na URL: os cartões do painel e os atalhos da visão geral
  // são só links, e o botão "voltar" do browser funciona.
  const [params, setParams] = useSearchParams();
  const status = isStatus(params.get("status")) ? (params.get("status") as LicenseStatus) : undefined;
  const tipo = isTipo(params.get("tipo")) ? (params.get("tipo") as LicenseType) : undefined;
  const [busca, setBusca] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogValue, setDialogValue] = useState<LicenseDialogValue>({});

  /** Aplica os filtros de uma vez — duas chamadas seguidas leriam `params` desatualizado. */
  const setFiltros = (patch: { status?: LicenseStatus | null; tipo?: LicenseType | null }) => {
    const next = new URLSearchParams(params);
    for (const chave of ["status", "tipo"] as const) {
      if (!(chave in patch)) continue;
      const valor = patch[chave];
      if (valor) next.set(chave, valor);
      else next.delete(chave);
    }
    setParams(next, { replace: true });
  };

  const { data: overview } = useQuery({
    queryKey: ["licencas-overview"],
    queryFn: () => api.licencas.overview(),
  });

  const { data: itens, isLoading } = useQuery({
    queryKey: ["licencas-itens", status ?? "", tipo ?? "", busca],
    queryFn: () => api.licencas.itens({ status, tipo, q: busca.trim() || undefined }),
  });

  const abrirNova = () => {
    setDialogValue({ tipo });
    setDialogOpen(true);
  };

  return (
    <AdminLayout
      title="Licenças"
      description="Alvará de funcionamento, AVCB/CLCB e vigilância sanitária das empresas estabelecidas"
    >
      <Tabs defaultValue="painel">
        <TabsList>
          <TabsTrigger value="painel">Painel e licenças</TabsTrigger>
          <TabsTrigger value="empresas">Empresas estabelecidas</TabsTrigger>
        </TabsList>

        <TabsContent value="painel" className="mt-4 space-y-6">
          {/* Dashboard: cada número abre a lista já filtrada */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["vencida", "a_vencer", "ativa", "ausente"] as const).map((s) => {
              const meta = LICENSE_STATUS_LABELS[s];
              const ativo = status === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFiltros({ status: ativo ? null : s })}
                  className={`rounded-xl border p-4 text-left transition-colors hover:border-primary/40 ${
                    ativo ? "border-primary bg-primary/5" : "bg-card"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                    {meta.title}
                  </span>
                  <p className="mt-1 text-3xl font-bold tabular-nums">
                    {overview?.por_status[s] ?? "—"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{meta.description}</p>
                </button>
              );
            })}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Por tipo de licença
              </CardTitle>
              <CardDescription>
                {overview
                  ? `${overview.estabelecidas} empresas estabelecidas · aviso ${overview.dias_aviso} dias antes do vencimento. Clique numa célula para filtrar.`
                  : "Carregando..."}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Licença</th>
                    {(["vencida", "a_vencer", "ativa", "ausente"] as const).map((s) => (
                      <th key={s} className="pb-2 text-center font-medium">
                        {LICENSE_STATUS_LABELS[s].title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {LICENSE_TYPES.map((t) => {
                    const linha = overview?.por_tipo.find((x) => x.tipo === t);
                    return (
                      <tr key={t} className="border-t">
                        <td className="py-2 pr-2 font-medium">{LICENSE_TYPE_LABELS[t].title}</td>
                        {(["vencida", "a_vencer", "ativa", "ausente"] as const).map((s) => (
                          <td key={s} className="py-1 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setFiltros({ tipo: t, status: s });
                              }}
                              className="min-w-10 rounded-md px-2 py-1 tabular-nums hover:bg-muted"
                            >
                              {linha ? linha[s] : "—"}
                            </button>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Licenças</CardTitle>
                  <CardDescription>
                    Uma linha por empresa e tipo, com a licença vigente (o vencimento mais distante).
                  </CardDescription>
                </div>
                <Button size="sm" onClick={abrirNova}>
                  <Plus className="mr-1 h-4 w-4" /> Nova licença
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[12rem] flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Buscar por razão social ou CNPJ"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                </div>
                {status && (
                  <Badge variant="secondary" className="gap-1">
                    {LICENSE_STATUS_LABELS[status].title}
                    <button type="button" onClick={() => setFiltros({ status: null })} aria-label="Limpar estado">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {tipo && (
                  <Badge variant="secondary" className="gap-1">
                    {LICENSE_TYPE_LABELS[tipo].short}
                    <button type="button" onClick={() => setFiltros({ tipo: null })} aria-label="Limpar tipo">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
              </div>

              <div className="max-h-[36rem] space-y-2 overflow-y-auto">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando...</p>
                ) : itens?.length ? (
                  itens.map((item) => {
                    const meta = LICENSE_STATUS_LABELS[item.status];
                    return (
                      <button
                        key={`${item.company_id}-${item.tipo}`}
                        type="button"
                        onClick={() => {
                          setDialogValue({
                            licenseId: item.license_id,
                            companyId: item.company_id,
                            tipo: item.tipo,
                            numero: item.numero,
                            orgao: item.orgao,
                            emitida_em: item.emitida_em,
                            vence_em: item.vence_em,
                            observacao: item.observacao,
                          });
                          setDialogOpen(true);
                        }}
                        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors hover:border-primary/40"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {LICENSE_TYPE_LABELS[item.tipo].short} · CNPJ {item.cnpj}
                            {item.numero ? ` · nº ${item.numero}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-right text-xs text-muted-foreground">
                            {item.vence_em ? (
                              <>
                                vence {formatDateBR(item.vence_em)}
                                <br />
                                {diasLabel(item.dias_restantes)}
                              </>
                            ) : (
                              "sem cadastro"
                            )}
                          </span>
                          <Badge variant={meta.badge}>{meta.title.replace(/s$/, "")}</Badge>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nada nesse filtro. Se a empresa não aparece em lugar nenhum, confira se ela está
                    marcada como <strong>estabelecida</strong> na outra aba.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="empresas" className="mt-4">
          <EstabelecidasTab />
        </TabsContent>
      </Tabs>

      <LicenseDialog open={dialogOpen} onOpenChange={setDialogOpen} value={dialogValue} />
    </AdminLayout>
  );
};

/** Marcação estabelecida × não estabelecida: quem não é estabelecida sai do painel. */
function EstabelecidasTab() {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");

  const { data: empresas, isLoading } = useQuery({
    queryKey: ["licencas-empresas"],
    queryFn: () => api.licencas.empresas(),
  });

  const marcar = useMutation({
    mutationFn: ({ id, established }: { id: string; established: boolean }) =>
      api.licencas.marcarEstabelecida(id, established),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["licencas-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["licencas-overview"] });
      queryClient.invalidateQueries({ queryKey: ["licencas-itens"] });
      queryClient.invalidateQueries({ queryKey: ["taxas-anuais"] });
      toast.success(
        vars.established
          ? "Empresa marcada como estabelecida (passa a exigir licenças)"
          : "Empresa marcada como não estabelecida (fica fora do painel de licenças)"
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtradas = empresas?.filter((c) => {
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.cnpj.includes(q);
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Estabelecida × não estabelecida</CardTitle>
        <CardDescription>
          Empresa <strong>não estabelecida</strong> não tem ponto físico e por isso não precisa de
          alvará, AVCB/CLCB nem vigilância sanitária — sai do painel de licenças e do controle de
          taxa anual. As licenças já cadastradas ficam guardadas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar empresa"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="max-h-[36rem] space-y-2 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : filtradas?.length ? (
            filtradas.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    CNPJ {c.cnpj} · {c.licencas.length} licença(s) cadastrada(s)
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs">
                  <span className="text-muted-foreground">
                    {c.established ? "Estabelecida" : "Não estabelecida"}
                  </span>
                  <Switch
                    checked={c.established}
                    disabled={marcar.isPending}
                    onCheckedChange={(v) => marcar.mutate({ id: c.id, established: v })}
                    aria-label={`Marcar ${c.name} como estabelecida`}
                  />
                </label>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default LicencasPage;
