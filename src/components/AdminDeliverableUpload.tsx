import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api, type DeliverableCategory } from "@/lib/api";
import { toast } from "sonner";

type Props = {
  companyId: string;
  companyName: string;
};

const CATEGORY_OPTIONS: Array<{ value: DeliverableCategory; label: string; comVencimento: boolean }> = [
  { value: "boleto", label: "Boleto (entra no calendário)", comVencimento: true },
  { value: "guia", label: "Guia fiscal (entra no calendário)", comVencimento: true },
  { value: "folha", label: "Folha de pagamento", comVencimento: false },
  { value: "outro", label: "Documento avulso (contrato, relatório...)", comVencimento: false },
];

/** Envio manual do escritório para a empresa (o fluxo automático vem do sistema de guias). */
export function AdminDeliverableUpload({ companyId, companyName }: Props) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<DeliverableCategory>("outro");
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [usarIa, setUsarIa] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const comVencimento = CATEGORY_OPTIONS.find((o) => o.value === category)?.comVencimento;

  const reset = () => {
    setTitle("");
    setDocType("");
    setCompetencia("");
    setDueDate("");
    setUsarIa(false);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const escolherArquivo = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      toast.error("Apenas PDF");
      return;
    }
    setFile(f);
    // Sugere o título pelo nome do arquivo se ainda estiver vazio.
    if (!title.trim()) setTitle(f.name.replace(/\.pdf$/i, ""));
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
      if (usarIa) fd.append("usar_ia", "true");
      return api.deliverables.adminUpload(fd);
    },
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ["deliverables"] });
      const fmt = (d: string) => d.split("-").reverse().join("/");
      const tipo = doc.doc_type_detectado ? ` (${doc.doc_type_detectado})` : "";
      if (doc.due_date) {
        const como =
          doc.origem_vencimento === "regra"
            ? "pela regra do tributo"
            : doc.origem_vencimento === "ia"
              ? "descoberto pela IA"
              : doc.origem_vencimento === "pdf" || doc.due_date_from_pdf
                ? "lido do PDF"
                : "informado";
        toast.success(`Enviado para ${companyName}${tipo}. Vencimento ${fmt(doc.due_date)} — ${como}.`);
      } else if (comVencimento) {
        toast.warning(
          `Enviado para ${companyName}, mas sem vencimento identificado — informe a data à mão` +
            (usarIa ? "" : ` ou marque "descobrir com IA"`) +
            " para entrar no calendário."
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
          Só PDF (máx. 10MB). Boletos e guias entram no calendário de vencimentos; contratos e
          relatórios ficam em Documentos.
        </p>
      </div>

      {/* Área de arrastar-e-soltar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          escolherArquivo(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/40 hover:bg-card/60"
        )}
      >
        {file ? (
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-primary" />
            <span className="max-w-[16rem] truncate font-medium">{file.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted"
              aria-label="Remover arquivo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <Upload className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm">
              <span className="font-medium text-primary">Arraste o PDF aqui</span> ou clique para escolher
            </p>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => escolherArquivo(e.target.files?.[0])}
        />
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
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Boleto fornecedor X" />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Sigla (opcional)</Label>
          <Input value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="Ex.: CORA, ENERGIA" />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Competência (opcional)</Label>
          <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        </div>

        {comVencimento && (
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Vencimento</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Deixe em branco que o portal resolve sozinho: guias do núcleo (FGTS, DAS, DCTF Web) recebem o
              vencimento <span className="font-medium">pela regra</span>; as demais, o portal tenta ler o rótulo
              do PDF. Sem vencimento não entra no calendário.
            </p>
            <label className="mt-1 flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={usarIa}
                onChange={(e) => setUsarIa(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span>
                Se não for do núcleo e o PDF não tiver rótulo de vencimento, tentar descobrir com IA (usa a IA
                configurada, quando habilitada).
              </span>
            </label>
          </div>
        )}
      </div>

      <Button type="button" size="sm" disabled={!canSubmit} onClick={() => upload.mutate()}>
        <Upload className="mr-1 h-4 w-4" />
        {upload.isPending ? "Enviando..." : "Enviar ao portal"}
      </Button>
    </div>
  );
}
