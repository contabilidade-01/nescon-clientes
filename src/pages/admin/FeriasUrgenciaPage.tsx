import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Palmtree, Building2, Clock, CheckCircle2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useState } from "react";

function formatDate(d: string | null) {
  if (!d) return "—";
  return d.split("-").reverse().join("/");
}

const FeriasUrgenciaPage = () => {
  const [busca, setBusca] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-ferias-urgencia"],
    queryFn: () => api.admin.feriasUrgencia(),
  });

  const empresas = (data?.empresas || []).filter(
    (e) =>
      !busca ||
      e.empresa_nome.toLowerCase().includes(busca.toLowerCase()) ||
      e.empresa_cnpj.includes(busca) ||
      e.funcionarios.some((f) => f.nome.toLowerCase().includes(busca.toLowerCase()))
  );

  return (
    <AdminLayout
      title="Férias — Urgência"
      description="Funcionários de todas as empresas prestes a perder dias de férias (próximos 120 dias)"
    >
      {/* Resumo */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Empresas com alerta</p>
            <p className="text-2xl font-bold">{data?.total_empresas ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Funcionários em risco</p>
            <p className="text-2xl font-bold text-amber-600">{data?.total_funcionarios ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Férias já vencidas</p>
            <p className="text-2xl font-bold text-destructive">{data?.total_vencidos ?? "—"}</p>
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

      {/* Lista */}
      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
      ) : !empresas.length ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
          <Palmtree className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-2 text-sm text-muted-foreground">
            {busca ? "Nenhuma empresa encontrada com esse filtro." : "Nenhum funcionário com férias prestes a vencer nos próximos 120 dias. 🎉"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {empresas.map((emp) => (
            <Card key={emp.company_id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  {emp.empresa_nome}
                  <span className="text-xs text-muted-foreground font-normal">{emp.empresa_cnpj}</span>
                  <Badge variant="secondary" className="ml-auto">
                    {emp.funcionarios.length} funcionário(s)
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Funcionário</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tirar até</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Dias direito</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Faltas</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {emp.funcionarios.map((f) => (
                        <tr key={f.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{f.nome}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatDate(f.limite_gozo)}</td>
                          <td className="px-3 py-2">{f.dias_direito}</td>
                          <td className="px-3 py-2">{f.faltas ?? "—"}</td>
                          <td className="px-3 py-2">
                            {f.vencido ? (
                              <Badge className="bg-destructive/15 text-destructive border-destructive/30">
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                Vencido
                              </Badge>
                            ) : f.dias_para_vencer !== null && f.dias_para_vencer <= 30 ? (
                              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
                                <Clock className="mr-1 h-3 w-3" />
                                {f.dias_para_vencer}d restantes
                              </Badge>
                            ) : f.dias_para_vencer !== null && f.dias_para_vencer <= 90 ? (
                              <Badge variant="secondary">
                                <Clock className="mr-1 h-3 w-3" />
                                {f.dias_para_vencer}d restantes
                              </Badge>
                            ) : (
                              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                No prazo
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AdminLayout>
  );
};

export default FeriasUrgenciaPage;
