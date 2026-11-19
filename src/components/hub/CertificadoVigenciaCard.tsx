import { ChevronRight, FileBadge } from "lucide-react";
import type { CertificadoPortal } from "@/lib/api";
import { CERT_TITULAR_LABELS, dataBr, prazoTexto } from "@/lib/certificadoDigital";
import { IconBox } from "@/components/hub/Hub";
import { cn } from "@/lib/utils";

const BORDA = {
  ativo: "border-success/40 bg-success/5",
  a_vencer: "border-warning/50 bg-warning/10",
  vencido: "border-destructive/50 bg-destructive/10",
  ausente: "border-border bg-card",
} as const;

const TOM = { ativo: "success", a_vencer: "warning", vencido: "destructive", ausente: "muted" } as const;

/** Texto principal do cartão de vigência, por estado. */
export function tituloVigencia(dados: CertificadoPortal): string {
  const c = dados.certificado;
  if (!c) return "Certificado digital sem validade cadastrada";
  if (dados.status === "vencido") return `Certificado digital venceu em ${dataBr(c.vence_em)}`;
  return `Certificado digital válido até ${dataBr(c.vence_em)}`;
}

/** Cartão fixo no topo do Início: a vigência do certificado digital da empresa, sempre visível. */
export function CertificadoVigenciaCard({ dados, onAbrir }: { dados: CertificadoPortal; onAbrir: () => void }) {
  const c = dados.certificado;
  const status = dados.status;
  const detalhe = c
    ? [CERT_TITULAR_LABELS[c.titular], prazoTexto(c.dias_restantes)].filter(Boolean).join(" · ")
    : "Toque para informar a validade do seu certificado.";
  const aviso =
    status === "vencido" || status === "a_vencer"
      ? "Sem ele não emitimos notas nem entregamos declarações. Providencie a renovação."
      : null;

  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label="Certificado digital"
      className={cn("flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left", BORDA[status])}
    >
      <IconBox icon={FileBadge} tom={TOM[status]} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{tituloVigencia(dados)}</span>
        <span className="block text-xs text-muted-foreground">{detalhe}</span>
        {aviso && <span className="block text-xs text-muted-foreground">{aviso}</span>}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </button>
  );
}
