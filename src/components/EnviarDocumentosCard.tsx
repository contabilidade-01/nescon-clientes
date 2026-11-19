import { Copy, MessageCircle, UploadCloud } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { IconBox } from "@/components/hub/Hub";

/**
 * Cartão fixo no Início: o cliente manda documentos ao escritório (advertência assinada,
 * comprovante, extrato, notas...). Leva para a página /enviar já com o CNPJ da empresa.
 * O mesmo link, sem CNPJ, pode ir para quem não tem acesso ao portal.
 */
export function EnviarDocumentosCard({ cnpj }: { cnpj?: string | null }) {
  const digitos = String(cnpj || "").replace(/\D/g, "");
  const destino = digitos.length === 14 ? `/enviar?cnpj=${digitos}` : "/enviar";
  const url = `${window.location.origin.replace(/\/+$/, "")}/enviar`;
  const mensagem = `Para enviar documentos à Nescon, sem senha: abra ${url}, informe o CNPJ da empresa, escolha o tipo e anexe os arquivos.`;

  const copiar = () => {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copiado"),
      () => toast.error("Não foi possível copiar. Selecione o link e copie à mão.")
    );
  };

  return (
    <section aria-label="Enviar documentos" className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <IconBox icon={UploadCloud} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Enviar documentos para a Nescon</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Advertência ou suspensão assinada, comprovante de pagamento, extrato, notas, atestado ou qualquer outro
            documento. Arraste os arquivos ou tire foto pelo celular.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" className="gap-2" asChild>
          <Link to={destino}>
            <UploadCloud className="h-4 w-4" />
            Enviar documentos
          </Link>
        </Button>
        <Button type="button" size="sm" variant="outline" className="gap-2" onClick={copiar}>
          <Copy className="h-4 w-4" />
          Copiar link
        </Button>
        <Button type="button" size="sm" variant="ghost" className="gap-2" asChild>
          <a href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4" />
            Enviar no WhatsApp
          </a>
        </Button>
      </div>
    </section>
  );
}
