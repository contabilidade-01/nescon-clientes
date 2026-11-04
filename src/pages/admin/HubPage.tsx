import { useNavigate } from "react-router-dom";
import { ArrowUpRight, LayoutDashboard, UserPlus } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PainelSetor } from "@/components/admin/PainelSetor";
import { useAuth } from "@/hooks/useAuth";
import { useIndicadoresSetores } from "@/hooks/useIndicadoresSetores";
import { ITEM_VISAO_GERAL, setoresVisiveis } from "@/lib/adminNav";
import { ManutencaoCard } from "./VisaoGeralPage";

/**
 * Tela "Geral" do painel (porta de entrada): um painel por setor com os números dele e
 * atalhos para as páginas. Só mostra o que a pessoa pode ver (mesmas regras do menu).
 */
export default function HubPage() {
  const navigate = useNavigate();
  const { admin } = useAuth();
  const setores = setoresVisiveis(admin);
  const { indicadores, barras, pendencias } = useIndicadoresSetores();
  const saudacao = admin?.nome ? `Olá, ${admin.nome.split(" ")[0]}` : "Escolha o setor para trabalhar";

  return (
    <AdminLayout title="Geral" description={saudacao}>
      {/* Faixa fixa: só sai quando o dono decide sobre o cliente novo. */}
      {(pendencias?.total ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => navigate("/admin/clientes-gclick")}
          className="flex w-full items-center gap-3 rounded-xl border border-primary bg-primary/10 px-4 py-3 text-left"
        >
          <UserPlus className="h-5 w-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {pendencias!.novos_count > 0
                ? `${pendencias!.novos_count} cliente(s) novo(s) do G-Click aguardando decisão`
                : `${pendencias!.mudancas_count} mudança(s) de situação para revisar`}
            </span>
            <span className="block text-xs text-muted-foreground">Clique para cadastrar, recusar ou dar ciência.</span>
          </span>
          <ArrowUpRight className="h-5 w-5 shrink-0 text-primary" />
        </button>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {setores.map((setor) => (
          <div key={setor.id} data-testid={`setor-${setor.id}`} className="contents">
            <PainelSetor setor={setor} indicadores={indicadores[setor.id] ?? []} barra={barras[setor.id]} />
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {admin?.isOwner && <ManutencaoCard />}
        <button
          type="button"
          onClick={() => navigate(ITEM_VISAO_GERAL.to)}
          className="flex items-center gap-3 self-start rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
        >
          <LayoutDashboard className="h-5 w-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{ITEM_VISAO_GERAL.label}</span>
            <span className="block text-xs text-muted-foreground">
              Cobertura, licenças por tipo, atendimento e LGPD em detalhe
            </span>
          </span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </AdminLayout>
  );
}
