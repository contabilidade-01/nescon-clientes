import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, Save, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function competenciaBR(c: string): string {
  const [y, m] = c.split("-");
  return `${m}/${y}`;
}

type Unidade = Awaited<ReturnType<typeof api.admin.honorariosFolha>>["unidades"][number];

/** Cartão de uma empresa: regra editável + tabela mensal + total. */
function UnidadeCard({ u }: { u: Unidade }) {
  const queryClient = useQueryClient();
  const [base, setBase] = useState(String(u.base));
  const [registrosBase, setRegistrosBase] = useState(String(u.registros_base));
  const [adicional, setAdicional] = useState(String(u.adicional));

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-honorarios-folha"] });
    queryClient.invalidateQueries({ queryKey: ["admin-honorarios-config"] });
  };

  const salvar = useMutation({
    mutationFn: () =>
      api.admin.salvarHonorarioRegra({
        company_id: u.id,
        base: Number(base),
        registros_base: Number(registrosBase),
        adicional: Number(adicional),
      }),
    onSuccess: () => {
      toast.success(`Regra de ${u.name} salva. Valores recalculados.`);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: () => api.admin.removerHonorarioRegra(u.id),
    onSuccess: () => {
      toast.success(`${u.name} removida da cobrança por headcount.`);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mudou =
    Number(base) !== u.base || Number(registrosBase) !== u.registros_base || Number(adicional) !== u.adicional;
  const valido =
    base !== "" && registrosBase !== "" && adicional !== "" &&
    Number(base) >= 0 && Number(registrosBase) >= 0 && Number(adicional) >= 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="h-4 w-4 text-muted-foreground" />
              {u.name}
            </CardTitle>
            <CardDescription>{u.cnpj}</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => {
              if (confirm(`Remover ${u.name} da cobrança por headcount?`)) remover.mutate();
            }}
            disabled={remover.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Regra da empresa */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
          <div>
            <Label className="text-xs">Base (R$)</Label>
            <Input type="number" min={0} step="0.01" value={base} onChange={(e) => setBase(e.target.value)} className="mt-1 w-24" />
          </div>
          <div>
            <Label className="text-xs">Registros na base</Label>
            <Input type="number" min={0} step="1" value={registrosBase} onChange={(e) => setRegistrosBase(e.target.value)} className="mt-1 w-28" />
          </div>
          <div>
            <Label className="text-xs">Adicional (R$)</Label>
            <Input type="number" min={0} step="0.01" value={adicional} onChange={(e) => setAdicional(e.target.value)} className="mt-1 w-24" />
          </div>
          <Button size="sm" onClick={() => salvar.mutate()} disabled={!valido || !mudou || salvar.isPending}>
            {salvar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Salvar
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-1.5 text-left font-medium">Competência</th>
                <th className="py-1.5 text-right font-medium">Registros</th>
                <th className="py-1.5 text-right font-medium">Honorário</th>
              </tr>
            </thead>
            <tbody>
              {u.meses.map((m) => (
                <tr key={m.competencia} className="border-b last:border-0">
                  <td className="py-1.5">{competenciaBR(m.competencia)}</td>
                  <td className="py-1.5 text-right">
                    {m.sem_folha ? (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
                        <AlertTriangle className="h-3 w-3" /> sem folha
                      </span>
                    ) : (
                      m.empregados
                    )}
                  </td>
                  <td className="py-1.5 text-right font-medium">{brl(m.honorario)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td className="py-2 font-medium">Total</td>
                <td />
                <td className="py-2 text-right font-bold">{brl(u.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {u.meses.some((m) => m.sem_folha) && (
          <p className="flex items-start gap-1 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
            Meses "sem folha" mostram só a base — leia o Extrato Mensal para fechar o adicional.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const HonorariosQueijeiroPage = () => {
  const queryClient = useQueryClient();
  const [desde, setDesde] = useState("2026-01");
  const [novaEmpresa, setNovaEmpresa] = useState("");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-honorarios-folha", desde],
    queryFn: () => api.admin.honorariosFolha(desde),
  });
  const { data: config } = useQuery({
    queryKey: ["admin-honorarios-config"],
    queryFn: () => api.admin.honorariosConfig(),
  });

  const adicionar = useMutation({
    mutationFn: (companyId: string) => api.admin.salvarHonorarioRegra({ company_id: companyId }),
    onSuccess: () => {
      toast.success("Empresa incluída na cobrança (com valores padrão — ajuste a regra dela).");
      setNovaEmpresa("");
      queryClient.invalidateQueries({ queryKey: ["admin-honorarios-folha"] });
      queryClient.invalidateQueries({ queryKey: ["admin-honorarios-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalGeral = (data?.unidades ?? []).reduce((s, u) => s + u.total, 0);

  return (
    <AdminLayout
      title="Honorários (folha)"
      description="Honorário por empresa, calculado pela quantidade de registros na folha, mês a mês. Cada empresa tem sua própria regra (base + registros + adicional), editável aqui."
    >
      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div>
              <Label htmlFor="desde">A partir da competência</Label>
              <Input
                id="desde"
                type="month"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="mt-1 max-w-[180px]"
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isFetching && <Loader2 className="h-4 w-4 animate-spin" />}
              {data ? `até ${competenciaBR(data.ate)}` : ""}
            </div>
            {data && data.unidades.length > 0 && (
              <div className="ml-auto rounded-lg border bg-muted/40 px-4 py-2">
                <p className="text-xs text-muted-foreground">Total do período (todas as empresas)</p>
                <p className="text-xl font-bold">{brl(totalGeral)}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Adicionar empresa à cobrança */}
        {config && config.disponiveis.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4" /> Incluir empresa na cobrança
              </CardTitle>
              <CardDescription>
                Ela entra com a regra padrão ({brl(config.padrao.base)} até {config.padrao.registros_base} registros,
                +{brl(config.padrao.adicional)}); ajuste os valores no cartão dela depois.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <Select value={novaEmpresa} onValueChange={setNovaEmpresa}>
                <SelectTrigger className="w-[320px] max-w-full">
                  <SelectValue placeholder="Escolha uma empresa…" />
                </SelectTrigger>
                <SelectContent>
                  {config.disponiveis.map((d) => (
                    <SelectItem key={d.company_id} value={d.company_id}>
                      {d.name} — {d.cnpj}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => novaEmpresa && adicionar.mutate(novaEmpresa)}
                disabled={!novaEmpresa || adicionar.isPending}
              >
                {adicionar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Incluir
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.unidades.length ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma empresa na cobrança por headcount ainda. Use "Incluir empresa" acima.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.unidades.map((u) => (
              <UnidadeCard key={u.id} u={u} />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default HonorariosQueijeiroPage;
