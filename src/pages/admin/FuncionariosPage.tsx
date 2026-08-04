import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, UserMinus, Users } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { CompanyFilter } from "@/components/admin/CompanyFilter";
import { AdminExtratoBulk } from "@/components/AdminExtratoBulk";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { maskCPF } from "@/lib/masks";

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
      <SaidasDaFolha />

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

/**
 * Quem está cadastrado mas não veio no último extrato.
 *
 * A leitura automática do extrato roda a cada sincronização e NÃO inativa ninguém: um
 * PDF lido pela metade tiraria gente da tela do cliente em silêncio. Quem confirma a
 * saída é uma pessoa, aqui.
 */
function SaidasDaFolha() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["saidas-folha"],
    queryFn: () => api.admin.saidasFolha(),
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["saidas-folha"] });
    queryClient.invalidateQueries({ queryKey: ["employees"] });
  };

  const inativar = useMutation({
    mutationFn: (id: string) => api.admin.inativarSaida(id),
    onSuccess: () => {
      invalidar();
      toast.success("Funcionário inativado — some para a empresa, fica no histórico do admin");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const manter = useMutation({
    mutationFn: (id: string) => api.admin.manterSaida(id),
    onSuccess: () => {
      invalidar();
      toast.success("Mantido ativo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const processar = useMutation({
    mutationFn: () => api.admin.processarExtratos(),
    onSuccess: (r) => {
      invalidar();
      toast.success(
        `${r.empresas} empresa(s) com extrato novo · ${r.inseridos} cadastrado(s) · ${r.avisos} aviso(s) de saída`
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saidas = data?.saidas ?? [];

  return (
    <Card className={saidas.length ? "border-amber-500/50" : undefined}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <UserMinus className="h-4 w-4" /> Saíram da folha
              {saidas.length > 0 ? ` (${saidas.length})` : ""}
            </CardTitle>
            <CardDescription>
              O extrato entra sozinho a cada sincronização e cadastra quem chega. Quem{" "}
              <strong>sumiu</strong> não é inativado automaticamente — precisa da sua confirmação.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => processar.mutate()}
            disabled={processar.isPending}
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${processar.isPending ? "animate-spin" : ""}`} />
            Ler extratos agora
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {saidas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ninguém pendente de confirmação.
          </p>
        ) : (
          saidas.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {s.company_name} · CPF {maskCPF(s.cpf)}
                  {s.competencia ? ` · fora da folha de ${s.competencia}` : ""}
                </p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="flex-1 sm:flex-none"
                  onClick={() => inativar.mutate(s.id)}
                  disabled={inativar.isPending}
                >
                  Confirmar saída
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={() => manter.mutate(s.id)}
                  disabled={manter.isPending}
                >
                  Manter ativo
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default FuncionariosPage;
