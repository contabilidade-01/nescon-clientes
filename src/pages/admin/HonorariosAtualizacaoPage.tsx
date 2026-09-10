import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Download,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
  Scale,
} from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";

type Empresa = Awaited<ReturnType<typeof api.admin.honorariosAtualizacao>>["empresas"][number];
type Situacao = Empresa["situacao"] | "todos";

const ENQ_LABEL: Record<string, string> = {
  mei: "MEI",
  simples: "Simples",
  presumido: "Presumido",
  real: "Real",
};
const TIPO_LABEL: Record<string, string> = {
  servico: "Serviço",
  comercio: "Comércio",
  industria: "Indústria",
};
const COMP_LABEL: Record<string, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
};

function brlCentavos(c: number | null | undefined): string {
  if (c == null) return "—";
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function centavosDeInput(v: string): number | null {
  const t = v.trim().replace(/\./g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function inputDeCentavos(c: number | null | undefined): string {
  if (c == null) return "";
  return (c / 100).toFixed(2).replace(".", ",");
}

function SituacaoBadge({ s }: { s: Empresa["situacao"] }) {
  if (s === "prejuizo") return <Badge variant="destructive">Prejuízo</Badge>;
  if (s === "equilibrio")
    return <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Equilíbrio</Badge>;
  if (s === "lucro")
    return <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Lucro</Badge>;
  return <Badge variant="secondary">Pendente</Badge>;
}

type Draft = {
  enquadramento: string;
  tipo_empresa: string;
  complexidade: string;
  atual: string;
  ideal: string;
};

function draftFrom(e: Empresa): Draft {
  return {
    enquadramento: e.enquadramento || "",
    tipo_empresa: e.tipo_empresa || "",
    complexidade: e.complexidade || "",
    atual: inputDeCentavos(e.atual_centavos),
    ideal: inputDeCentavos(e.ideal_centavos),
  };
}

function LinhaEmpresa({
  e,
  enums,
  padroes,
}: {
  e: Empresa;
  enums: { enquadramentos: string[]; tipos: string[]; complexidades: string[] };
  padroes: Awaited<ReturnType<typeof api.admin.honorariosAtualizacao>>["padroes"];
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(e));
  const [idealManual, setIdealManual] = useState(e.ideal_ajustado);

  useEffect(() => {
    setDraft(draftFrom(e));
    setIdealManual(e.ideal_ajustado);
  }, [
    e.company_id,
    e.atualizado_em,
    e.atual_centavos,
    e.ideal_centavos,
    e.enquadramento,
    e.tipo_empresa,
    e.complexidade,
    e.ok_manual,
    e.ideal_ajustado,
  ]);

  const aplicarPerfil = (patch: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (idealManual) return next;
      const padrao = padroes.find(
        (p) =>
          p.ativo &&
          p.enquadramento === next.enquadramento &&
          p.tipo_empresa === next.tipo_empresa &&
          p.complexidade === next.complexidade
      );
      if (padrao) next.ideal = inputDeCentavos(padrao.valor_a_partir_centavos);
      return next;
    });
  };

  const salvar = useMutation({
    mutationFn: () =>
      api.admin.salvarHonorarioAtualizacaoEmpresa(e.company_id, {
        enquadramento: draft.enquadramento || null,
        tipo_empresa: draft.tipo_empresa || null,
        complexidade: draft.complexidade || null,
        atual_centavos: centavosDeInput(draft.atual),
        ideal_centavos: centavosDeInput(draft.ideal),
      }),
    onSuccess: () => {
      toast.success(`${e.name} salva.`);
      queryClient.invalidateQueries({ queryKey: ["admin-honorarios-atualizacao"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleOk = useMutation({
    mutationFn: (checked: boolean) =>
      api.admin.salvarHonorarioAtualizacaoEmpresa(e.company_id, { ok_manual: checked }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-honorarios-atualizacao"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const limparOk = useMutation({
    mutationFn: () =>
      api.admin.salvarHonorarioAtualizacaoEmpresa(e.company_id, { limpar_ok_manual: true }),
    onSuccess: () => {
      toast.success("OK voltou ao automático.");
      queryClient.invalidateQueries({ queryKey: ["admin-honorarios-atualizacao"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const ocultar = useMutation({
    mutationFn: () => api.admin.ocultarHonorarioAtualizacao(e.company_id, true),
    onSuccess: () => {
      toast.success(`${e.name} ocultada desta lista.`);
      queryClient.invalidateQueries({ queryKey: ["admin-honorarios-atualizacao"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const mudou =
    draft.enquadramento !== (e.enquadramento || "") ||
    draft.tipo_empresa !== (e.tipo_empresa || "") ||
    draft.complexidade !== (e.complexidade || "") ||
    centavosDeInput(draft.atual) !== e.atual_centavos ||
    centavosDeInput(draft.ideal) !== e.ideal_centavos;

  return (
    <tr className="border-b align-top hover:bg-muted/30">
      <td className="px-2 py-2">
        <div className="font-medium leading-tight">{e.name}</div>
        <div className="text-xs text-muted-foreground">{e.cnpj}</div>
      </td>
      <td className="px-1 py-2">
        <Select
          value={draft.enquadramento || "__none"}
          onValueChange={(v) => aplicarPerfil({ enquadramento: v === "__none" ? "" : v })}
        >
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            {enums.enquadramentos.map((v) => (
              <SelectItem key={v} value={v}>
                {ENQ_LABEL[v] || v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-1 py-2">
        <Select
          value={draft.tipo_empresa || "__none"}
          onValueChange={(v) => aplicarPerfil({ tipo_empresa: v === "__none" ? "" : v })}
        >
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            {enums.tipos.map((v) => (
              <SelectItem key={v} value={v}>
                {TIPO_LABEL[v] || v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-1 py-2">
        <Select
          value={draft.complexidade || "__none"}
          onValueChange={(v) => aplicarPerfil({ complexidade: v === "__none" ? "" : v })}
        >
          <SelectTrigger className="h-8 w-[100px] text-xs">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            {enums.complexidades.map((v) => (
              <SelectItem key={v} value={v}>
                {COMP_LABEL[v] || v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-1 py-2">
        <Input
          className="h-8 w-[100px] text-right text-xs"
          value={draft.atual}
          onChange={(ev) => setDraft((d) => ({ ...d, atual: ev.target.value }))}
          placeholder="0,00"
        />
        {e.atual_origem === "cora" && (
          <div className="mt-0.5 text-[10px] text-muted-foreground">Cora</div>
        )}
      </td>
      <td className="px-1 py-2">
        <div className="text-[10px] text-muted-foreground">a partir de</div>
        <Input
          className="h-8 w-[100px] text-right text-xs"
          value={draft.ideal}
          onChange={(ev) => {
            setIdealManual(true);
            setDraft((d) => ({ ...d, ideal: ev.target.value }));
          }}
          placeholder="0,00"
        />
        {e.ideal_sugerido_centavos != null && (
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            sug. {brlCentavos(e.ideal_sugerido_centavos)}
            {e.ideal_ajustado ? " · ajustado" : ""}
          </div>
        )}
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col gap-1">
          <SituacaoBadge s={e.situacao} />
          {e.situacao !== "pendente" && (
            <span className="text-[10px] text-muted-foreground">
              {e.dentro ? "Dentro" : "Fora"} do esperado
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={e.ok}
              onCheckedChange={(v) => toggleOk.mutate(v === true)}
              disabled={toggleOk.isPending}
            />
            {e.ok && <Check className="h-3.5 w-3.5 text-emerald-600" />}
          </div>
          {e.ok_editado_manual && (
            <button
              type="button"
              className="text-[10px] text-amber-700 underline"
              onClick={() => limparOk.mutate()}
            >
              editado manual · reverter
            </button>
          )}
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            variant={mudou ? "default" : "outline"}
            className="h-8"
            disabled={!mudou || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground"
            disabled={ocultar.isPending}
            onClick={() => {
              if (confirm(`Ocultar ${e.name} desta lista?`)) ocultar.mutate();
            }}
            title="Ocultar desta lista"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

const HonorariosAtualizacaoPage = () => {
  const queryClient = useQueryClient();
  const [filtroSit, setFiltroSit] = useState<Situacao>("todos");
  const [filtroEnq, setFiltroEnq] = useState<string>("todos");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [tolAbaixo, setTolAbaixo] = useState("");
  const [tolAcima, setTolAcima] = useState("");
  const [ocultosAbertos, setOcultosAbertos] = useState(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-honorarios-atualizacao"],
    queryFn: () => api.admin.honorariosAtualizacao(),
  });

  const configKey = data
    ? `${data.config.tol_abaixo_pct}|${data.config.tol_acima_pct}`
    : "";
  useEffect(() => {
    if (!data) return;
    setTolAbaixo(String(data.config.tol_abaixo_pct));
    setTolAcima(String(data.config.tol_acima_pct));
  }, [configKey, data]);

  const salvarConfig = useMutation({
    mutationFn: () =>
      api.admin.salvarHonorariosAtualizacaoConfig({
        tol_abaixo_pct: Number(tolAbaixo),
        tol_acima_pct: Number(tolAcima),
      }),
    onSuccess: () => {
      toast.success("Tolerâncias salvas.");
      queryClient.invalidateQueries({ queryKey: ["admin-honorarios-atualizacao"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const importar = useMutation({
    mutationFn: () => api.admin.importarHonorariosAtualizacaoCora(),
    onSuccess: (r) => {
      toast.success(
        r.importados
          ? `${r.importados} honorário(s) importado(s) do Cora.`
          : "Nenhum valor novo para importar (já preenchidos ou sem boleto)."
      );
      queryClient.invalidateQueries({ queryKey: ["admin-honorarios-atualizacao"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reexibir = useMutation({
    mutationFn: (id: string) => api.admin.ocultarHonorarioAtualizacao(id, false),
    onSuccess: () => {
      toast.success("Cliente reexibido.");
      queryClient.invalidateQueries({ queryKey: ["admin-honorarios-atualizacao"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const visiveis = useMemo(() => {
    const list = (data?.empresas ?? []).filter((e) => !e.oculto);
    const q = busca.trim().toLowerCase();
    return list.filter((e) => {
      if (filtroSit !== "todos" && e.situacao !== filtroSit) return false;
      if (filtroEnq !== "todos" && e.enquadramento !== filtroEnq) return false;
      if (filtroTipo !== "todos" && e.tipo_empresa !== filtroTipo) return false;
      if (q && !e.name.toLowerCase().includes(q) && !e.cnpj.includes(q)) return false;
      return true;
    });
  }, [data, filtroSit, filtroEnq, filtroTipo, busca]);

  const ocultos = useMemo(
    () => (data?.empresas ?? []).filter((e) => e.oculto),
    [data]
  );

  const t = data?.totais;
  const configMudou =
    data &&
    (Number(tolAbaixo) !== data.config.tol_abaixo_pct ||
      Number(tolAcima) !== data.config.tol_acima_pct);

  return (
    <AdminLayout
      title="Atualização de Honorários"
      description="Valide honorários frente à reforma tributária e ao reajuste anual: perfil do cliente, ideal sugerido, balanço lucro / equilíbrio / prejuízo."
    >
      <div className="space-y-6">
        {/* Resumo */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            { label: "Visíveis", value: t?.total ?? "—" },
            { label: "Pendentes", value: t?.pendentes ?? "—" },
            { label: "Prejuízo", value: t?.prejuizo ?? "—" },
            { label: "Equilíbrio", value: t?.equilibrio ?? "—" },
            { label: "Lucro", value: t?.lucro ?? "—" },
            {
              label: "% dentro do esperado",
              value: t?.pct_dentro == null ? "—" : `${t.pct_dentro}%`,
            },
          ].map((c) => (
            <Card key={c.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-2xl font-semibold tabular-nums">{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Config + import */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4" /> Tolerâncias e importação
            </CardTitle>
            <CardDescription>
              Aceitável abaixo do ideal ainda conta como equilíbrio. Acima do teto = lucro.
              Importação do Cora só preenche quem ainda não tem honorário atual.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">% aceitável abaixo</Label>
              <Input
                className="mt-1 w-24"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={tolAbaixo}
                onChange={(e) => setTolAbaixo(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">% teto equilíbrio</Label>
              <Input
                className="mt-1 w-24"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={tolAcima}
                onChange={(e) => setTolAcima(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={!configMudou || salvarConfig.isPending}
              onClick={() => salvarConfig.mutate()}
            >
              {salvarConfig.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Salvar tolerâncias
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={importar.isPending}
              onClick={() => importar.mutate()}
            >
              {importar.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1 h-4 w-4" />
              )}
              Importar do Cora (carga única)
            </Button>
            {isFetching && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardContent>
        </Card>

        {/* Filtros */}
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div>
              <Label className="text-xs">Busca</Label>
              <Input
                className="mt-1 w-[220px]"
                placeholder="Nome ou CNPJ"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Situação</Label>
              <Select value={filtroSit} onValueChange={(v) => setFiltroSit(v as Situacao)}>
                <SelectTrigger className="mt-1 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="prejuizo">Prejuízo</SelectItem>
                  <SelectItem value="equilibrio">Equilíbrio</SelectItem>
                  <SelectItem value="lucro">Lucro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Enquadramento</Label>
              <Select value={filtroEnq} onValueChange={setFiltroEnq}>
                <SelectTrigger className="mt-1 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {(data?.enums.enquadramentos ?? []).map((v) => (
                    <SelectItem key={v} value={v}>
                      {ENQ_LABEL[v] || v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                <SelectTrigger className="mt-1 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {(data?.enums.tipos ?? []).map((v) => (
                    <SelectItem key={v} value={v}>
                      {TIPO_LABEL[v] || v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              {visiveis.length} cliente(s) na tabela
            </p>
          </CardContent>
        </Card>

        {/* Tabela */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Cliente</th>
                    <th className="px-1 py-2 font-medium">Enquadr.</th>
                    <th className="px-1 py-2 font-medium">Tipo</th>
                    <th className="px-1 py-2 font-medium">Compl.</th>
                    <th className="px-1 py-2 font-medium">Atual</th>
                    <th className="px-1 py-2 font-medium">Ideal</th>
                    <th className="px-2 py-2 font-medium">Situação</th>
                    <th className="px-2 py-2 font-medium">OK</th>
                    <th className="px-2 py-2 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                        Nenhum cliente nesta filtragem.
                      </td>
                    </tr>
                  ) : (
                    visiveis.map((e) => (
                      <LinhaEmpresa
                        key={e.company_id}
                        e={e}
                        enums={data!.enums}
                        padroes={data!.padroes}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Ocultos */}
        {ocultos.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={() => setOcultosAbertos((v) => !v)}
              >
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <EyeOff className="h-4 w-4" /> Ocultos ({ocultos.length})
                  </CardTitle>
                  <CardDescription>Clientes que não entram nesta lista de atualização.</CardDescription>
                </div>
                <Eye className="h-4 w-4 text-muted-foreground" />
              </button>
            </CardHeader>
            {ocultosAbertos && (
              <CardContent className="space-y-2">
                {ocultos.map((e) => (
                  <div
                    key={e.company_id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div>
                      <p className="font-medium">{e.name}</p>
                      <p className="text-xs text-muted-foreground">{e.cnpj}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reexibir.isPending}
                      onClick={() => reexibir.mutate(e.company_id)}
                    >
                      Reexibir
                    </Button>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        )}
      </div>
    </AdminLayout>
  );
};

export default HonorariosAtualizacaoPage;
