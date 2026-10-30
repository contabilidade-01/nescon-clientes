import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GitMerge, RefreshCw, UserMinus, Users } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { CompanyFilter } from "@/components/admin/CompanyFilter";
import { AdminExtratoBulk } from "@/components/AdminExtratoBulk";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

      <UnificacaoCadastros companyId={companyId} />

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
                  {e.company_name ?? "—"} · {e.cpf ? `CPF ${maskCPF(e.cpf)}` : "CPF pendente"}
                  {!e.active ? " · inativo" : ""}
                  {e.origem === "cliente" && !e.codigo ? " · cadastrado pelo cliente" : ""}
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
                {/* Inativar tira o funcionário da vista do cliente. Reversível, mas
                    não deve acontecer por um toque errado numa lista. */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="flex-1 sm:flex-none"
                      disabled={inativar.isPending}
                    >
                      Confirmar saída
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirmar a saída de {s.nome}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Ele deixa de aparecer para {s.company_name} e continua no seu histórico.
                        Se for afastamento ou extrato incompleto, use <strong>Manter ativo</strong>.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => inativar.mutate(s.id)}>
                        Sim, saiu da folha
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
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

/**
 * Cadastros que o cliente fez sozinho (ou vieram de listagem sem CPF) e a folha ainda não
 * confirmou. Mesmo CPF ou mesmo nome já são unidos na importação; aqui fica o que pede
 * um olho: nome escrito diferente, CPF com dígito trocado, ou admissão nova de verdade.
 */
function UnificacaoCadastros({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const [escolha, setEscolha] = useState<Record<string, string>>({});

  const { data } = useQuery({
    queryKey: ["employee-unificacao", companyId || "all"],
    queryFn: () => api.admin.employeeUnificacao(companyId || undefined),
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["employee-unificacao"] });
    queryClient.invalidateQueries({ queryKey: ["employees"] });
  };

  const unificar = useMutation({
    mutationFn: ({ manter, absorver }: { manter: string; absorver: string }) =>
      api.admin.unificarFuncionarios(manter, absorver),
    onSuccess: () => {
      invalidar();
      toast.success("Cadastros unificados — o histórico passou para o cadastro da folha");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const conferir = useMutation({
    mutationFn: (id: string) => api.admin.conferirFuncionario(id),
    onSuccess: () => {
      invalidar();
      toast.success("Mantido como funcionário novo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendentes = data?.pendentes ?? [];
  if (!pendentes.length) return null;

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <GitMerge className="h-4 w-4" /> Cadastrados pelo cliente ({pendentes.length})
        </CardTitle>
        <CardDescription>
          O cliente cadastra sem precisar de aprovação. Quando a folha chega, quem tem o mesmo CPF ou
          o mesmo nome é unificado sozinho. Estes precisam da sua conferência: escolha o cadastro da
          folha que é a mesma pessoa, ou confirme que é admissão nova.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {pendentes.map((p) => {
          const alvo = escolha[p.provisorio.id] ?? p.sugestao?.id ?? "";
          return (
            <div key={p.provisorio.id} className="space-y-2 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.provisorio.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.company_name} ·{" "}
                  {p.provisorio.cpf ? `CPF ${maskCPF(p.provisorio.cpf)}` : "CPF pendente"} ·{" "}
                  {p.provisorio.origem === "cliente" ? "cadastrado pelo cliente" : "veio de listagem sem CPF"}
                  {p.provisorio.created_at
                    ? ` em ${new Date(p.provisorio.created_at).toLocaleDateString("pt-BR")}`
                    : ""}
                </p>
                {p.sugestao && (
                  <p className="text-xs text-primary">
                    Provável mesma pessoa: {p.sugestao.name} ({p.semelhanca}% parecido)
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm sm:flex-1"
                  value={alvo}
                  onChange={(e) => setEscolha((prev) => ({ ...prev, [p.provisorio.id]: e.target.value }))}
                >
                  <option value="">Unificar com…</option>
                  {p.opcoes.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.cpf ? ` - ${maskCPF(o.cpf)}` : ""}
                      {o.active ? "" : " (inativo)"}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    disabled={!alvo || unificar.isPending}
                    onClick={() => unificar.mutate({ manter: alvo, absorver: p.provisorio.id })}
                  >
                    Unificar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    disabled={conferir.isPending}
                    onClick={() => conferir.mutate(p.provisorio.id)}
                  >
                    É funcionário novo
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default FuncionariosPage;
