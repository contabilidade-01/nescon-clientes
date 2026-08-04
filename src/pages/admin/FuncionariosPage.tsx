import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { CompanyFilter } from "@/components/admin/CompanyFilter";
import { AdminExtratoBulk } from "@/components/AdminExtratoBulk";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

const FuncionariosPage = () => {
  const [companyId, setCompanyId] = useState("");

  const { data: employees, isLoading } = useQuery({
    queryKey: ["employees", "admin", companyId || "all"],
    queryFn: () => api.employees.list(companyId ? { companyId } : undefined),
  });

  return (
    <AdminLayout
      title="Funcionários"
      description="Quadro de pessoal por empresa e cadastro em massa pelo extrato de folha"
    >
      <AdminExtratoBulk />

      <CompanyFilter
        value={companyId}
        onChange={setCompanyId}
        description="Filtra a lista abaixo. A importação por planilha fica na página Empresas, dentro da empresa escolhida."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Funcionários
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-[32rem] space-y-2 overflow-y-auto text-sm">
          {isLoading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : employees?.length ? (
            employees.map((e) => (
              <div key={e.id} className="flex flex-col border-b border-border/50 pb-2 last:border-0">
                <span className="font-medium">{e.name}</span>
                <span className="text-xs text-muted-foreground">
                  {e.company_name ?? "—"} · CPF {e.cpf}
                  {!e.active ? " · inativo" : ""}
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              Nenhum funcionário. Use o cadastro em massa pelo extrato acima, ou a importação por
              planilha em <strong>Empresas</strong>.
            </p>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
};

export default FuncionariosPage;
