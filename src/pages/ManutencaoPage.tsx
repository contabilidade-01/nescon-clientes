import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wrench, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";

/**
 * Tela mostrada ao cliente quando o portal está em manutenção. Sem login: o servidor
 * barra o cliente (503) e o app o traz para cá. Confere o estado sozinho de tempos em
 * tempos — quando a manutenção terminar, volta para o login sem o cliente precisar fazer nada.
 */
const MENSAGEM_FALLBACK =
  "Portal em manutenção no momento. Já já voltamos — tente novamente em instantes.";

const ManutencaoPage = () => {
  const navigate = useNavigate();
  const [mensagem, setMensagem] = useState(() => {
    try {
      return localStorage.getItem("maintenance_message") || MENSAGEM_FALLBACK;
    } catch {
      return MENSAGEM_FALLBACK;
    }
  });
  const [verificando, setVerificando] = useState(false);

  const verificar = async (irSeVoltou: boolean) => {
    setVerificando(true);
    try {
      const r = await api.auth.maintenance();
      if (!r.ativo) {
        try {
          localStorage.removeItem("maintenance_message");
        } catch {
          /* ignore */
        }
        if (irSeVoltou) navigate("/login", { replace: true });
        return;
      }
      if (r.mensagem) setMensagem(r.mensagem);
    } catch {
      /* offline ou API fora: mantém a mensagem atual */
    } finally {
      setVerificando(false);
    }
  };

  // Confere na entrada e a cada 30s: volta sozinho quando a manutenção terminar.
  useEffect(() => {
    verificar(true);
    const t = setInterval(() => verificar(true), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
            <Wrench className="h-7 w-7 text-amber-600 dark:text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Portal em manutenção</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{mensagem}</p>
          <Button variant="outline" onClick={() => verificar(true)} disabled={verificando} className="mt-2">
            <RefreshCw className={`mr-2 h-4 w-4 ${verificando ? "animate-spin" : ""}`} />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ManutencaoPage;
