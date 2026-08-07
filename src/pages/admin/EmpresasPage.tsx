import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, KeyRound, Plus, ShieldAlert } from "lucide-react";
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

  // A senha inicial é mostrada UMA vez, num aviso persistente. Não existe rota que a
  // consulte depois: uma tela que exibe senha de cliente é uma tela que vaza senha.
  const [senhaGerada, setSenhaGerada] = useState<{ empresa: string; senha: string } | null>(null);

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
      // A senha aparece UMA vez. Fica num aviso que não some sozinho — um toast de 4
      // segundos com a credencial do cliente é a receita para ela se perder.
      setSenhaGerada({ empresa: data.company.name, senha: data.senha_inicial });
      setNewCoName("");
      setNewCoCnpj("");
      setNewCoEmail("");
      setNewCoPhone("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const senhaPendente = useQuery({
    queryKey: ["senha-pendente"],
    queryFn: () => api.admin.senhaPendente(),
  });

  const gerarSenha = useMutation({
    mutationFn: (id: string) => api.admin.gerarSenhaInicial(id),
    onSuccess: (r) => {
      setSenhaGerada({ empresa: r.name, senha: r.senha_inicial });
      queryClient.invalidateQueries({ queryKey: ["senha-pendente"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selected = companies?.find((c) => c.id === companyId);

  return (
    <AdminLayout title="Empresas" description="Cadastro, contactos e permissões por CNPJ">
      {/* A senha aparece UMA vez, e este aviso não some sozinho. */}
      {senhaGerada && (
        <Card className="border-emerald-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" /> Senha de acesso de {senhaGerada.empresa}
            </CardTitle>
            <CardDescription>
              Anote e entregue ao cliente agora. <strong>Não é possível vê-la de novo</strong> —
              ela não fica guardada em texto em lugar nenhum. Se perder, gere outra.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <code className="rounded bg-muted px-3 py-2 font-mono text-lg tracking-wider">
              {senhaGerada.senha}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(senhaGerada.senha);
                toast.success("Senha copiada.");
              }}
            >
              Copiar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSenhaGerada(null)}>
              Já anotei
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Fila de risco: enquanto a senha inicial não for trocada, o acesso vale para
          quem a tiver. Nas empresas antigas essa senha era o CNPJ, que é público. */}
      {(senhaPendente.data?.total ?? 0) > 0 && (
        <Card className="border-amber-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              {senhaPendente.data?.total} empresa(s) ainda com a senha inicial
            </CardTitle>
            <CardDescription>
              Enquanto o cliente não troca, o acesso vale para quem tiver a senha. Nas
              empresas cadastradas antes desta mudança, a senha inicial era o próprio
              CNPJ — que é público. Gerar uma senha nova fecha esse acesso na hora.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {senhaPendente.data?.empresas.slice(0, 30).map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 last:border-0">
                <span className="min-w-0 truncate text-sm">
                  {c.name} <span className="text-xs text-muted-foreground">{maskCNPJ(c.cnpj)}</span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => gerarSenha.mutate(c.id)}
                  disabled={gerarSenha.isPending}
                >
                  Gerar senha nova
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
