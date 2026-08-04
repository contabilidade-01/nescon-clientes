import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Plus } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { CompanyFilter } from "@/components/admin/CompanyFilter";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";
import { CompanyManageRow } from "@/components/admin/CompanyManageRow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { maskCNPJ } from "@/lib/masks";

const EmpresasPage = () => {
  const queryClient = useQueryClient();
  const { data: companies } = useAdminCompanies();
  const [companyId, setCompanyId] = useState("");

  const [newCoName, setNewCoName] = useState("");
  const [newCoCnpj, setNewCoCnpj] = useState("");
  const [newCoEmail, setNewCoEmail] = useState("");
  const [newCoPhone, setNewCoPhone] = useState("");

  const createCompany = useMutation({
    mutationFn: () =>
      api.admin.createCompany({
        name: newCoName.trim(),
        cnpj: newCoCnpj,
        contact_email: newCoEmail.trim() || null,
        phone: newCoPhone.replace(/\D/g, "") || null,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      toast.success(data.message);
      setNewCoName("");
      setNewCoCnpj("");
      setNewCoEmail("");
      setNewCoPhone("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selected = companies?.find((c) => c.id === companyId);

  return (
    <AdminLayout title="Empresas" description="Cadastro, contactos e permissões por CNPJ">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nova empresa (CNPJ)
          </CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            Cada CNPJ recebe <strong>acesso exclusivo</strong> à mesma aplicação: após login, vê só
            funcionários, documentos e atestados da própria empresa (isolamento na base de dados por{" "}
            <code className="text-xs">company_id</code>). Senha inicial ={" "}
            <strong>14 dígitos do CNPJ</strong>.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Razão social</Label>
              <Input
                value={newCoName}
                onChange={(e) => setNewCoName(e.target.value)}
                placeholder="Ex.: EMPRESA EXEMPLO LTDA (como no cartão CNPJ)"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CNPJ</Label>
              <Input
                value={newCoCnpj}
                onChange={(e) => setNewCoCnpj(maskCNPJ(e.target.value.replace(/\D/g, "").slice(0, 14)))}
                placeholder="00.000.000/0000-00"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Telefone (opcional)</Label>
              <Input
                value={newCoPhone}
                onChange={(e) => setNewCoPhone(e.target.value)}
                placeholder="DDD + número"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">E-mail (recuperação de senha, opcional)</Label>
              <Input
                type="email"
                value={newCoEmail}
                onChange={(e) => setNewCoEmail(e.target.value)}
                placeholder="contato@empresa.com"
              />
            </div>
          </div>
          <Button
            type="button"
            onClick={() => createCompany.mutate()}
            disabled={
              createCompany.isPending ||
              !newCoName.trim() ||
              newCoCnpj.replace(/\D/g, "").length !== 14
            }
          >
            Cadastrar empresa
          </Button>
        </CardContent>
      </Card>

      <CompanyFilter
        value={companyId}
        onChange={setCompanyId}
        description="Escolha o CNPJ para editar razão social, contactos e permissões. Com &quot;Todas&quot;, não mostramos o formulário — evita alterar a empresa errada."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Gestão da empresa
          </CardTitle>
          <CardDescription>
            Alterar a razão social atualiza também os documentos já emitidos com o nome antigo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!companies?.length ? (
            <p className="text-muted-foreground">Nenhuma empresa cadastrada.</p>
          ) : !companyId ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-muted-foreground">
              <p className="font-medium text-foreground">Selecione uma empresa no filtro</p>
              <p className="mt-1 text-xs leading-relaxed">
                Com &quot;Todas as empresas&quot;, não mostramos o formulário de edição para não correr
                o risco de mudar dados da empresa errada.
              </p>
            </div>
          ) : !selected ? (
            <p className="text-destructive">Empresa não encontrada. Escolha outra no filtro.</p>
          ) : (
            <CompanyManageRow key={selected.id} company={selected} />
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
};

export default EmpresasPage;
