import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Mail,
  Plus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { maskCNPJ } from "@/lib/masks";
import {
  COMPANY_TOOL_KEYS,
  COMPANY_TOOL_LABELS,
  mergeClientToolAccess,
  type CompanyToolAccess,
  type CompanyToolKey,
} from "@/lib/companyTools";
import { Switch } from "@/components/ui/switch";
import { AdminEmployeeImport } from "@/components/AdminEmployeeImport";
import { AdminExtratoImport } from "@/components/AdminExtratoImport";
import { AdminDeliverableUpload } from "@/components/AdminDeliverableUpload";
import { AdminSyncCard } from "@/components/AdminSyncCard";


const AdminPage = () => {
  const navigate = useNavigate();
  const { admin, logout } = useAuth();
  const queryClient = useQueryClient();

  const [adminCompanyFilter, setAdminCompanyFilter] = useState<string>("");

  const { data: summary } = useQuery({
    queryKey: ["admin-summary"],
    queryFn: () => api.admin.summary(),
  });

  const { data: adminMe } = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => api.admin.me(),
  });

  const [adminEmail, setAdminEmail] = useState("");
  useEffect(() => {
    setAdminEmail(adminMe?.contact_email ?? "");
  }, [adminMe?.contact_email]);

  const saveAdminEmail = useMutation({
    mutationFn: () =>
      api.admin.updateMyContactEmail(adminEmail.trim() ? adminEmail.trim().toLowerCase() : null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-me"] });
      toast.success("E-mail do administrador atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: companies } = useQuery({
    queryKey: ["admin-companies"],
    queryFn: () => api.admin.companies(),
  });

  const listOpts = adminCompanyFilter ? { companyId: adminCompanyFilter } : undefined;

  const { data: documents, isLoading: loadingDocs } = useQuery({
    queryKey: ["issued-documents", "admin", adminCompanyFilter || "all"],
    queryFn: () => api.documents.list(listOpts),
  });

  const { data: employees, isLoading: loadingEmp } = useQuery({
    queryKey: ["employees", "admin", adminCompanyFilter || "all"],
    queryFn: () => api.employees.list(listOpts),
  });

  const { data: certificates, isLoading: loadingCert } = useQuery({
    queryKey: ["certificates", "admin", adminCompanyFilter || "all"],
    queryFn: () => api.certificates.list(listOpts),
  });

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

  const handleNewCoCnpj = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 14);
    setNewCoCnpj(maskCNPJ(digits));
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const filterLabel =
    adminCompanyFilter && companies
      ? companies.find((c) => c.id === adminCompanyFilter)?.name ?? "empresa selecionada"
      : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/login")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
              <LayoutDashboard className="h-5 w-5 text-primary" />
              Painel administrador
            </h1>
            <p className="text-xs text-muted-foreground">
              CPF: {admin?.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
              {" · "}
              <span className="text-foreground/80">Gestão de empresas, razão social e contactos</span>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/envio-guias")}>
            📤 Envio de Guias
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/alterar-senha")}>
            🔑 Senha
          </Button>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Sair
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 space-y-6">
        <AdminSyncCard />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4" /> Seu e-mail (recuperação de senha)
            </CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              Usado em &quot;Esqueci minha senha&quot; com o seu CPF de administrador. Sem e-mail
              cadastrado, a recuperação automática não funciona.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="admin-contact-email" className="text-xs">
                E-mail
              </Label>
              <Input
                id="admin-contact-email"
                type="email"
                placeholder="admin@empresa.com"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <Button
              type="button"
              onClick={() => saveAdminEmail.mutate()}
              disabled={saveAdminEmail.isPending}
            >
              Guardar
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="h-4 w-4" /> Nova empresa (CNPJ)
            </CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              Cada CNPJ recebe <strong>acesso exclusivo</strong> à mesma aplicação: após login, vê só
              funcionários, documentos e atestados da própria empresa (isolamento na base de dados por{" "}
              <code className="text-xs">company_id</code>). Senha inicial = <strong>14 dígitos do CNPJ</strong>.
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
                <Input value={newCoCnpj} onChange={(e) => handleNewCoCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Telefone (opcional)</Label>
                <Input value={newCoPhone} onChange={(e) => setNewCoPhone(e.target.value)} placeholder="DDD + número" />
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
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => createCompany.mutate()}
                disabled={createCompany.isPending || !newCoName.trim() || newCoCnpj.replace(/\D/g, "").length !== 14}
              >
                Cadastrar empresa
              </Button>
            </div>
          </CardContent>
        </Card>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Empresas</p>
                <p className="text-2xl font-bold">{summary.companies}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Documentos</p>
                <p className="text-2xl font-bold">{summary.documents}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Funcionários</p>
                <p className="text-2xl font-bold">{summary.employees}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Atestados</p>
                <p className="text-2xl font-bold">{summary.certificates}</p>
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Filtrar listas por empresa
            </CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              Afeta também a <strong>gestão de dados da empresa</strong> (razão social, e-mail e telefone)
              — só aparece uma empresa de cada vez. Documentos, funcionários e atestados seguem o mesmo
              filtro. &quot;Todas&quot; mostra todas nas listas, mas não permite editar cadastro de empresa
              (evita alterar outra por engano).
            </p>
          </CardHeader>
          <CardContent>
            <Select
              value={adminCompanyFilter || "__all__"}
              onValueChange={(v) => setAdminCompanyFilter(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="w-full sm:max-w-md">
                <SelectValue placeholder="Empresa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as empresas</SelectItem>
                {companies?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground"> · {c.cnpj}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Gestão de empresas
            </CardTitle>
            <CardDescription>
              Escolha uma empresa em <strong>Filtrar listas por empresa</strong> acima. Só então pode
              alterar a <strong>razão social</strong>, e-mail de recuperação e telefone{" "}
              <em>dessa</em> empresa. Alterar a razão social atualiza também os documentos já emitidos
              com o nome antigo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!companies?.length ? (
              <p className="text-muted-foreground text-sm">Nenhuma empresa cadastrada.</p>
            ) : !adminCompanyFilter ? (
              <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-muted-foreground">
                <p className="font-medium text-foreground">Selecione uma empresa no filtro</p>
                <p className="mt-1 text-xs leading-relaxed">
                  Com &quot;Todas as empresas&quot;, não mostramos o formulário de edição para não correr
                  o risco de mudar dados da empresa errada. Escolha o CNPJ desejado no menu
                  <strong> Filtrar listas por empresa</strong>.
                </p>
              </div>
            ) : (
              (() => {
                const selected = companies.find((c) => c.id === adminCompanyFilter);
                if (!selected) {
                  return (
                    <p className="text-destructive text-sm">
                      Empresa não encontrada. Escolha outra no filtro.
                    </p>
                  );
                }
                return <CompanyManageRow key={selected.id} company={selected} />;
              })()
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Documentos emitidos
              {filterLabel ? ` · ${filterLabel}` : " · todas as empresas"}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 overflow-y-auto space-y-2">
            {loadingDocs ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : documents?.length ? (
              documents.map((doc) => (
                <div key={doc.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={doc.document_type === "suspension" ? "default" : "secondary"}>
                      {doc.document_type === "suspension" ? "Suspensão" : "Advertência"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{doc.company_name}</span>
                  </div>
                  <p className="font-medium mt-1">{doc.employee_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(doc.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })} · CNPJ{" "}
                    {doc.company_cnpj}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum documento</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Funcionários
              {filterLabel ? ` · ${filterLabel}` : " · todas as empresas"}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 overflow-y-auto space-y-2 text-sm">
            {!adminCompanyFilter ? (
              <p className="text-muted-foreground text-xs">
                Selecione uma empresa no filtro acima para ver funcionários e importar planilha em{" "}
                <strong>Gestão de empresas</strong>.
              </p>
            ) : loadingEmp ? (
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
              <p className="text-muted-foreground text-xs">
                Nenhum funcionário. Em <strong>Gestão de empresas</strong>, use{" "}
                <strong>Importar funcionários (planilha)</strong> para subir o arquivo da Relação de Empregados.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4" /> Atestados
              {filterLabel ? ` · ${filterLabel}` : " · todas as empresas"}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 overflow-y-auto space-y-2 text-sm">
            {loadingCert ? (
              <p className="text-muted-foreground">Carregando...</p>
            ) : certificates?.length ? (
              certificates.map((c) => (
                <div key={c.id} className="flex flex-col border-b border-border/50 pb-2 last:border-0">
                  <span className="font-medium">{c.employee_name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.company_name ?? "—"} · {c.file_name} ·{" "}
                    {format(new Date(c.certificate_date), "dd/MM/yyyy", { locale: ptBR })}
                  </span>
                  <a
                    className="text-xs text-primary underline mt-1"
                    href={api.certificates.fileUrl(c.file_path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir arquivo
                  </a>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">Nenhum atestado</p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

function CompanyManageRow({
  company,
}: {
  company: {
    id: string;
    name: string;
    cnpj: string;
    contact_email: string | null;
    phone: string | null;
    tool_access: CompanyToolAccess;
  };
}) {
  const [name, setName] = useState(company.name);
  const [email, setEmail] = useState(company.contact_email ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [tools, setTools] = useState<CompanyToolAccess>(() => mergeClientToolAccess(company.tool_access));

  useEffect(() => {
    setName(company.name);
    setEmail(company.contact_email ?? "");
    setPhone(company.phone ?? "");
    setTools(mergeClientToolAccess(company.tool_access));
  }, [company.name, company.contact_email, company.phone, company.tool_access]);

  const queryClient = useQueryClient();

  const mut = useMutation({
    mutationFn: () =>
      api.admin.updateCompany(company.id, {
        name: name.trim(),
        contact_email: email.trim() ? email.trim().toLowerCase() : null,
        phone: phone.replace(/\D/g, "") ? phone.replace(/\D/g, "") : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      queryClient.invalidateQueries({ queryKey: ["issued-documents"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(`Razão social e dados de ${name.trim()} guardados`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveTools = useMutation({
    mutationFn: () => api.admin.updateCompany(company.id, { tool_access: tools }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      toast.success("Permissões das ferramentas atualizadas");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleTool = (key: CompanyToolKey, checked: boolean) => {
    setTools((prev) => ({ ...prev, [key]: checked }));
  };

  return (
    <div className="rounded-lg border bg-card/50 p-4 space-y-3 scroll-mt-2">
      <p className="text-xs font-mono text-muted-foreground">CNPJ {company.cnpj}</p>
      <div className="space-y-1">
        <Label htmlFor={`razao-${company.id}`} className="text-xs font-semibold">
          Razão social
        </Label>
        <Input
          id={`razao-${company.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Razão social conforme Receita Federal"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`email-${company.id}`} className="text-xs">
          E-mail (recuperação de senha)
        </Label>
        <Input id={`email-${company.id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`tel-${company.id}`} className="text-xs">
          Telefone
        </Label>
        <Input
          id={`tel-${company.id}`}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="DDD + número"
        />
      </div>
      <Button type="button" size="sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
        Guardar alterações
      </Button>

      <div className="border-t pt-4 mt-4 space-y-3">
        <div>
          <p className="text-xs font-semibold text-foreground">Ferramentas no app da empresa</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ligue ou desligue o acesso a cada módulo (menu após login com CNPJ). O servidor aplica de imediato;
            ao abrir o início da aplicação, o menu sincroniza com estas permissões.
          </p>
        </div>
        <div className="space-y-3">
          {COMPANY_TOOL_KEYS.map((key) => {
            const meta = COMPANY_TOOL_LABELS[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-md border bg-background/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">{meta.title}</p>
                  <p className="text-xs text-muted-foreground">{meta.description}</p>
                </div>
                <Switch
                  checked={tools[key]}
                  onCheckedChange={(c) => toggleTool(key, c)}
                  aria-label={meta.title}
                />
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => saveTools.mutate()}
          disabled={saveTools.isPending}
        >
          Guardar permissões das ferramentas
        </Button>
      </div>

      <AdminEmployeeImport
        companyId={company.id}
        companyCnpj={company.cnpj}
        companyName={company.name}
      />

      <AdminExtratoImport companyId={company.id} companyName={company.name} />

      <AdminDeliverableUpload companyId={company.id} companyName={company.name} />
    </div>
  );
}

export default AdminPage;
