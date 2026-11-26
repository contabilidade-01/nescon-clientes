import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { maskCNPJ } from "@/lib/masks";

/**
 * Recálculo de impostos SEM LOGIN, com dois fatores:
 *   1. o cliente digita o CNPJ;
 *   2. digita o código de 6 números que chegou no e-mail cadastrado da empresa (vale 10 min).
 * Código certo → tela de guias da empresa (/g/:token), só com os débitos dela.
 */
const RecalculoPage = () => {
  const navigate = useNavigate();
  const [cnpj, setCnpj] = useState("");
  const [codigo, setCodigo] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [minutos, setMinutos] = useState(10);
  const [espera, setEspera] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const cnpjOk = cnpj.replace(/\D/g, "").length === 14;

  const pedir = async () => {
    setErro(null);
    setCarregando(true);
    try {
      const r = await api.recalculo.pedirCodigo(cnpj);
      setEmail(r.email);
      setMinutos(r.minutos || 10);
      setEspera(r.reenviar_em || 60);
      setCodigo("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar o código.");
    } finally {
      setCarregando(false);
    }
  };

  const entrar = async () => {
    setErro(null);
    setCarregando(true);
    try {
      const r = await api.recalculo.verificar(cnpj, codigo);
      navigate(`/g/${r.token}`, { replace: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Código inválido.");
      setCodigo("");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-foreground">Guia atualizada de impostos</h1>
            <p className="text-xs text-muted-foreground">Nescon Contabilidade</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 py-6">
        {!email ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4 text-primary" /> 1. CNPJ da empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Para sua segurança, vamos mandar um código para o e-mail cadastrado da empresa.
              </p>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (cnpjOk && !carregando) pedir();
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor="cnpj">CNPJ</Label>
                  <Input
                    id="cnpj"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="00.000.000/0000-00"
                    value={cnpj}
                    onChange={(e) => setCnpj(maskCNPJ(e.target.value))}
                  />
                </div>
                {erro && <p className="text-sm text-destructive">{erro}</p>}
                <Button type="submit" className="w-full" size="lg" disabled={!cnpjOk || carregando}>
                  {carregando ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Mail className="mr-2 h-5 w-5" />}
                  Enviar código por e-mail
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4 text-primary" /> 2. Código do e-mail
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                Enviamos um código de 6 números para <b>{email}</b>. Ele vale por {minutos} minutos.
              </p>
              <p className="text-xs text-muted-foreground">Não chegou? Veja a caixa de spam ou lixo eletrônico.</p>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (codigo.length === 6 && !carregando) entrar();
                }}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  placeholder="000000"
                  className="text-center font-mono text-2xl tracking-[0.5em]"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  aria-label="Código de 6 números"
                />
                {erro && <p className="text-sm text-destructive">{erro}</p>}
                <Button type="submit" className="w-full" size="lg" disabled={codigo.length !== 6 || carregando}>
                  {carregando ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ShieldCheck className="mr-2 h-5 w-5" />}
                  Entrar
                </Button>
              </form>
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEmail(null);
                    setErro(null);
                    setCodigo("");
                  }}
                >
                  <ArrowLeft className="mr-1 h-4 w-4" /> Outro CNPJ
                </Button>
                <Button variant="outline" size="sm" disabled={espera > 0 || carregando} onClick={pedir}>
                  {espera > 0 ? `Reenviar em ${espera}s` : "Reenviar código"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        <p className="text-center text-xs text-muted-foreground">
          Aqui você vê só os impostos em aberto da sua empresa e gera a guia com multa e juros atualizados.
        </p>
      </main>
    </div>
  );
};

export default RecalculoPage;
