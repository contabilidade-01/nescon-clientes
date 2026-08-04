import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

const SITUACAO: Record<
  "aceito" | "visto" | "pendente",
  { title: string; description: string; badge: "default" | "secondary" | "outline" }
> = {
  aceito: { title: "Aceito", description: "Cliente concordou com o termo", badge: "default" },
  visto: { title: "Visto sem aceite", description: "Viu o aviso e fechou", badge: "secondary" },
  pendente: { title: "Pendente", description: "Ainda não viu o aviso", badge: "outline" },
};

function dataHora(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

const LgpdPage = () => {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"aceito" | "visto" | "pendente" | "">("");

  const { data, isLoading } = useQuery({
    queryKey: ["lgpd-consents"],
    queryFn: () => api.admin.lgpdConsents(),
  });

  const { data: termo } = useQuery({
    queryKey: ["lgpd-termo"],
    queryFn: () => api.lgpd.termo(),
  });

  const linhas = data?.empresas.filter((c) => {
    if (filtro && c.situacao !== filtro) return false;
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.cnpj.includes(q);
  });

  return (
    <AdminLayout
      title="Consentimentos LGPD"
      description="Quem concordou com o tratamento de dados, quando e em que versão do termo"
    >
      <div className="grid grid-cols-3 gap-3">
        {(["aceito", "visto", "pendente"] as const).map((s) => {
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
              <p className="text-xs text-muted-foreground">{SITUACAO[s].title}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{data?.resumo[s] ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground">{SITUACAO[s].description}</p>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Termo em vigor
          </CardTitle>
          <CardDescription>
            Versão <strong>{data?.versao_atual ?? termo?.versao ?? "—"}</strong>. É exatamente este
            texto que o cliente vê no primeiro acesso. Alterar o texto exige subir a versão em{" "}
            <code className="text-xs">api/src/lgpd.js</code> — aceites antigos continuam registrados
            com a versão da época.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          {termo ? (
            <>
              <p className="font-medium text-foreground">{termo.titulo}</p>
              {termo.paragrafos.map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
              <p className="text-xs italic">☐ {termo.checkbox}</p>
            </>
          ) : (
            <p>Carregando...</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Empresas</CardTitle>
          <CardDescription>
            O aviso não bloqueia o portal: quem fechou sem aceitar aparece como{" "}
            <strong>visto sem aceite</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar por razão social ou CNPJ"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="max-h-[36rem] space-y-2 overflow-y-auto">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : linhas?.length ? (
              linhas.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      CNPJ {c.cnpj}
                      {c.lgpd_consent_at ? ` · aceite em ${dataHora(c.lgpd_consent_at)}` : ""}
                      {c.lgpd_consent_version ? ` · versão ${c.lgpd_consent_version}` : ""}
                      {!c.lgpd_consent_at && c.lgpd_prompt_seen_at
                        ? ` · visto em ${dataHora(c.lgpd_prompt_seen_at)}`
                        : ""}
                    </p>
                  </div>
                  <Badge variant={SITUACAO[c.situacao].badge}>{SITUACAO[c.situacao].title}</Badge>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma empresa nesse filtro.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </AdminLayout>
  );
};

export default LgpdPage;
