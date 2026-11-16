import { saveAs } from "file-saver";
import { CheckCircle2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Documento recém-gerado. O download automático pode não acontecer (celular, navegador
 * de dentro do WhatsApp, bloqueio de download após a espera do servidor), então a tela
 * sempre deixa um botão para baixar de novo. Com `url` o botão usa o link do servidor,
 * que funciona até onde o download direto do navegador falha.
 */
export type DocumentoGerado = { blob: Blob; fileName: string; url?: string };

export function DocumentoPronto({ doc, titulo }: { doc: DocumentoGerado | null; titulo: string }) {
  if (!doc) return null;
  return (
    <Card className="border-emerald-500/40 bg-emerald-500/5" data-testid="documento-pronto">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <p className="font-medium">{titulo}</p>
            <p className="text-muted-foreground">Se o download não começou sozinho, toque em Baixar Word.</p>
          </div>
        </div>
        {doc.url ? (
          <Button asChild className="gap-2">
            <a href={doc.url} download={doc.fileName}>
              <Download className="h-4 w-4" /> Baixar Word
            </a>
          </Button>
        ) : (
          <Button className="gap-2" onClick={() => saveAs(doc.blob, doc.fileName)}>
            <Download className="h-4 w-4" /> Baixar Word
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
