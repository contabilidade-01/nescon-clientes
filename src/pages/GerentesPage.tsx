import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Copy, KeyRound, Pencil, Plus, Trash2, UserCheck, UserCog, UserMinus, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Gerente } from "@/lib/api";
import { isToolAllowed } from "@/lib/companyTools";
import { maskCPF } from "@/lib/masks";
import { useAuth } from "@/hooks/useAuth";

/** O que a empresa pode delegar a um gerente (espelha api/src/gerentes.js). */
const PERMISSOES = [
  { key: "warning", label: "Advertência" },
  { key: "suspension", label: "Suspensão" },
] as const;

type Permissoes = Gerente["permissions"];

type Form = { id: string | null; cpf: string; nome: string; email: string; permissions: Permissoes };

const VAZIO: Form = { id: null, cpf: "", nome: "", email: "", permissions: { warning: true, suspension: true } };

/**
 * Gerentes: logins por CPF que a empresa cria para quem só emite advertência e
 * suspensão. A senha gerada aparece uma vez; a empresa repassa ao gerente, que troca
 * no primeiro acesso.
 */
const GerentesPage = () => {
  const navigate = useNavigate();
  const { company } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [senha, setSenha] = useState<{ nome: string; cpf: string; senha: string } | null>(null);

  const { data: gerentes = [], isLoading } = useQuery({
    queryKey: ["gerentes"],
    queryFn: () => api.gerentes.list(),
  });

  const liberada = (k: keyof Permissoes) => isToolAllowed(company?.toolAccess, k);
  const recarregar = () => qc.invalidateQueries({ queryKey: ["gerentes"] });

  const salvar = useMutation({
    mutationFn: async (f: Form) => {
      const permissions = { warning: Boolean(f.permissions.warning), suspension: Boolean(f.permissions.suspension) };
      if (f.id) {
        await api.gerentes.update(f.id, { nome: f.nome.trim(), email: f.email.trim() || null, permissions });
        return null;
      }
      return api.gerentes.create({ cpf: f.cpf, nome: f.nome.trim(), email: f.email.trim() || undefined, permissions });
    },
    onSuccess: (r) => {
      setForm(null);
      recarregar();
      if (r) setSenha({ nome: r.gerente.nome, cpf: r.gerente.cpf, senha: r.senha });
      else toast.success("Gerente atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alternarAtivo = useMutation({
    mutationFn: (g: Gerente) => api.gerentes.update(g.id, { active: !g.active }),
    onSuccess: (g) => {
      recarregar();
      toast.success(g.active ? "Acesso reativado" : "Acesso desativado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const novaSenha = useMutation({
    mutationFn: (g: Gerente) => api.gerentes.novaSenha(g.id),
    onSuccess: (r) => {
      recarregar();
      setSenha({ nome: r.gerente.nome, cpf: r.gerente.cpf, senha: r.senha });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: (g: Gerente) => api.gerentes.remove(g.id),
    onSuccess: () => {
      recarregar();
      toast.success("Gerente excluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copiarAcesso = () => {
    if (!senha) return;
    const texto = `Acesso ao Portal do Cliente\nLogin (CPF): ${maskCPF(senha.cpf)}\nSenha: ${senha.senha}\n${window.location.origin}/login\nNo primeiro acesso, o portal pede para você criar a sua senha.`;
    navigator.clipboard.writeText(texto).then(
      () => toast.success("Acesso copiado"),
      () => toast.error("Não foi possível copiar. Anote a senha.")
    );
  };

  const podeSalvar =
    form &&
    form.nome.trim().length >= 2 &&
    (form.id || form.cpf.replace(/\D/g, "").length === 11) &&
    PERMISSOES.some((p) => form.permissions[p.key]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-foreground">Gerentes</h1>
            <p className="text-xs text-muted-foreground">{company?.name}</p>
          </div>
          {!form && (
            <Button size="sm" className="gap-1" onClick={() => setForm({ ...VAZIO })}>
              <Plus className="h-4 w-4" /> Novo gerente
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 pb-24">
        <p className="text-sm text-muted-foreground">
          O gerente entra no portal com o próprio CPF e só vê o que você marcar: advertência e/ou
          suspensão. Ele não vê guias, boletos, folha nem os demais documentos da empresa.
        </p>

        {senha && (
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-semibold">Senha de {senha.nome}</p>
              <p className="text-sm">
                Login: <strong>{maskCPF(senha.cpf)}</strong> · Senha:{" "}
                <strong className="font-mono text-base">{senha.senha}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                A senha aparece só agora. Ela vale por 30 dias e o gerente cria a dele no primeiro acesso.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1" onClick={copiarAcesso}>
                  <Copy className="h-4 w-4" /> Copiar acesso
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSenha(null)}>
                  Fechar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {form && (
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{form.id ? "Editar gerente" : "Novo gerente"}</p>
                <Button variant="ghost" size="icon" onClick={() => setForm(null)} aria-label="Cancelar">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-cpf">CPF (login)</Label>
                <Input
                  id="g-cpf"
                  value={form.cpf}
                  disabled={Boolean(form.id)}
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  onChange={(e) => setForm({ ...form, cpf: maskCPF(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-nome">Nome</Label>
                <Input id="g-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-email">E-mail (opcional)</Label>
                <Input
                  id="g-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Pode emitir</Label>
                {PERMISSOES.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={Boolean(form.permissions[p.key])}
                      disabled={!liberada(p.key)}
                      onCheckedChange={(v) =>
                        setForm({ ...form, permissions: { ...form.permissions, [p.key]: v === true } })
                      }
                    />
                    {p.label}
                    {!liberada(p.key) && (
                      <span className="text-xs text-muted-foreground">(o escritório não liberou para a empresa)</span>
                    )}
                  </label>
                ))}
              </div>
              <Button className="w-full" disabled={!podeSalvar || salvar.isPending} onClick={() => form && salvar.mutate(form)}>
                {salvar.isPending ? "Salvando..." : form.id ? "Salvar" : "Criar e gerar senha"}
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : gerentes.length === 0 ? (
          !form && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <UserCog className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Nenhum gerente cadastrado.</p>
              </CardContent>
            </Card>
          )
        ) : (
          <div className="space-y-2">
            {gerentes.map((g) => (
              <Card key={g.id} className={g.active ? "" : "opacity-60"}>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{g.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      CPF {maskCPF(g.cpf)}
                      {g.ultimo_login_em
                        ? ` · último acesso ${new Date(g.ultimo_login_em).toLocaleDateString("pt-BR")}`
                        : " · nunca entrou"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {PERMISSOES.filter((p) => g.permissions?.[p.key]).map((p) => (
                        <Badge key={p.key} variant="secondary">{p.label}</Badge>
                      ))}
                      {!g.active && <Badge variant="destructive">Desativado</Badge>}
                      {g.active && g.must_change_password && <Badge variant="outline">Senha pendente</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar"
                      onClick={() =>
                        setForm({ id: g.id, cpf: maskCPF(g.cpf), nome: g.nome, email: g.email || "", permissions: { ...g.permissions } })
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Gerar nova senha"
                      title="Gerar nova senha"
                      disabled={novaSenha.isPending}
                      onClick={() => novaSenha.mutate(g)}
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={g.active ? "Desativar" : "Reativar"}
                      title={g.active ? "Desativar" : "Reativar"}
                      disabled={alternarAtivo.isPending}
                      onClick={() => alternarAtivo.mutate(g)}
                    >
                      {g.active ? <UserMinus className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Excluir">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir {g.nome}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            O acesso deixa de existir. Os documentos que ele emitiu continuam no histórico da empresa.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => remover.mutate(g)}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default GerentesPage;
