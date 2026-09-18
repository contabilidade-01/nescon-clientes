import { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Mail, ArrowLeft, MessageCircle } from "lucide-react";
import { maskCNPJ, maskCPF } from "@/lib/masks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { toast } from "sonner";

// WhatsApp da Nescon para o cliente que não recebeu o e-mail (só dígitos, com DDI 55).
const NESCON_WHATSAPP = "5511948626605";
const WHATSAPP_URL = `https://wa.me/${NESCON_WHATSAPP}?text=${encodeURIComponent(
  "Olá! Não recebi o e-mail de recuperação de senha do portal. Podem me ajudar?"
)}`;

const ForgotPasswordPage = () => {
  const [loginField, setLoginField] = useState("");
  const [loading, setLoading] = useState(false);
  // Resposta do servidor: e-mail mascarado para onde foi o link (padrão dos bancos).
  const [resultado, setResultado] = useState<{ message: string; email?: string; semEmail?: boolean } | null>(null);

  const handleLoginField = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 14);
    setLoginField(digits.length <= 11 ? maskCPF(digits) : maskCNPJ(digits));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginField.trim()) {
      toast.error("Informe o CNPJ ou CPF");
      return;
    }

    setLoading(true);
    setResultado(null);
    try {
      const data = await api.auth.forgotPassword(loginField);
      setResultado({ message: data.message, email: data.email_mascarado, semEmail: data.sem_email });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao enviar pedido";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Building2 className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl">Recuperar senha</CardTitle>
          <p className="text-sm text-muted-foreground text-balance">
            Informe o CNPJ ou CPF do login. Enviaremos um link para o e-mail cadastrado para você
            definir uma nova senha.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="login">CNPJ ou CPF (login)</Label>
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
            <Button type="submit" disabled={loading} className="w-full h-12 text-base font-semibold">
              {loading ? "Enviando..." : "Enviar link"}
            </Button>
          </form>

          {resultado && (
            <div
              role="status"
              className={`rounded-lg border p-3 text-sm ${
                resultado.semEmail
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                  : "border-primary/30 bg-primary/5"
              }`}
            >
              {resultado.email ? (
                <>
                  <p className="flex items-center gap-2 font-medium">
                    <Mail className="h-4 w-4 shrink-0" /> Link enviado para
                  </p>
                  <p className="mt-1 break-all text-base font-semibold tracking-wide">{resultado.email}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Confira também o spam. Não reconhece este e-mail? Fale com a Nescon pelo botão abaixo.
                  </p>
                </>
              ) : (
                <p>{resultado.message}</p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-center">
            <p className="text-sm text-muted-foreground">
              Não recebeu o e-mail? Verifique o spam ou fale com a Nescon.
            </p>
            <Button
              asChild
              variant="outline"
              className="mt-2 w-full gap-2 border-emerald-600/40 text-emerald-600 hover:bg-emerald-600/10 hover:text-emerald-500"
            >
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" />
                Chamar a Nescon no WhatsApp
              </a>
            </Button>
          </div>

          <Button variant="ghost" className="w-full gap-2" asChild>
            <Link to="/login">
              <ArrowLeft className="h-4 w-4" />
              Voltar ao login
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ForgotPasswordPage;
