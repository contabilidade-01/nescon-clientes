import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Building2, FileWarning, Loader2, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WarningForm } from "@/components/WarningForm";
import { SuspensionForm } from "@/components/SuspensionForm";
import { api } from "@/lib/api";
import { maskCNPJ } from "@/lib/masks";
import type { EmpresaAvulsa, ModoAvulso } from "@/lib/dpAvulso";

type Tipo = "advertencia" | "suspensao";

type Empresa = EmpresaAvulsa & { advertencia: boolean; suspensao: boolean };

const LS_CNPJ = "nescon_dp_avulso_cnpj";

const TITULOS: Record<Tipo, string> = {
  advertencia: "Termo de Advertência",
  suspensao: "Termo de Suspensão",
};

/**
 * Link avulso (sem login) para gerar advertência e suspensão — celular ou computador.
 * Rotas: /avulso (escolhe), /avulso/advertencia, /avulso/suspensao.
 */
export default function DpAvulsoPage() {
  const { tipo: tipoParam } = useParams();
  const navigate = useNavigate();
  const tipo: Tipo | null = tipoParam === "advertencia" || tipoParam === "suspensao" ? tipoParam : null;

  const [cnpj, setCnpj] = useState(() => {
    try {
      return localStorage.getItem(LS_CNPJ) || "";
    } catch {
      return "";
    }
  });
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState<Empresa | null>(null);

  useEffect(() => {
    document.title = tipo ? `${TITULOS[tipo]} · Nescon` : "Advertência e Suspensão · Nescon";
  }, [tipo]);

  const buscar = async () => {
    const digits = cnpj.replace(/\D/g, "");
    if (digits.length !== 14) {
      setErro("Digite os 14 números do CNPJ.");
      return;
    }
    setBuscando(true);
    setErro(null);
    setEmpresa(null);
    try {
      const r = await api.dpAvulso.empresa(digits);
      if (!r.encontrada || !r.nome) {
        setErro("Não achamos este CNPJ no cadastro da Nescon. Confira os números ou fale com o escritório.");
        return;
      }
      setEmpresa({
        nome: r.nome,
        cnpj: maskCNPJ(digits),
        escala12x36: Boolean(r.escala_12x36),
        advertencia: Boolean(r.advertencia),
        suspensao: Boolean(r.suspensao),
      });
      try {
        localStorage.setItem(LS_CNPJ, digits);
      } catch {
        /* sem localStorage: só não lembra o CNPJ */
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível consultar agora. Tente de novo.");
    } finally {
      setBuscando(false);
    }
  };

  const modo: ModoAvulso | null = useMemo(
    () =>
      empresa
        ? {
            empresa: { nome: empresa.nome, cnpj: empresa.cnpj, escala12x36: empresa.escala12x36 },
            emitir: (dados, blob, fileName) => api.dpAvulso.emitir(dados, blob, fileName),
          }
        : null,
    [empresa]
  );

  const liberado = empresa && tipo ? (tipo === "advertencia" ? empresa.advertencia : empresa.suspensao) : false;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            {tipo === "suspensao" ? (
              <ShieldAlert className="h-5 w-5 text-primary" />
            ) : (
              <FileWarning className="h-5 w-5 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-foreground">
              {tipo ? TITULOS[tipo] : "Advertência e Suspensão"}
            </h1>
            <p className="text-xs text-muted-foreground">Nescon Contabilidade · Departamento Pessoal</p>
          </div>
        </div>
        {tipo && (
          <div className="mx-auto flex max-w-2xl gap-2 px-4 pb-3">
            {(["advertencia", "suspensao"] as Tipo[]).map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={t === tipo ? "default" : "outline"}
                className="flex-1"
                onClick={() => navigate(`/avulso/${t}`)}
              >
                {t === "advertencia" ? "Advertência" : "Suspensão"}
              </Button>
            ))}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 pb-24">
        {!tipo && (
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="text-sm text-muted-foreground">O que você precisa gerar?</p>
              <Button asChild className="h-12 w-full text-base">
                <Link to="/avulso/advertencia">Advertência</Link>
              </Button>
              <Button asChild variant="outline" className="h-12 w-full text-base">
                <Link to="/avulso/suspensao">Suspensão</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {tipo && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4 text-primary" />
                Sua empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void buscar();
                }}
              >
                <div className="flex-1">
                  <Label htmlFor="av-cnpj" className="sr-only">
                    CNPJ
                  </Label>
                  <Input
                    id="av-cnpj"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="CNPJ da empresa"
                    value={maskCNPJ(cnpj)}
                    onChange={(e) => {
                      setCnpj(e.target.value.replace(/\D/g, "").slice(0, 14));
                      if (empresa) setEmpresa(null);
                    }}
                  />
                </div>
                <Button type="submit" disabled={buscando} className="gap-2">
                  {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Buscar
                </Button>
              </form>
              {erro && (
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {erro}
                </p>
              )}
              {empresa && (
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-sm font-medium">{empresa.nome}</p>
                  <p className="text-xs text-muted-foreground">CNPJ: {empresa.cnpj}</p>
                </div>
              )}
              {empresa && !liberado && (
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {tipo === "advertencia" ? "Advertência" : "Suspensão"} não está liberada para esta empresa. Fale com a
                  Nescon.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {tipo && modo && liberado && (
          // key: troca de empresa ou de tipo começa o formulário do zero.
          <div key={`${tipo}-${empresa?.cnpj}`}>
            {tipo === "advertencia" ? <WarningForm avulso={modo} /> : <SuspensionForm avulso={modo} />}
          </div>
        )}
      </main>
    </div>
  );
}
