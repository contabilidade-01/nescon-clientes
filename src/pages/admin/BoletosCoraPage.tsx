import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Receipt,
  RefreshCw,
  Loader2,
  Search,
  Building2,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function formatCurrency(centavos: number | null): string {
  if (!centavos) return "—";
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  return date.split("-").reverse().join("/");
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "paid":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
          <CheckCircle2 className="mr-1 h-3 w-3" /> Pago
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
          <Clock className="mr-1 h-3 w-3" /> Pendente
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          <XCircle className="mr-1 h-3 w-3" /> {status}
        </Badge>
      );
  }
}

function DocTypeBadge({ docType }: { docType: string | null }) {
  if (docType === "BOLETO_CORA_CANCELADO") {
    return (
      <Badge variant="destructive" className="text-[10px]">
        <XCircle className="mr-0.5 h-3 w-3" /> Cancelado
      </Badge>
    );
  }
  return null;
}

const BoletosCoraPage = () => {
  const queryClient = useQueryClient();
  const [cnpjBusca, setCnpjBusca] = useState("");
  const [filtroEmpresa, setFiltroEmpresa] = useState("");

  // Status da sync
  const { data: syncStatus } = useQuery({
    queryKey: ["admin-sync-cora-status"],
    queryFn: () => api.admin.coraSyncStatus(),
    refetchInterval: (q) => (q.state.data?.rodando ? 3000 : false),
  });

  // Empresas
  const { data: empresas, isLoading: loadingEmpresas } = useQuery({
    queryKey: ["admin-cora-empresas"],
    queryFn: () => api.admin.coraEmpresas(),
  });

  // Boletos
  const { data: boletos, isLoading: loadingBoletos } = useQuery({
    queryKey: ["admin-cora-boletos"],
    queryFn: () => api.admin.coraBoletos(),
  });

  // Sync geral
  const syncAll = useMutation({
    mutationFn: () => api.admin.runCorSync(),
    onSuccess: (r) => {
      toast.success(r.message);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["admin-sync-cora-status"] });
        queryClient.invalidateQueries({ queryKey: ["admin-cora-boletos"] });
        queryClient.invalidateQueries({ queryKey: ["admin-cora-empresas"] });
      }, 2000);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Sync individual
  const syncEmpresa = useMutation({
    mutationFn: (cnpj: string) => api.admin.coraSyncEmpresa(cnpj),
    onSuccess: (r) => {
      toast.success(r.message);
      setCnpjBusca("");
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["admin-cora-boletos"] });
        queryClient.invalidateQueries({ queryKey: ["admin-cora-empresas"] });
      }, 3000);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Toggle empresa
  const toggleEmpresa = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.admin.coraToggleEmpresa(id, ativo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-cora-empresas"] });
      toast.success("Configuração atualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rodando = syncStatus?.rodando || syncAll.isPending;
  const totalBoletos = boletos?.length || 0;
  const boletosPendentes = boletos?.filter((b) => b.status === "pending").length || 0;
  const boletosPagos = boletos?.filter((b) => b.status === "paid").length || 0;

  const empresasFiltradas = (empresas || []).filter(
    (e) =>
      !filtroEmpresa ||
      e.name.toLowerCase().includes(filtroEmpresa.toLowerCase()) ||
      e.cnpj.includes(filtroEmpresa)
  );

  return (
    <AdminLayout
      title="Boletos Cora"
      description="Gestão de importação de boletos mensais da Cora"
    >
      {/* Status + Ações */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total importados</p>
            <p className="text-2xl font-bold">{totalBoletos}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pendentes</p>
            <p className="text-2xl font-bold text-amber-600">{boletosPendentes}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pagos</p>
            <p className="text-2xl font-bold text-emerald-600">{boletosPagos}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Última sync</p>
            <p className="text-sm font-medium">
              {syncStatus?.ultima?.em
                ? format(new Date(syncStatus.ultima.em), "dd/MM 'às' HH:mm", { locale: ptBR })
                : "Nunca"}
            </p>
            {syncStatus?.ultima && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {syncStatus.ultima.criados} novos · {syncStatus.ultima.atualizados} atualizados
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Button
              onClick={() => syncAll.mutate()}
              disabled={rodando || !syncStatus?.configurado}
            >
              {rodando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sincronizando...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" /> Sincronizar tudo
                </>
              )}
            </Button>

            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Buscar por CNPJ</label>
                <Input
                  placeholder="00.000.000/0000-00"
                  className="h-9 w-48"
                  value={cnpjBusca}
                  onChange={(e) => setCnpjBusca(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => {
                  const limpo = cnpjBusca.replace(/\D/g, "");
                  if (limpo.length >= 11) syncEmpresa.mutate(limpo);
                  else toast.error("CNPJ inválido");
                }}
                disabled={syncEmpresa.isPending || rodando}
              >
                <Search className="mr-1 h-4 w-4" /> Buscar
              </Button>
            </div>

            {!syncStatus?.configurado && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                Cora não configurada (CORA_CLIENT_ID / certificados).
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="empresas">
        <TabsList>
          <TabsTrigger value="empresas">
            <Building2 className="mr-1 h-4 w-4" /> Empresas ({empresas?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="boletos">
            <Receipt className="mr-1 h-4 w-4" /> Boletos ({totalBoletos})
          </TabsTrigger>
        </TabsList>

        {/* Tab Empresas */}
        <TabsContent value="empresas" className="space-y-3">
          <Input
            placeholder="Filtrar por nome ou CNPJ..."
            className="max-w-sm"
            value={filtroEmpresa}
            onChange={(e) => setFiltroEmpresa(e.target.value)}
          />

          {loadingEmpresas ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <div className="rounded-lg border">
              <div className="grid grid-cols-[1fr_120px_100px_80px] gap-2 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
                <span>Empresa</span>
                <span>Boletos</span>
                <span>Último</span>
                <span>Ativo</span>
              </div>
              {empresasFiltradas.map((e) => (
                <div
                  key={e.id}
                  className="grid grid-cols-[1fr_120px_100px_80px] items-center gap-2 border-b px-4 py-2.5 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.name}</p>
                    <p className="text-xs text-muted-foreground">{e.cnpj}</p>
                  </div>
                  <span className="text-xs">
                    {e.total_boletos > 0 ? (
                      <Badge variant="secondary">{e.total_boletos}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.ultimo_importado
                      ? format(new Date(e.ultimo_importado), "dd/MM/yy")
                      : "—"}
                  </span>
                  <Switch
                    checked={e.boletos_ativo}
                    onCheckedChange={(checked) =>
                      toggleEmpresa.mutate({ id: e.id, ativo: checked })
                    }
                  />
                </div>
              ))}
              {empresasFiltradas.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Nenhuma empresa encontrada.
                </p>
              )}
            </div>
          )}
        </TabsContent>

        {/* Tab Boletos */}
        <TabsContent value="boletos" className="space-y-3">
          {loadingBoletos ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
          ) : totalBoletos === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
              <Receipt className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhum boleto importado ainda. Use "Sincronizar tudo" para fazer a carga inicial.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Empresa</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Vencimento</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Valor</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Competência</th>
                  </tr>
                </thead>
                <tbody>
                  {boletos!.map((b) => (
                    <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <p className="truncate font-medium max-w-[200px]">{b.empresa_nome}</p>
                        <p className="text-xs text-muted-foreground">{b.empresa_cnpj}</p>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(b.due_date)}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono">
                        {formatCurrency(b.valor_centavos)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <StatusBadge status={b.status} />
                          <DocTypeBadge docType={b.doc_type} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {b.competencia || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
};

export default BoletosCoraPage;
