import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PortalPage } from "@/components/PortalPage";
import { LinhaSetor } from "@/components/hub/Hub";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { setoresVisiveisPortal, type PortalItem } from "@/lib/portalNav";

/**
 * Tela de um setor do portal (/setor/:id): a lista das telas dele, como "Meus documentos"
 * da referência. Cada linha abre a rota de sempre — a permissão é checada lá e no servidor.
 */
export default function SetorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { company } = useAuth();
  const setor = setoresVisiveisPortal(company).find((s) => s.id === id);

  const temCertificado = Boolean(setor?.items.some((i) => i.key === "certificado_digital"));
  const { data: cert } = useQuery({
    queryKey: ["certificado-digital"],
    queryFn: () => api.certificadoDigital.meu(),
    enabled: temCertificado,
    retry: false,
  });

  if (!setor) return <Navigate to="/" replace />;

  const abrir = (item: PortalItem) => {
    if (item.tool) api.portal.registrarUso(item.tool);
    navigate(item.path);
  };

  const selo = (item: PortalItem) => {
    if (item.key !== "certificado_digital" || !cert) return undefined;
    if (cert.status === "vencido")
      return <span className="rounded-full bg-destructive/15 px-2 text-[10px] font-semibold text-destructive">vencido</span>;
    if (cert.status === "a_vencer")
      return <span className="rounded-full bg-warning/15 px-2 text-[10px] font-semibold text-warning">a vencer</span>;
    return undefined;
  };

  return (
    <PortalPage title={setor.label} subtitle="Setor">
      <p className="mb-2 text-sm text-muted-foreground">{setor.descricao}</p>
      <div className="rounded-2xl border bg-card px-3">
        {setor.items.map((item) => (
          <LinhaSetor
            key={item.key}
            icon={item.icon}
            titulo={item.title}
            descricao={item.description}
            badge={selo(item)}
            onClick={() => abrir(item)}
          />
        ))}
      </div>
    </PortalPage>
  );
}
