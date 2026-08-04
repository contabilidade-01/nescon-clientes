import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { canSeeArea } from "@/lib/adminAreas";

/**
 * Alertas abertos dos clientes do G-Click.
 *
 * Consultado pelo menu (badge), pela faixa da visão geral e pelo aviso de entrada —
 * a mesma chave de cache nos três, então é uma requisição só.
 *
 * Só quem pode decidir consulta: sem a área de empresas, a rota responderia 403 e a
 * tela mostraria erro por algo que a pessoa nem deveria ver.
 */
export function useGclickPendencias() {
  const { admin } = useAuth();
  const pode = canSeeArea("empresas", admin?.areas, admin?.isOwner);

  const query = useQuery({
    queryKey: ["gclick-pendencias"],
    queryFn: () => api.gclickClientes.pendencias(),
    enabled: Boolean(admin?.token) && pode,
  });

  return { ...query, pode, total: query.data?.total ?? 0 };
}
