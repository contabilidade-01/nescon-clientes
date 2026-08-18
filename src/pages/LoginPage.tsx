import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, Lock, LogIn, Wrench } from "lucide-react";
import { maskCNPJ, maskCPF } from "@/lib/masks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { mergeClientToolAccess } from "@/lib/companyTools";
import { mergeAdminAreas } from "@/lib/adminAreas";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const LoginPage = () => {
  const [loginField, setLoginField] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [manutencao, setManutencao] = useState<{ ativo: boolean; mensagem: string } | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  // Avisa o cliente já na porta se o portal está em manutenção (o admin ainda entra).
  useEffect(() => {
    api.auth
      .maintenance()
      .then((r) => setManutencao(r.ativo ? r : null))
      .catch(() => setManutencao(null));
  }, []);

  const handleLoginField = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 14);
    setLoginField(digits.length <= 11 ? maskCPF(digits) : maskCNPJ(digits));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginField || !password) {
      toast.error("Preencha login e senha");
      return;
    }

    setLoading(true);
    try {
      const data = await api.auth.login(loginField, password);
      if (data.role === "admin") {
        const trocarSenhaAdmin = Boolean(data.admin.must_change_password);
        login({
          role: "admin",
          id: data.admin.id,
          cpf: data.admin.cpf,
          token: data.token,
          nome: data.admin.nome ?? null,
          isOwner: Boolean(data.admin.is_owner),
          areas: mergeAdminAreas(data.admin.areas ?? null),
          mustChangePassword: trocarSenhaAdmin,
        });
        if (trocarSenhaAdmin) {
          // Senha veio do dono: trocar antes de usar o painel.
          navigate("/alterar-senha");
          return;
        }
        toast.success("Painel administrador");
        navigate("/admin");
        return;
      }
      const precisaTrocarSenha = Boolean(data.company.must_change_password);
      login({
        role: "company",
        id: data.company.id,
        name: data.company.name,
        cnpj: data.company.cnpj,
        token: data.token,
        toolAccess: mergeClientToolAccess(data.company.tool_access),
        mustChangePassword: precisaTrocarSenha,
        isMatriz: Boolean(data.is_matriz),
        empresasGrupo: Array.isArray(data.empresas_grupo) ? data.empresas_grupo : [],
      });
      if (precisaTrocarSenha) {
        // Senha ainda é a inicial (= CNPJ): nada é liberado antes da troca.
        navigate("/alterar-senha");
        return;
      }
      toast.success(`Bem-vindo! ${data.company.name}`);
      navigate("/");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao fazer login";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Building2 className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl">Portal do Cliente</CardTitle>
        </CardHeader>
        <CardContent>
          {manutencao && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
              <Wrench className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{manutencao.mensagem}</span>
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label htmlFor="login">Login</Label>
              <div className="relative mt-1">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="login"
                  placeholder="CNPJ ou CPF"
                  value={loginField}
                  onChange={(e) => handleLoginField(e.target.value)}
                  className="pl-10"
                  autoComplete="username"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="password">Senha</Label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Digite a senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  autoComplete="current-password"
                />
              </div>
            </div>
            <Button type="submit" disabled={loading} className="w-full gap-2 h-12 text-base font-semibold">
              <LogIn className="h-5 w-5" />
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
          {/* A senha inicial deixou de ser o CNPJ (era público, e isso deixava aberta
              toda conta que ainda não tivesse feito o primeiro acesso). Este texto
              dizia o contrário e mandaria o cliente tentar uma senha que não existe. */}
          <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
            <strong className="font-medium text-foreground">1º acesso:</strong> o login é o seu{" "}
            <strong className="font-medium text-foreground">CNPJ</strong>; a senha é a que a
            contabilidade lhe enviou. Você definirá uma nova senha logo após entrar.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col border-t px-6 pb-6 pt-4">
          <Link
            to="/forgot-password"
            className="text-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Esqueci minha senha
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
};

export default LoginPage;
