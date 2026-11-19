import { useState } from "react";
import { Copy, Download, KeyRound, Lock } from "lucide-react";
import { toast } from "sonner";
import { HubCard } from "@/components/hub/Hub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

/** Nome do arquivo baixado: só o CNPJ/validade, nunca a senha. */
function nomeArquivo(venceEm: string) {
  return `Certificado digital - vence ${String(venceEm).slice(0, 10)}.pfx`;
}

/**
 * Arquivo e senha do certificado guardados pelo escritório.
 * Baixar é direto; a senha só aparece depois do código enviado ao e-mail da empresa.
 */
export function CertificadoArquivoCard({
  venceEm,
  temArquivo,
  temSenha,
}: {
  venceEm: string;
  temArquivo: boolean;
  temSenha: boolean;
}) {
  const [baixando, setBaixando] = useState(false);
  const [etapa, setEtapa] = useState<"inicio" | "codigo" | "senha">("inicio");
  const [emailMascarado, setEmailMascarado] = useState("");
  const [codigo, setCodigo] = useState("");
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);

  if (!temArquivo) return null;

  const baixar = async () => {
    setBaixando(true);
    try {
      const blob = await api.certificadoDigital.baixarArquivo();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivo(venceEm);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error((e as Error).message || "Não foi possível baixar");
    } finally {
      setBaixando(false);
    }
  };

  const pedirCodigo = async () => {
    setOcupado(true);
    try {
      const r = await api.certificadoDigital.pedirCodigoSenha();
      setEmailMascarado(r.email);
      setEtapa("codigo");
      toast.success(`Enviamos um código para ${r.email}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const conferir = async () => {
    setOcupado(true);
    try {
      const r = await api.certificadoDigital.verSenha(codigo);
      setSenha(r.senha);
      setEtapa("senha");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <HubCard icon={Lock} titulo="Arquivo do certificado">
      <p className="mt-2 text-xs text-muted-foreground">
        Guardado com criptografia. Use para instalar o certificado no seu computador ou no emissor de notas.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={baixar} disabled={baixando}>
          <Download className="mr-1 h-4 w-4" />
          {baixando ? "Baixando…" : "Baixar certificado"}
        </Button>
        {temSenha && etapa === "inicio" && (
          <Button size="sm" variant="outline" onClick={pedirCodigo} disabled={ocupado}>
            <KeyRound className="mr-1 h-4 w-4" />
            Ver senha
          </Button>
        )}
      </div>

      {etapa === "codigo" && (
        <div className="mt-4 space-y-2">
          <p className="text-sm">
            Digite o código de 6 números que enviamos para <strong>{emailMascarado}</strong>.
          </p>
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-32 tracking-widest"
              aria-label="Código de verificação"
            />
            <Button size="sm" onClick={conferir} disabled={ocupado || codigo.length !== 6}>
              Confirmar
            </Button>
          </div>
          <button type="button" className="text-xs text-primary underline" onClick={pedirCodigo} disabled={ocupado}>
            Não chegou? Enviar outro código
          </button>
        </div>
      )}

      {etapa === "senha" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border bg-secondary/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">Senha:</span>
          <code className="select-all font-mono text-sm font-semibold">{senha}</code>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(senha);
              toast.success("Senha copiada");
            }}
            aria-label="Copiar senha"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setSenha(""); setCodigo(""); setEtapa("inicio"); }}>
            Esconder
          </Button>
        </div>
      )}
    </HubCard>
  );
}
