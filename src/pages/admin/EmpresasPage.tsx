import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Building2, Eye, KeyRound, Plus, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";
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
import { useAuth } from "@/hooks/useAuth";
import { mergeClientToolAccess } from "@/lib/companyTools";

const EmpresasPage = () => {
  const queryClient = useQueryClient();
  const { admin, login } = useAuth();
  const { data: companies } = useAdminCompanies();
  const [companyId, setCompanyId] = useState("");
  const [motivoArquivar, setMotivoArquivar] = useState("");
  const [confirmArquivar, setConfirmArquivar] = useState(false);
  const [motivoExcluir, setMotivoExcluir] = useState("");
  const [confirmExcluir, setConfirmExcluir] = useState(false);
  const [buscaEmpresa, setBuscaEmpresa] = useState("");

  // A senha inicial é mostrada UMA vez, num aviso persistente. Não existe rota que a
  // consulte depois: uma tela que exibe senha de cliente é uma tela que vaza senha.
  const [senhaGerada, setSenhaGerada] = useState<{ empresa: string; senha: string } | null>(null);

  const [newCoName, setNewCoName] = useState("");
  const [newCoCnpj, setNewCoCnpj] = useState("");
  const [newCoEmail, setNewCoEmail] = useState("");
  const [newCoPhone, setNewCoPhone] = useState("");

  /** Personificar: admin entra no portal como se fosse a empresa. */
  const handlePersonificar = async (companyId: string, companyName: string) => {
    try {
      const data = await api.admin.personificar(companyId);
      // Salva a sessão admin atual para poder voltar
      const adminSession = localStorage.getItem("company_session");
      if (adminSession) localStorage.setItem("admin_session_backup", adminSession);

      // Entra como empresa
      login({
        role: "company",
        id: data.company.id,
        name: data.company.name,
        cnpj: data.company.cnpj,
        token: data.token,
        toolAccess: mergeClientToolAccess(data.company.tool_access),
        isMatriz: data.is_matriz,
        empresasGrupo: data.empresas_grupo || [],
      });
      toast.success(`Entrando como ${companyName}...`);
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao personificar");
    }
  };

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

  // Arquivamento
  const arquivar = useMutation({
    mutationFn: () => api.admin.arquivarEmpresa(companyId, motivoArquivar.trim() || undefined),
    onSuccess: (r) => {
      if (r.ja_estava_arquivada) {
        toast.info("Empresa já estava arquivada.");
      } else {
        toast.success("Empresa arquivada. Não recebe mais nada e perde acesso ao portal.");
      }
      setCompanyId("");
      setMotivoArquivar("");
      setConfirmArquivar(false);
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      queryClient.invalidateQueries({ queryKey: ["admin-empresas-arquivadas"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reativar = useMutation({
    mutationFn: (id: string) => api.admin.reativarEmpresa(id),
    onSuccess: () => {
      toast.success("Empresa reativada — voltou a receber documentos e pode acessar o portal.");
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      queryClient.invalidateQueries({ queryKey: ["admin-empresas-arquivadas"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const arquivadas = useQuery({
    queryKey: ["admin-empresas-arquivadas"],
    queryFn: () => api.admin.empresasArquivadas(),
    enabled: !!admin?.isOwner,
  });

  const excluidas = useQuery({
    queryKey: ["admin-empresas-excluidas"],
    queryFn: () => api.admin.empresasExcluidas(),
    enabled: !!admin?.isOwner,
  });

  // Arquivar rápido (da lista, sem motivo — o confirm do browser já é a confirmação)
  const arquivar2 = useMutation({
    mutationFn: (id: string) => api.admin.arquivarEmpresa(id),
    onSuccess: () => {
      toast.success("Empresa arquivada.");
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      queryClient.invalidateQueries({ queryKey: ["admin-empresas-arquivadas"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: () => api.admin.excluirEmpresa(companyId, motivoExcluir.trim() || undefined),
    onSuccess: () => {
      toast.success("Empresa excluída. Dados históricos mantidos no banco.");
      setCompanyId("");
      setMotivoExcluir("");
      setConfirmExcluir(false);
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      queryClient.invalidateQueries({ queryKey: ["admin-empresas-excluidas"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revertExcluir = useMutation({
    mutationFn: (id: string) => api.admin.revertExclusao(id),
    onSuccess: () => {
      toast.success("Exclusão revertida.");
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      queryClient.invalidateQueries({ queryKey: ["admin-empresas-excluidas"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const empresasFiltradas = (companies || []).filter((c) => {
    if (!buscaEmpresa) return true;
    const termo = buscaEmpresa.toLowerCase();
    return c.name.toLowerCase().includes(termo) || c.cnpj.includes(buscaEmpresa.replace(/\D/g, ""));
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

      {/* Lista completa de empresas com ação rápida de arquivar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Empresas ativas ({companies?.length || 0})
          </CardTitle>
          <CardDescription>
            Clique em "Arquivar" para tirar a empresa do sistema. Ela perde acesso ao portal e
            para de receber tudo. Só o dono pode reativar depois.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            placeholder="Buscar por nome ou CNPJ..."
            className="max-w-sm"
            value={buscaEmpresa}
            onChange={(e) => setBuscaEmpresa(e.target.value)}
          />
          <div className="max-h-[400px] overflow-y-auto rounded-lg border">
            {empresasFiltradas.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>
            ) : (
              empresasFiltradas.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{maskCNPJ(c.cnpj)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="default"
                      size="sm"
                      className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm font-semibold"
                      onClick={() => handlePersonificar(c.id, c.name)}
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" /> Entrar como
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (confirm(`Arquivar "${c.name}"?\n\nA empresa perde acesso ao portal e para de receber documentos, boletos e alertas.`)) {
                          arquivar2.mutate(c.id);
                        }
                      }}
                      disabled={arquivar2.isPending}
                    >
                      <Archive className="mr-1 h-3.5 w-3.5" /> Arquivar
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
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

          {/* Botão de arquivar — só aparece quando uma empresa está selecionada */}
          {selected && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <p className="text-sm font-medium text-destructive">Arquivar empresa</p>
              <p className="text-xs text-muted-foreground">
                A empresa some de todos os painéis, para de receber alertas/boletos/documentos e
                perde acesso ao portal. Dados históricos ficam intactos. Só o dono do sistema pode reativar.
              </p>
              {!confirmArquivar ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={() => setConfirmArquivar(true)}
                >
                  <Archive className="mr-1 h-4 w-4" /> Arquivar {selected.name}
                </Button>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder="Motivo (opcional, ex: encerrou contrato)"
                    value={motivoArquivar}
                    onChange={(e) => setMotivoArquivar(e.target.value)}
                    className="max-w-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => arquivar.mutate()}
                      disabled={arquivar.isPending}
                    >
                      Confirmar arquivamento
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setConfirmArquivar(false); setMotivoArquivar(""); }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Botão de exclusão na seção de gestão */}
      {selected && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-600" /> Excluir empresa
            </CardTitle>
            <CardDescription>
              A empresa some de todos os painéis e não pode mais acessar o portal.
              Dados históricos ficam no banco (reversível). Só você (dono) pode reverter.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!confirmExcluir ? (
              <Button
                variant="outline"
                size="sm"
                className="border-red-600/50 text-red-600 hover:bg-red-500/10"
                onClick={() => setConfirmExcluir(true)}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Excluir {selected.name}
              </Button>
            ) : (
              <div className="space-y-2">
                <Input
                  placeholder="Motivo (opcional)"
                  value={motivoExcluir}
                  onChange={(e) => setMotivoExcluir(e.target.value)}
                  className="max-w-sm"
                />
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => excluir.mutate()}
                    disabled={excluir.isPending}
                  >
                    Confirmar exclusão
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setConfirmExcluir(false);
                      setMotivoExcluir("");
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Lista de empresas arquivadas — só o dono do sistema */}
      {admin?.isOwner && (arquivadas.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Archive className="h-4 w-4" /> Empresas arquivadas ({arquivadas.data?.length})
            </CardTitle>
            <CardDescription>
              Empresas que não recebem mais nada e não têm acesso ao portal. Só você (dono) pode reativar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {arquivadas.data?.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {maskCNPJ(c.cnpj)}
                    {c.arquivada_motivo && <> · {c.arquivada_motivo}</>}
                    {c.arquivada_por_nome && <> · por {c.arquivada_por_nome}</>}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (confirm(`Reativar ${c.name}? Volta a receber tudo e pode acessar o portal.`)) {
                      reativar.mutate(c.id);
                    }
                  }}
                  disabled={reativar.isPending}
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reativar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Lista de empresas excluídas — só o dono do sistema */}
      {admin?.isOwner && (excluidas.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Trash2 className="h-4 w-4" /> Empresas excluídas ({excluidas.data?.length})
            </CardTitle>
            <CardDescription>
              Empresas removidas do sistema. Dados históricos (entregas, funcionários, boletos)
              permanecem. Só você (dono) pode reverter.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {excluidas.data?.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {maskCNPJ(c.cnpj)}
                    {c.excluida_motivo && <> · {c.excluida_motivo}</>}
                    {c.excluida_por_nome && <> · por {c.excluida_por_nome}</>}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (confirm(`Reverter exclusão de ${c.name}? Volta a aparecer nos painéis.`)) {
                      revertExcluir.mutate(c.id);
                    }
                  }}
                  disabled={revertExcluir.isPending}
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reverter
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </AdminLayout>
  );
};

export default EmpresasPage;
