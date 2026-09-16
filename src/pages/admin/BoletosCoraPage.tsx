import { useEffect, useRef, useState } from "react";
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
  MessageCircle,
  Send,
  Square,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { dueTone, parseDue } from "@/lib/deliverableDisplay";
import { differenceInCalendarDays, startOfToday } from "date-fns";
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

/**
 * Selo de status do boleto.
 *
 * Recebe o VENCIMENTO junto porque "atrasado" não existe como status no banco — é um
 * pendente cuja data já passou. Sem isso, filtrar por "Atrasados" devolvia uma lista
 * inteira marcada como "Pendente": o filtro dizia uma coisa e a coluna dizia outra, e
 * quem estava cobrando não distinguia o que venceu ontem do que venceu em maio.
 */
function StatusBadge({ status, dueDate }: { status: string; dueDate?: string | null }) {
  if (dueTone(dueDate, status as "pending" | "paid") === "overdue") {
    const d = parseDue(dueDate);
    const dias = d ? Math.abs(differenceInCalendarDays(d, startOfToday())) : 0;
    return (
      <Badge className="bg-destructive/15 text-destructive border-destructive/30">
        <AlertTriangle className="mr-1 h-3 w-3" />
        {/* Os dias entram no selo porque mudam a prioridade da cobrança: um boleto de
            ontem e um de três meses atrás não pedem a mesma conversa. */}
        Atrasado{dias > 0 ? ` ${dias}d` : ""}
      </Badge>
    );
  }
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
  const [syncDe, setSyncDe] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [syncAte, setSyncAte] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

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
    mutationFn: () => api.admin.runCorSync(syncDe, syncAte),
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

  // Cancelar (excluir) boleto
  const cancelarBoleto = useMutation({
    mutationFn: (id: string) => api.admin.coraDeleteBoleto(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-cora-boletos"] });
      toast.success("Boleto cancelado (removido do portal)");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Enviar boleto por WhatsApp
  const enviarWhatsapp = useMutation({
    mutationFn: (id: string) => api.admin.coraEnviarWhatsapp(id),
    onSuccess: (r) => {
      toast.success(`Boleto enviado por WhatsApp para ${r.enviado_para}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rodando = syncStatus?.rodando || syncAll.isPending;
  const totalBoletos = boletos?.length || 0;
  const boletosPendentes = boletos?.filter((b) => b.status === "pending").length || 0;
  const boletosPagos = boletos?.filter((b) => b.status === "paid").length || 0;
  // `dueTone` é o mesmo cálculo do portal do cliente e converte a data para o fuso
  // local. A conta manual anterior comparava com `toISOString()` (UTC): depois das 21h
  // no horário de Brasília o "hoje" já era o dia seguinte, e um boleto vencendo hoje
  // aparecia como atrasado três horas mais cedo.
  const estaAtrasado = (b: { status: string; due_date?: string | null }) =>
    dueTone(b.due_date, b.status as "pending" | "paid") === "overdue";

  const boletosAtrasados = boletos?.filter(estaAtrasado).length || 0;

  // Filtro da tab de boletos
  const [filtroBoletoStatus, setFiltroBoletoStatus] = useState("");
  const [filtroBoletoEmpresa, setFiltroBoletoEmpresa] = useState("");
  const [filtroBoletoComp, setFiltroBoletoComp] = useState("");

  const boletosFiltrados = (boletos || []).filter((b) => {
    // "Atrasado" não existe como status no banco — é um pendente cujo vencimento já
    // passou. Por isso não dá para comparar com `b.status` e ele vira um caso próprio.
    if (filtroBoletoStatus === "overdue") {
      if (!estaAtrasado(b)) return false;
    } else if (filtroBoletoStatus && b.status !== filtroBoletoStatus) return false;
    if (filtroBoletoEmpresa && !b.empresa_nome.toLowerCase().includes(filtroBoletoEmpresa.toLowerCase()) && !b.empresa_cnpj.includes(filtroBoletoEmpresa)) return false;
    if (filtroBoletoComp && b.competencia !== filtroBoletoComp) return false;
    return true;
  });

  // ---------------------------------------------------------------------------
  // Envio em lote por WhatsApp (todos os filtrados ou só os marcados)
  //
  // Reaproveita o MESMO endpoint do botão individual, um boleto por vez: a mensagem
  // (régua de cobrança se vencido, lembrete se a vencer) e o PDF fresco da Cora ficam
  // num lugar só. O intervalo entre envios é proposital — disparo em rajada é o que
  // faz o WhatsApp restringir o número.
  // ---------------------------------------------------------------------------
  const INTERVALO_ENVIO_MS = 4000;

  /** Só entra no lote o que o botão individual também enviaria, e nunca boleto já pago. */
  const podeEnviar = (b: { pdf_url?: string | null; status: string }) =>
    Boolean(b.pdf_url) && b.status !== "paid";

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmarLote, setConfirmarLote] = useState<null | { ids: string[]; rotulo: string }>(null);
  const [lote, setLote] = useState<null | {
    total: number;
    feitos: number;
    ok: number;
    atual: string;
    falhas: Array<{ empresa: string; erro: string }>;
    rodando: boolean;
    interrompido: boolean;
  }>(null);
  const interromperRef = useRef(false);

  // Trocar o filtro limpa a seleção: evita enviar algo marcado que não está mais na tela.
  useEffect(() => {
    setSelecionados(new Set());
  }, [filtroBoletoStatus, filtroBoletoEmpresa, filtroBoletoComp]);

  const elegiveisFiltrados = boletosFiltrados.filter(podeEnviar);
  const marcadosElegiveis = elegiveisFiltrados.filter((b) => selecionados.has(b.id));
  const todosMarcados =
    elegiveisFiltrados.length > 0 && marcadosElegiveis.length === elegiveisFiltrados.length;
  const ignoradosSemPdf = boletosFiltrados.filter((b) => b.status !== "paid" && !b.pdf_url).length;

  const alternarTodos = (marcar: boolean) =>
    setSelecionados(marcar ? new Set(elegiveisFiltrados.map((b) => b.id)) : new Set());

  const alternarUm = (id: string, marcar: boolean) =>
    setSelecionados((prev) => {
      const novo = new Set(prev);
      if (marcar) novo.add(id);
      else novo.delete(id);
      return novo;
    });

  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const executarLote = async (ids: string[]) => {
    const porId = new Map((boletos || []).map((b) => [b.id, b]));
    interromperRef.current = false;
    setLote({ total: ids.length, feitos: 0, ok: 0, atual: "", falhas: [], rodando: true, interrompido: false });

    let ok = 0;
    const falhas: Array<{ empresa: string; erro: string }> = [];
    for (let i = 0; i < ids.length; i++) {
      if (interromperRef.current) break;
      const b = porId.get(ids[i]);
      const empresa = b?.empresa_nome || ids[i];
      setLote((l) => (l ? { ...l, atual: empresa } : l));
      try {
        await api.admin.coraEnviarWhatsapp(ids[i]);
        ok++;
      } catch (e) {
        falhas.push({ empresa, erro: e instanceof Error ? e.message : "Falha no envio" });
      }
      setLote((l) => (l ? { ...l, feitos: i + 1, ok, falhas: [...falhas] } : l));
      if (i < ids.length - 1 && !interromperRef.current) await esperar(INTERVALO_ENVIO_MS);
    }

    const interrompido = interromperRef.current;
    setLote((l) => (l ? { ...l, rodando: false, atual: "", interrompido } : l));
    setSelecionados(new Set());
    if (falhas.length) {
      toast.warning(`${ok} enviado(s), ${falhas.length} com falha${interrompido ? " (interrompido)" : ""}.`);
    } else {
      toast.success(`${ok} boleto(s) enviado(s) por WhatsApp${interrompido ? " (interrompido)" : ""}.`);
    }
  };

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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
            <p className="text-xs text-muted-foreground">Atrasados</p>
            <p className="text-2xl font-bold text-destructive">{boletosAtrasados}</p>
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
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">De</label>
              <Input
                type="month"
                className="h-9 w-40"
                value={syncDe}
                onChange={(e) => setSyncDe(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Até</label>
              <Input
                type="month"
                className="h-9 w-40"
                value={syncAte}
                onChange={(e) => setSyncAte(e.target.value)}
              />
            </div>
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
          {/* Filtros */}
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Empresa ou CNPJ..."
              className="h-9 w-48"
              value={filtroBoletoEmpresa}
              onChange={(e) => setFiltroBoletoEmpresa(e.target.value)}
            />
            <Input
              type="month"
              className="h-9 w-40"
              value={filtroBoletoComp}
              onChange={(e) => setFiltroBoletoComp(e.target.value)}
              placeholder="Competência"
            />
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={filtroBoletoStatus}
              onChange={(e) => setFiltroBoletoStatus(e.target.value)}
            >
              <option value="">Todos os status</option>
              <option value="pending">Pendentes</option>
              <option value="overdue">Atrasados</option>
              <option value="paid">Pagos</option>
            </select>
            {(filtroBoletoEmpresa || filtroBoletoComp || filtroBoletoStatus) && (
              <Button variant="ghost" size="sm" className="h-9" onClick={() => { setFiltroBoletoEmpresa(""); setFiltroBoletoComp(""); setFiltroBoletoStatus(""); }}>
                Limpar
              </Button>
            )}
            <span className="flex items-center text-xs text-muted-foreground ml-auto">
              {boletosFiltrados.length} de {totalBoletos}
            </span>
          </div>

          {/* Envio em lote */}
          {totalBoletos > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
              <MessageCircle className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">Enviar por WhatsApp</span>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={!marcadosElegiveis.length || lote?.rodando}
                onClick={() =>
                  setConfirmarLote({
                    ids: marcadosElegiveis.map((b) => b.id),
                    rotulo: `${marcadosElegiveis.length} boleto(s) marcado(s)`,
                  })
                }
              >
                <Send className="mr-1.5 h-3.5 w-3.5" /> Enviar marcados ({marcadosElegiveis.length})
              </Button>
              <Button
                size="sm"
                className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={!elegiveisFiltrados.length || lote?.rodando}
                onClick={() =>
                  setConfirmarLote({
                    ids: elegiveisFiltrados.map((b) => b.id),
                    rotulo: `todos os ${elegiveisFiltrados.length} boleto(s) da lista filtrada`,
                  })
                }
              >
                <Send className="mr-1.5 h-3.5 w-3.5" /> Enviar todos ({elegiveisFiltrados.length})
              </Button>
              <span className="text-xs text-muted-foreground">
                Pagos não entram no envio.
                {ignoradosSemPdf > 0 && ` ${ignoradosSemPdf} sem PDF ficam de fora.`}
              </span>
            </div>
          )}

          {lote && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {lote.rodando
                      ? `Enviando ${lote.feitos + 1} de ${lote.total}${lote.atual ? ` — ${lote.atual}` : ""}`
                      : `${lote.interrompido ? "Interrompido" : "Concluído"}: ${lote.ok} enviado(s)` +
                        (lote.falhas.length ? `, ${lote.falhas.length} com falha` : "")}
                  </span>
                  {lote.rodando ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => {
                        interromperRef.current = true;
                      }}
                    >
                      <Square className="mr-1 h-3 w-3" /> Interromper
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setLote(null)}>
                      Fechar
                    </Button>
                  )}
                </div>
                <Progress value={lote.total ? (lote.feitos / lote.total) * 100 : 0} />
                {lote.falhas.length > 0 && (
                  <ul className="max-h-40 space-y-0.5 overflow-auto text-xs text-destructive">
                    {lote.falhas.map((f, i) => (
                      <li key={i}>
                        <b>{f.empresa}</b>: {f.erro}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          <AlertDialog open={!!confirmarLote} onOpenChange={(o) => !o && setConfirmarLote(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Enviar boletos por WhatsApp?</AlertDialogTitle>
                <AlertDialogDescription>
                  Vou enviar {confirmarLote?.rotulo}, um por vez, com o PDF e a mensagem padrão
                  (cobrança para vencidos, lembrete para os que ainda vão vencer). Leva cerca de{" "}
                  {Math.max(1, Math.ceil(((confirmarLote?.ids.length || 0) * (INTERVALO_ENVIO_MS + 3000)) / 60000))}{" "}
                  min — mantenha esta página aberta. Dá para interromper no meio.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => {
                    const ids = confirmarLote?.ids || [];
                    setConfirmarLote(null);
                    if (ids.length) executarLote(ids);
                  }}
                >
                  Enviar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

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
                    <th className="w-8 px-3 py-2">
                      <Checkbox
                        checked={todosMarcados}
                        disabled={!elegiveisFiltrados.length || lote?.rodando}
                        onCheckedChange={(c) => alternarTodos(c === true)}
                        aria-label="Marcar todos os boletos enviáveis da lista"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Empresa</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Vencimento</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Valor</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Competência</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {boletosFiltrados.map((b) => (
                    <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="w-8 px-3 py-2">
                        {podeEnviar(b) && (
                          <Checkbox
                            checked={selecionados.has(b.id)}
                            disabled={lote?.rodando}
                            onCheckedChange={(c) => alternarUm(b.id, c === true)}
                            aria-label={`Marcar boleto de ${b.empresa_nome}`}
                          />
                        )}
                      </td>
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
                          <StatusBadge status={b.status} dueDate={b.due_date} />
                          <DocTypeBadge docType={b.doc_type} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {b.competencia || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {b.pdf_url && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-emerald-700 hover:text-emerald-800"
                              onClick={() => enviarWhatsapp.mutate(b.id)}
                              disabled={enviarWhatsapp.isPending || lote?.rodando}
                              title="Enviar PDF por WhatsApp"
                            >
                              <MessageCircle className="mr-1 h-3 w-3" /> WhatsApp
                            </Button>
                          )}
                          {b.status !== "paid" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-destructive hover:text-destructive"
                              onClick={() => cancelarBoleto.mutate(b.id)}
                              disabled={cancelarBoleto.isPending}
                            >
                              <XCircle className="mr-1 h-3 w-3" /> Cancelar
                            </Button>
                          )}
                        </div>
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
