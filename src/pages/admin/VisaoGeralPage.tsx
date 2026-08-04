import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, ShieldCheck } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { LICENSE_STATUS_LABELS } from "@/lib/licenses";

/** Cartão-número clicável: leva ao segmento correspondente do painel. */
function StatCard({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: number | string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className={onClick ? "cursor-pointer transition-colors hover:border-primary/40" : undefined}
    >
      <CardContent className="pt-4 pb-4 text-left">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const VisaoGeralPage = () => {
  const navigate = useNavigate();

  const { data: summary } = useQuery({
    queryKey: ["admin-summary"],
    queryFn: () => api.admin.summary(),
  });

  const { data: licencas } = useQuery({
    queryKey: ["licencas-overview"],
    queryFn: () => api.licencas.overview(),
  });

  const { data: lgpd } = useQuery({
    queryKey: ["lgpd-consents"],
    queryFn: () => api.admin.lgpdConsents(),
  });

  const atencao = (licencas?.por_status.vencida ?? 0) + (licencas?.por_status.a_vencer ?? 0);

  return (
    <AdminLayout
      title="Visão geral"
      description="Resumo do escritório: cadastro, entregas, licenças e conformidade"
    >
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Empresas" value={summary?.companies ?? "—"} onClick={() => navigate("/admin/empresas")} />
        <StatCard
          label="Entregas (guias/folha)"
          value={summary?.deliverables ?? "—"}
          hint={
            summary
              ? `${summary.deliverables_liberadas} liberadas · ${summary.deliverables_retidas} retidas`
              : undefined
          }
          onClick={() => navigate("/admin/entregas")}
        />
        <StatCard label="Docs DP (susp./advert.)" value={summary?.documents ?? "—"} onClick={() => navigate("/admin/entregas")} />
        <StatCard label="Funcionários" value={summary?.employees ?? "—"} onClick={() => navigate("/admin/funcionarios")} />
        <StatCard label="Atestados" value={summary?.certificates ?? "—"} onClick={() => navigate("/admin/entregas")} />
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Licenças
          </CardTitle>
          <CardDescription>
            {licencas
              ? `${licencas.estabelecidas} empresas estabelecidas (${licencas.nao_estabelecidas} não estabelecidas ficam fora deste controle). Aviso de vencimento com ${licencas.dias_aviso} dias de antecedência.`
              : "Carregando..."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["vencida", "a_vencer", "ativa", "ausente"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => navigate(`/admin/licencas?status=${s}`)}
              className="rounded-xl border bg-background/60 p-3 text-left transition-colors hover:border-primary/40"
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${LICENSE_STATUS_LABELS[s].dot}`} />
                {LICENSE_STATUS_LABELS[s].title}
              </span>
              <p className="mt-1 text-2xl font-bold tabular-nums">{licencas?.por_status[s] ?? "—"}</p>
            </button>
          ))}
        </CardContent>
      </Card>

      {atencao > 0 && (
        <button
          type="button"
          onClick={() => navigate("/admin/licencas?status=vencida")}
          className="flex w-full items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-left"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <span className="flex-1 text-sm">
            <strong>{atencao}</strong> licença(s) vencida(s) ou a vencer precisam de providência.
          </span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Consentimentos LGPD</CardTitle>
          <CardDescription>
            Aceite do cliente ao termo de tratamento de dados, registrado no primeiro acesso.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          {(["aceito", "visto", "pendente"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => navigate("/admin/lgpd")}
              className="rounded-xl border bg-background/60 p-3 text-left transition-colors hover:border-primary/40"
            >
              <p className="text-xs capitalize text-muted-foreground">{k}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{lgpd?.resumo[k] ?? "—"}</p>
            </button>
          ))}
        </CardContent>
      </Card>
    </AdminLayout>
  );
};

export default VisaoGeralPage;
