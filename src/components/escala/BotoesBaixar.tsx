import { FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Baixar a escala que está na tela: PDF para imprimir e afixar, Excel para editar. */
export function BotoesBaixar({ onBaixar }: { onBaixar: (tipo: "pdf" | "xlsx") => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onBaixar("pdf")}>
        <FileText className="mr-1 h-3.5 w-3.5" /> Baixar PDF
      </Button>
      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onBaixar("xlsx")}>
        <FileSpreadsheet className="mr-1 h-3.5 w-3.5" /> Baixar Excel
      </Button>
    </div>
  );
}
