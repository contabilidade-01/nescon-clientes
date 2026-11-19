import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, type CertificadoItem } from "@/lib/api";
import { casarCertificado, type CertificadoLoteItem } from "@/lib/certificadoDigital";

type Resultado = { ok: number; semEmpresa: string[]; erros: string[] };

/**
 * Lê o lote (.json) gerado da pasta de certificados do escritório e guarda, empresa por
 * empresa, o arquivo e a senha cifrados no portal. e-CNPJ primeiro; e-CPF só entra na
 * empresa que não recebeu e-CNPJ no mesmo lote.
 */
export function ImportarCertificadosLote({ empresas, onFim }: { empresas: CertificadoItem[]; onFim: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [andamento, setAndamento] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const importar = async (arquivo: File) => {
    let lote: CertificadoLoteItem[];
    try {
      lote = JSON.parse(await arquivo.text());
      if (!Array.isArray(lote)) throw new Error();
    } catch {
      toast.error("Arquivo de lote inválido");
      return;
    }
    const ordem = [...lote].sort((a, b) => (a.titular === b.titular ? 0 : a.titular === "e_cnpj" ? -1 : 1));
    const usadas = new Set<string>();
    const r: Resultado = { ok: 0, semEmpresa: [], erros: [] };
    for (let i = 0; i < ordem.length; i++) {
      const item = ordem[i];
      setAndamento(`${i + 1} de ${ordem.length}`);
      const emp = casarCertificado(empresas, item);
      if (!emp || (item.titular === "e_cpf" && usadas.has(emp.company_id))) {
        if (!emp) r.semEmpresa.push(item.nome);
        continue;
      }
      try {
        await api.certificados.enviarArquivo({
          company_id: emp.company_id,
          arquivo_base64: item.arquivo_base64,
          senha: item.senha,
          vence_em: item.vence_em,
          titular: item.titular,
          emitido_em: item.emitido_em,
          emissor: item.emissor,
        });
        usadas.add(emp.company_id);
        r.ok++;
      } catch (e) {
        r.erros.push(`${emp.name}: ${(e as Error).message}`);
      }
    }
    setAndamento(null);
    setResultado(r);
    onFim();
    toast.success(`${r.ok} certificado(s) guardado(s).`);
  };

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="Lote de certificados"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importar(f);
        }}
      />
      <Button size="sm" variant="outline" disabled={!!andamento} onClick={() => input.current?.click()}>
        <Upload className="mr-1 h-4 w-4" />
        {andamento ? `Enviando ${andamento}…` : "Importar arquivos (lote)"}
      </Button>
      {resultado && (
        <div className="rounded-xl border p-3 text-xs">
          <p className="font-semibold">{resultado.ok} guardado(s) com arquivo e senha.</p>
          {resultado.semEmpresa.length > 0 && (
            <p className="mt-1 text-muted-foreground">Sem empresa no portal: {resultado.semEmpresa.join(", ")}</p>
          )}
          {resultado.erros.length > 0 && (
            <p className="mt-1 text-destructive">Com erro: {resultado.erros.join("; ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
