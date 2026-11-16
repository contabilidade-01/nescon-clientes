import { useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { CompanyPicker } from "@/components/admin/CompanyPicker";
import { SimuladorRegime } from "@/components/regime/SimuladorRegime";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";
import { isToolAllowed } from "@/lib/companyTools";

/**
 * Simulador de regime pelo escritório: simula QUALQUER cliente, esteja a ferramenta
 * liberada no portal dele ou não. Liberar ao cliente é a chave "Simulador de regime
 * (IBS/CBS)" em Empresas (nasce desligada).
 */
const RegimePage = () => {
  const [companyId, setCompanyId] = useState("");
  const { data: companies } = useAdminCompanies();
  const empresa = companies?.find((c) => c.id === companyId);

  return (
    <AdminLayout
      largo
      title="Simulador de regime (IBS/CBS)"
      description="Simples puro, Simples com IBS/CBS por fora ou Lucro Presumido: o que compensa para cada cliente de 2027 a 2033"
    >
      <div className="space-y-4">
        <div className="max-w-xl space-y-1">
          <CompanyPicker value={companyId} onChange={setCompanyId} allowAll={false} placeholder="Escolha a empresa" />
          {empresa && (
            <p className="text-xs text-muted-foreground">
              {isToolAllowed(empresa.tool_access, "regime_tributario")
                ? "Liberado no portal deste cliente."
                : "Ainda não liberado no portal deste cliente (ligue “Simulador de regime” em Empresas)."}
            </p>
          )}
        </div>
        {!companyId ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Escolha uma empresa para responder o questionário e comparar os regimes.
            </CardContent>
          </Card>
        ) : (
          <SimuladorRegime key={companyId} companyId={companyId} />
        )}
      </div>
    </AdminLayout>
  );
};

export default RegimePage;
