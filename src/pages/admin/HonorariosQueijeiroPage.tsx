import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Calculator, Loader2, Save, Store } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function competenciaBR(c: string): string {
  const [y, m] = c.split("-");
  return `${m}/${y}`;
}

const HonorariosQueijeiroPage = () => {
  const queryClient = useQueryClient();
  const [desde, setDesde] = useState("2026-01");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-honorarios-folha", desde],
    queryFn: () => api.admin.honorariosFolha(desde),
  });

  // Regra editável (base, registros da base, adicional).
  const { data: config } = useQuery({
    queryKey: ["admin-honorarios-config"],
    queryFn: () => api.admin.honorariosConfig(),
  });
  const [base, setBase] = useState("");
  const [registrosBase, setRegistrosBase] = useState("");
  const [adicional, setAdicional] = useState("");
  // Semeia os campos quando a config chega (e só então).
  useEffect(() => {
    if (config) {
      setBase(String(config.base));
      setRegistrosBase(String(config.registros_base));
      setAdicional(String(config.adicional));
    }
  }, [config]);

  const salvarRegra = useMutation({
    mutationFn: () =>
      api.admin.salvarHonorariosConfig({
        base: Number(base),
        registros_base: Number(registrosBase),
        adicional: Number(adicional),
      }),
    onSuccess: () => {
      toast.success("Regra salva. Os valores foram recalculados.");
      queryClient.invalidateQueries({ queryKey: ["admin-honorarios-config"] });
      queryClient.invalidateQueries({ queryKey: ["admin-honorarios-folha"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regraMudou =
    config &&
    (Number(base) !== config.base ||
      Number(registrosBase) !== config.registros_base ||
      Number(adicional) !== config.adicional);
  const regraValida =
    base !== "" && registrosBase !== "" && adicional !== "" &&
    Number(base) >= 0 && Number(registrosBase) >= 0 && Number(adicional) >= 0;

  const totalGeral = (data?.unidades ?? []).reduce((s, u) => s + u.total, 0);

  return (
    <AdminLayout
      title="Honorários Queijeiro"
      description="Calcula o honorário de cada unidade Queijeiro por mês, pela quantidade de registros na folha. Retroativo a partir da competência escolhida."
    >
      <div className="space-y-6">
        {/* Regra de cálculo — editável */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4" /> Regra de cálculo
            </CardTitle>
            <CardDescription>
              {config
                ? `Hoje: base de ${brl(config.base)} cobre até ${config.registros_base} registros; ` +
                  `a partir do ${config.registros_base + 1}º, ${brl(config.adicional)} por colaborador. ` +
                  `Alterar aqui recalcula todos os meses.`
                : "Carregando regra…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="hon-base">Base (R$)</Label>
              <Input
                id="hon-base"
                type="number"
                min={0}
                step="0.01"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className="mt-1 w-28"
              />
            </div>
            <div>
              <Label htmlFor="hon-reg">Registros na base</Label>
              <Input
                id="hon-reg"
                type="number"
                min={0}
                step="1"
                value={registrosBase}
                onChange={(e) => setRegistrosBase(e.target.value)}
                className="mt-1 w-32"
              />
            </div>
            <div>
              <Label htmlFor="hon-add">Adicional por colaborador (R$)</Label>
              <Input
                id="hon-add"
                type="number"
                min={0}
                step="0.01"
                value={adicional}
                onChange={(e) => setAdicional(e.target.value)}
                className="mt-1 w-28"
              />
            </div>
            <Button
              onClick={() => salvarRegra.mutate()}
              disabled={!regraValida || !regraMudou || salvarRegra.isPending}
            >
              {salvarRegra.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar regra
            </Button>
          </CardContent>
        </Card>

        {/* Período + total */}
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
                <p className="text-xs text-muted-foreground">Total do período (todas as unidades)</p>
                <p className="text-xl font-bold">{brl(totalGeral)}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.unidades.length ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma unidade Queijeiro encontrada (empresas com "Queijeiro" no nome).
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.unidades.map((u) => (
              <Card key={u.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Store className="h-4 w-4 text-muted-foreground" />
                    {u.name}
                  </CardTitle>
                  <CardDescription>{u.cnpj}</CardDescription>
                </CardHeader>
                <CardContent>
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
                    <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                      Meses "sem folha" mostram só a base — leia o Extrato Mensal para fechar o adicional.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default HonorariosQueijeiroPage;
