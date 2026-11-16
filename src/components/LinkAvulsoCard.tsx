import { Copy, ExternalLink, Link2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { IconBox } from "@/components/hub/Hub";

/** Endereço público das telas avulsas (sem login). O CNPJ é pedido na própria tela. */
export function linkAvulso(origem: string = window.location.origin): string {
  return `${origem.replace(/\/+$/, "")}/avulso`;
}

/**
 * Cartão fixo no Início: a empresa copia ou manda pelo WhatsApp o link sem login de
 * advertência e suspensão (para gerente, encarregado, quem não tem acesso ao portal).
 * Quem abre o link precisa digitar o CNPJ; aí escolhe o funcionário da lista ou digita.
 */
export function LinkAvulsoCard() {
  const url = linkAvulso();
  const mensagem = `Advertência e suspensão (Nescon), sem senha: abra ${url} e informe o CNPJ da empresa.`;

  const copiar = () => {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copiado"),
      () => toast.error("Não foi possível copiar. Selecione o link e copie à mão.")
    );
  };

  return (
    <section aria-label="Link sem login" className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <IconBox icon={Link2} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Link sem login: advertência e suspensão</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Envie para o gerente ou encarregado. Quem abre informa o CNPJ e escolhe o funcionário da lista, ou
            digita o nome completo.
          </p>
          <p className="mt-2 select-all break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">{url}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" className="gap-2" onClick={copiar}>
          <Copy className="h-4 w-4" />
          Copiar link
        </Button>
        <Button type="button" size="sm" variant="outline" className="gap-2" asChild>
          <a href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4" />
            Enviar no WhatsApp
          </a>
        </Button>
        <Button type="button" size="sm" variant="ghost" className="gap-2" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            Abrir
          </a>
        </Button>
      </div>
    </section>
  );
}
