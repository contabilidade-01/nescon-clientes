import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Banknote,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Landmark,
  Loader2,
  Receipt,
  Search,
  XCircle,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

/** Competência anterior (mês fechado) em São Paulo — é a que se acompanha o envio. */
function competenciaAnterior(): string {
  const agora = new Date(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo" }).format(new Date())
  );
  agora.setDate(1);
  agora.setMonth(agora.getMonth() - 1);
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

const ICONE: Record<string, typeof FileText> = {
  folha: FileText,
  fgts: Landmark,
  inss: Banknote,
  das: Receipt,
};

type Empresa = { id: string; name: string; cnpj: string };

const AcompanhamentoEnvioPage = () => {
  const [competencia, setCompetencia] = useState(competenciaAnterior());
  const [sel, setSel] = useState<{ chave: string; status: "ok" | "pendentes" } | null>(null);
  const [busca, setBusca] = useState("");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-acompanhamento-envio", competencia],
    queryFn: () => api.admin.acompanhamentoEnvio(competencia),
  });

  const grupoSel = useMemo(
    () => data?.grupos.find((g) => g.chave === sel?.chave) || null,
    [data, sel]
  );

  const listaSel: Empresa[] = useMemo(() => {
    if (!grupoSel || !sel) return [];
    const base = sel.status === "ok" ? grupoSel.empresas_ok : grupoSel.empresas_pendentes;
    const t = busca.trim().toLowerCase();
    if (!t) return base;
    const td = t.replace(/\D/g, "");
    return base.filter(
      (e) => e.name.toLowerCase().includes(t) || (td && e.cnpj.replace(/\D/g, "").includes(td))
    );
  }, [grupoSel, sel, busca]);

  return (
    <AdminLayout
      title="Envio de folha e encargos"
      description="Visão por competência: quantas empresas estão em dia com Folha, FGTS, INSS e DAS — e quais faltam. Clique em um número para ver a lista."
    >
      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div>
              <Label htmlFor="comp">Competência</Label>
              <Input
                id="comp"
                type="month"
                value={competencia}
                onChange={(e) => {
                  setCompetencia(e.target.value);
                  setSel(null);
                }}
                className="mt-1 max-w-[180px]"
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isFetching && <Loader2 className="h-4 w-4 animate-spin" />}
              {data ? `${data.total_empresas} empresa(s) ativas` : ""}
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(data?.grupos ?? []).map((g) => {
                const Icone = ICONE[g.chave] || FileText;
                const tudoOk = g.pendentes === 0 && g.esperadas > 0;
                const selecionadoOk = sel?.chave === g.chave && sel.status === "ok";
                const selecionadoPend = sel?.chave === g.chave && sel.status === "pendentes";
                return (
                  <Card key={g.chave} className={tudoOk ? "border-emerald-500/40" : undefined}>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2">
                          <Icone className="h-4 w-4 text-muted-foreground" />
                          {g.rotulo}
                        </span>
                        {tudoOk && (
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                            <ClipboardCheck className="mr-1 h-3 w-3" /> Em dia
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        {g.esperadas} empresa(s) esperada(s) nesta competência
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setSel({ chave: g.chave, status: "ok" })}
                          className={`rounded-lg border p-3 text-left transition hover:bg-muted/50 ${
                            selecionadoOk ? "border-emerald-500 ring-1 ring-emerald-500/40" : ""
                          }`}
                        >
                          <div className="flex items-center gap-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-5 w-5" />
                            {g.ok}
                          </div>
                          <span className="text-xs text-muted-foreground">enviados</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSel({ chave: g.chave, status: "pendentes" })}
                          className={`rounded-lg border p-3 text-left transition hover:bg-muted/50 ${
                            selecionadoPend ? "border-destructive ring-1 ring-destructive/40" : ""
                          } ${g.pendentes > 0 ? "" : "opacity-70"}`}
                        >
                          <div
                            className={`flex items-center gap-1 text-2xl font-bold ${
                              g.pendentes > 0 ? "text-destructive" : "text-muted-foreground"
                            }`}
                          >
                            <XCircle className="h-5 w-5" />
                            {g.pendentes}
                          </div>
                          <span className="text-xs text-muted-foreground">pendentes</span>
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Lista da seleção */}
            {sel && grupoSel && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {sel.status === "ok" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    {grupoSel.rotulo} — {sel.status === "ok" ? "enviados" : "pendentes"} (
                    {listaSel.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="Buscar por nome ou CNPJ…"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                    />
                  </div>
                  {listaSel.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {sel.status === "pendentes"
                        ? "Nenhuma empresa pendente — tudo enviado nesta competência. 🎉"
                        : "Nenhuma empresa nesta lista."}
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {listaSel.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <span className="min-w-0 truncate text-sm font-medium">{e.name}</span>
                          <span className="text-xs text-muted-foreground">{e.cnpj}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}

            {!sel && (
              <p className="text-center text-sm text-muted-foreground">
                Clique em <span className="font-medium text-emerald-600">enviados</span> ou{" "}
                <span className="font-medium text-destructive">pendentes</span> de um cartão para ver as empresas.
              </p>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
};

export default AcompanhamentoEnvioPage;
