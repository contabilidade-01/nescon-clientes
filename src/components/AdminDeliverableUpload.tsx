import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type DeliverableCategory } from "@/lib/api";
import { toast } from "sonner";

type Props = {
  companyId: string;
  companyName: string;
};

const CATEGORY_OPTIONS: Array<{ value: DeliverableCategory; label: string }> = [
  { value: "guia", label: "Guia fiscal (entra no calendário)" },
  { value: "folha", label: "Folha de pagamento" },
  { value: "outro", label: "Documento avulso" },
];

/** Envio manual de uma entrega para a empresa selecionada (o fluxo automático vem do sistema de guias). */
export function AdminDeliverableUpload({ companyId, companyName }: Props) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<DeliverableCategory>("outro");
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const reset = () => {
    setTitle("");
    setDocType("");
    setCompetencia("");
    setDueDate("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file as File);
      fd.append("company_id", companyId);
      fd.append("category", category);
      fd.append("title", title.trim());
      if (docType.trim()) fd.append("doc_type", docType.trim().toUpperCase());
      if (competencia) fd.append("competencia", competencia);
      if (dueDate) fd.append("due_date", dueDate);
      return api.deliverables.adminUpload(fd);
    },
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ["deliverables"] });
      if (doc.due_date_from_pdf && doc.due_date) {
        const [a, m, d] = doc.due_date.split("-");
        toast.success(`Enviado para ${companyName}. Vencimento ${d}/${m}/${a} lido do PDF.`);
      } else if (category === "guia" && !doc.due_date) {
        toast.warning(
          `Enviado para ${companyName}, mas não achei o vencimento no PDF — informe a data para entrar no calendário.`
        );
      } else {
        toast.success(`Documento enviado para ${companyName}`);
      }
      reset();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = !!file && title.trim().length > 0 && !upload.isPending;

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div>
        <p className="text-xs font-semibold text-foreground">Enviar documento ao portal do cliente</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Só PDF (máx. 10MB). Guias e folha enviadas pelo sistema de guias chegam sozinhas — use aqui
          para o que for manual (contratos, relatórios, balancetes).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Tipo de entrega</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as DeliverableCategory)}
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Título *</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: Balancete de junho"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Sigla (opcional)</Label>
          <Input
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            placeholder="Ex.: DAS, INSS"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Competência (opcional)</Label>
          <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        </div>

        {category === "guia" && (
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">
              Vencimento <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Deixe em branco que o portal tenta ler do próprio PDF. Só preencha para
              sobrepor a data lida — sem vencimento a guia não entra no calendário.
            </p>
          </div>
        )}

        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Arquivo PDF *</Label>
          <Input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <Button type="button" size="sm" disabled={!canSubmit} onClick={() => upload.mutate()}>
        <Upload className="mr-1 h-4 w-4" />
        {upload.isPending ? "Enviando..." : "Enviar ao portal"}
      </Button>
    </div>
  );
}
