import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Calculator, Loader2, Store } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
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
  const [desde, setDesde] = useState("2026-01");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-honorarios-folha", desde],
    queryFn: () => api.admin.honorariosFolha(desde),
  });

  const totalGeral = (data?.unidades ?? []).reduce((s, u) => s + u.total, 0);

  return (
    <AdminLayout
      title="Honorários Queijeiro"
      description="Calcula o honorário de cada unidade Queijeiro por mês, pela quantidade de registros na folha. Retroativo a partir da competência escolhida."
    >
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4" /> Regra de cálculo
            </CardTitle>
            <CardDescription>
              {data?.regra
                ? `Base de ${brl(data.regra.base)} cobre até ${data.regra.registros_base} registros. ` +
                  `A partir do ${data.regra.registros_base + 1}º, ${brl(data.regra.adicional)} por colaborador.`
                : "Carregando regra…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
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
