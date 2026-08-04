import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * Alertas abertos dos clientes do G-Click.
 *
 * Consultado pelo menu (badge), pela faixa da visão geral e pelo aviso de entrada —
 * a mesma chave de cache nos três, então é uma requisição só.
 *
 * Só o DONO consulta. Para os demais usuários do painel a rota responderia 403, e o
 * alerta de cliente novo não é assunto deles — quem decide quem entra no portal é o
 * dono. Com `pode` falso, badge, faixa e aviso de entrada somem juntos.
 */
export function useGclickPendencias() {
  const { admin } = useAuth();
  const pode = Boolean(admin?.isOwner);

  const query = useQuery({
    queryKey: ["gclick-pendencias"],
    queryFn: () => api.gclickClientes.pendencias(),
    enabled: Boolean(admin?.token) && pode,
  });

  return { ...query, pode, total: query.data?.total ?? 0 };
}
