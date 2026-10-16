import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { CompanyPicker } from "@/components/admin/CompanyPicker";
import { PlanejadorEscala } from "@/components/escala/PlanejadorEscala";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";
import { api } from "@/lib/api";
import { isToolAllowed } from "@/lib/companyTools";

/**
 * Planejador de escalas pelo escritório: simula a escala de QUALQUER cliente, esteja a
 * ferramenta liberada no portal dele ou não. Liberar ao cliente é a chave "Escalas de
 * trabalho" em Empresas (nasce desligada).
 */
const EscalasPage = () => {
  const [companyId, setCompanyId] = useState("");
  const { data: companies } = useAdminCompanies();
  const empresa = companies?.find((c) => c.id === companyId);

  const { data: funcionarios, isLoading } = useQuery({
    queryKey: ["employees", companyId],
    queryFn: () => api.employees.list({ companyId }),
    enabled: Boolean(companyId),
  });

  const pessoas = useMemo(
    () => (funcionarios || []).filter((f) => f.active).map((f) => ({ id: f.id, name: f.name })),
    [funcionarios],
  );

  return (
    <AdminLayout
      title="Escalas de trabalho"
      description="Simule a escala de qualquer cliente contra o fim da 6x1 (EC 141/2026) e a CLT"
    >
      <div className="space-y-4">
        <div className="max-w-xl space-y-1">
          <CompanyPicker value={companyId} onChange={setCompanyId} allowAll={false} placeholder="Escolha a empresa" />
          {empresa && (
            <p className="text-xs text-muted-foreground">
              {isToolAllowed(empresa.tool_access, "escalas")
                ? "Liberado no portal deste cliente."
                : "Ainda não liberado no portal deste cliente (ligue “Escalas de trabalho” em Empresas)."}
            </p>
          )}
        </div>

        {!companyId ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Escolha uma empresa para montar a escala com os funcionários ativos dela.
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <PlanejadorEscala key={companyId} companyId={companyId} pessoas={pessoas} regime12x36Padrao={Boolean(empresa?.escala_12x36)} />
        )}
      </div>
    </AdminLayout>
  );
};

export default EscalasPage;
