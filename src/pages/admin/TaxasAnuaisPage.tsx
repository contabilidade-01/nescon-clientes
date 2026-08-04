import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck, Search } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type AnnualTaxStatus } from "@/lib/api";
import { ANNUAL_TAX_LABELS } from "@/lib/licenses";

const STATUSES: AnnualTaxStatus[] = ["pendente", "enviado", "confirmado"];

const BADGE: Record<AnnualTaxStatus, "outline" | "secondary" | "default"> = {
  pendente: "outline",
  enviado: "secondary",
  confirmado: "default",
};

/** Anos oferecidos no seletor: o atual e os quatro anteriores. */
function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear();
  return [0, 1, 2, 3, 4].map((i) => atual - i);
}

const TaxasAnuaisPage = () => {
  const queryClient = useQueryClient();
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<AnnualTaxStatus | "">("");

  const { data, isLoading } = useQuery({
    queryKey: ["taxas-anuais", ano],
    queryFn: () => api.taxasAnuais.listar(ano),
  });

  const marcar = useMutation({
    mutationFn: (v: { company_id: string; status: AnnualTaxStatus }) =>
      api.taxasAnuais.marcar({ company_id: v.company_id, ano, status: v.status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["taxas-anuais", ano] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const linhas = data?.empresas.filter((c) => {
    if (filtro && c.status !== filtro) return false;
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.cnpj.includes(q);
  });

  return (
    <AdminLayout
      title="Taxas anuais"
      description="Controle do envio das guias de taxa anual da prefeitura, por empresa e ano"
    >
      <div className="grid grid-cols-3 gap-3">
        {STATUSES.map((s) => {
          const ativo = filtro === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFiltro(ativo ? "" : s)}
              className={`rounded-xl border p-4 text-left transition-colors hover:border-primary/40 ${
                ativo ? "border-primary bg-primary/5" : "bg-card"
              }`}
            >
              <p className="text-xs text-muted-foreground">{ANNUAL_TAX_LABELS[s].title}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{data?.resumo[s] ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground">{ANNUAL_TAX_LABELS[s].description}</p>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarCheck className="h-4 w-4" /> Guias de taxa anual · {ano}
          </CardTitle>
          <CardDescription>
            Só empresas <strong>estabelecidas</strong> aparecem aqui. Empresa sem marcação conta
            como <strong>pendente</strong> — não criamos registros em branco na base.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anosDisponiveis().map((a) => (
                  <SelectItem key={a} value={String(a)}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative min-w-[12rem] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar por razão social ou CNPJ"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </div>

          <div className="max-h-[36rem] space-y-2 overflow-y-auto">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : linhas?.length ? (
              linhas.map((c) => (
                <div
                  key={c.company_id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      CNPJ {c.cnpj}
                      {c.enviado_em
                        ? ` · enviada em ${new Date(c.enviado_em).toLocaleDateString("pt-BR")}`
                        : ""}
                      {c.confirmado_em
                        ? ` · confirmada em ${new Date(c.confirmado_em).toLocaleDateString("pt-BR")}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={BADGE[c.status]}>{ANNUAL_TAX_LABELS[c.status].title}</Badge>
                    <div className="flex gap-1">
                      {STATUSES.map((s) => (
                        <Button
                          key={s}
                          type="button"
                          size="sm"
                          variant={c.status === s ? "default" : "outline"}
                          disabled={marcar.isPending || c.status === s}
                          onClick={() => marcar.mutate({ company_id: c.company_id, status: s })}
                        >
                          {ANNUAL_TAX_LABELS[s].title}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma empresa nesse filtro. Empresas não estabelecidas ficam fora deste controle
                (veja a aba <strong>Empresas estabelecidas</strong> em Licenças).
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </AdminLayout>
  );
};

export default TaxasAnuaisPage;
