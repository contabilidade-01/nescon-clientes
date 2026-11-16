import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { BarraEmpilhada, Indicador } from "@/components/hub/Hub";
import { useAuth } from "@/hooks/useAuth";
import { useGclickPendencias } from "@/hooks/useGclickPendencias";
import { useIndicadoresSetores } from "@/hooks/useIndicadoresSetores";
import { setoresVisiveis } from "@/lib/adminNav";

/**
 * Tela de um setor do painel (/admin/setor/:id): os números do setor e um cartão por
 * página. A página em si continua na rota de sempre, com a trava de área dela.
 */
export default function SetorAdminPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { admin } = useAuth();
  const setor = setoresVisiveis(admin).find((s) => s.id === id);
  const { indicadores, barras } = useIndicadoresSetores();
  const { total: pendenciasGclick } = useGclickPendencias();

  if (!setor) return <Navigate to="/admin/hub" replace />;
  const nums = indicadores[setor.id] ?? [];
  const barra = barras[setor.id];

  return (
    <AdminLayout title={setor.label} description={setor.descricao}>
      {(nums.length > 0 || barra) && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {nums.map((i) => (
            <Indicador
              key={i.label}
              label={i.label}
              valor={i.valor}
              dica={i.dica}
              tom={i.tom}
              onClick={i.to ? () => navigate(i.to!) : undefined}
            />
          ))}
          {barra && (
            <div className="flex flex-col justify-center rounded-xl border bg-background/50 px-3 py-2.5 sm:col-span-2">
              <BarraEmpilhada partes={barra.partes} />
              <p className="mt-1.5 text-[11px] text-muted-foreground">{barra.legenda}</p>
            </div>
          )}
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {setor.items.map((item) => (
          <button
            key={item.to}
            type="button"
            onClick={() => navigate(item.to)}
            className="group flex min-w-0 items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/15 text-primary">
              <item.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.label}</span>
            {item.badgePendencias && pendenciasGclick > 0 && (
              <span className="rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                {pendenciasGclick}
              </span>
            )}
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
          </button>
        ))}
      </section>
    </AdminLayout>
  );
}
