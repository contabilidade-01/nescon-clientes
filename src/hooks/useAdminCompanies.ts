import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Empresas do banco (as mesmas que a sincronização com o G-Click cria). */
export function useAdminCompanies() {
  return useQuery({
    queryKey: ["admin-companies"],
    queryFn: () => api.admin.companies(),
  });
}
