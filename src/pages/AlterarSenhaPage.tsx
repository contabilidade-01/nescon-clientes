import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, Mail, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const AlterarSenhaPage = () => {
  const navigate = useNavigate();
  const { company, admin, login, logout } = useAuth();

  // Se for um admin personificando a empresa, ignoramos a obrigatoriedade de troca de senha
  // e redirecionamos para o portal da empresa normalmente.
  if (company?.isAdminPersonified) {
    navigate("/");
    return null;
  }
  // Vale para os dois: empresa com senha = CNPJ, e usuário do painel com senha
  // definida pelo dono.
  const obrigatorio = Boolean(company?.mustChangePassword || admin?.mustChangePassword);

  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");

  const trocar = useMutation({
    mutationFn: () => api.auth.changePassword(atual, nova),
    onSuccess: (r) => {
      toast.success(r.message);
      // Some a marca de 1º acesso — sem isto a guarda continuaria a barrar a navegação.
      if (company) login({ ...company, mustChangePassword: false });
      if (admin) login({ ...admin, mustChangePassword: false });
      setAtual("");
      setNova("");
      setConfirma("");
      navigate(admin ? "/admin" : "/");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enviarLink = useMutation({
    mutationFn: () => api.auth.sendResetLink(),
    onSuccess: (r) => toast.success(r.message),
    onError: (e: Error) => toast.error(e.message),
  });

  const curta = nova.length > 0 && nova.length < 8;
  const divergem = confirma.length > 0 && nova !== confirma;
  // No 1º acesso (obrigatório) não se pede a senha atual: a inicial pode ser aleatória
  // (empresa vinda da sincronização) e o cliente não a tem — o backend dispensa a atual
  // quando o cadastro está em reset forçado.
  const podeTrocar =
    (obrigatorio || atual.length > 0) &&
    nova.length >= 8 &&
    nova === confirma &&
    !trocar.isPending;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          {!obrigatorio && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(admin ? "/admin" : "/")}
              aria-label="Voltar"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-foreground">Alterar senha</h1>
            <p className="truncate text-xs text-muted-foreground">
              {company?.name ?? (admin ? "Administrador" : "")}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg px-4 py-6">
        {obrigatorio && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-semibold text-foreground">Defina uma senha antes de continuar</p>
              <p className="mt-1 text-muted-foreground">
                Sua conta ainda está com a senha inicial. Escolha uma senha só sua para
                proteger seus documentos.
              </p>
            </div>
          </div>
        )}

        <Card>
          <CardContent className="space-y-4 p-5">
            {/* No 1º acesso não se pede a senha atual: pode ser aleatória (empresa vinda
                da sincronização) e o cliente não a tem. O backend dispensa a atual em
                reset forçado. */}
            {!obrigatorio && (
              <div className="space-y-1">
                <Label htmlFor="atual">Senha atual</Label>
                <Input
                  id="atual"
                  type="password"
                  autoComplete="current-password"
                  value={atual}
                  onChange={(e) => setAtual(e.target.value)}
                  placeholder="Sua senha de hoje"
                />
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="nova">Nova senha</Label>
              <Input
                id="nova"
                type="password"
                autoComplete="new-password"
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                placeholder="Mínimo 8 caracteres"
              />
              {curta && <p className="text-xs text-destructive">Use pelo menos 8 caracteres.</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="confirma">Repita a nova senha</Label>
              <Input
                id="confirma"
                type="password"
                autoComplete="new-password"
                value={confirma}
                onChange={(e) => setConfirma(e.target.value)}
              />
              {divergem && <p className="text-xs text-destructive">As senhas não são iguais.</p>}
            </div>

            <Button
              className="w-full gap-2"
              size="lg"
              disabled={!podeTrocar}
              onClick={() => trocar.mutate()}
            >
              <KeyRound className="h-4 w-4" />
              {trocar.isPending ? "Alterando..." : "Alterar senha"}
            </Button>

            <Separator />

            <div className="space-y-2">
              <p className="text-sm font-medium">Não lembra a senha atual?</p>
              <p className="text-xs text-muted-foreground">
                Enviamos um link de redefinição para o e-mail cadastrado da sua empresa. Se não
                houver e-mail cadastrado, peça à contabilidade para cadastrar.
              </p>
              <Button
                variant="outline"
                className="w-full gap-2"
                disabled={enviarLink.isPending}
                onClick={() => enviarLink.mutate()}
              >
                <Mail className="h-4 w-4" />
                {enviarLink.isPending ? "Enviando..." : "Enviar link por e-mail"}
              </Button>
            </div>

            {obrigatorio && (
              <>
                <Separator />
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                >
                  Sair
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default AlterarSenhaPage;
