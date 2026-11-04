import type { CertificadoStatus, CertificadoTipo, CertificadoTitular } from "@/lib/api";

/** Rótulos do certificado digital — um lugar só para o portal e o painel. */
export const CERT_STATUS_LABELS: Record<
  CertificadoStatus,
  { title: string; description: string; tom: "success" | "warning" | "destructive" | "muted" }
> = {
  ativo: { title: "Em dia", description: "Dentro da validade", tom: "success" },
  a_vencer: { title: "A vencer", description: "Vence em breve", tom: "warning" },
  vencido: { title: "Vencido", description: "Já passou da validade", tom: "destructive" },
  ausente: { title: "Sem cadastro", description: "Validade não informada", tom: "muted" },
};

export const CERT_STATUSES: CertificadoStatus[] = ["vencido", "a_vencer", "ausente", "ativo"];

export const CERT_TIPO_LABELS: Record<CertificadoTipo, string> = {
  a1: "A1 (arquivo)",
  a3: "A3 (token ou cartão)",
};

export const CERT_TITULAR_LABELS: Record<CertificadoTitular, string> = {
  e_cnpj: "e-CNPJ",
  e_cpf: "e-CPF",
};

export function dataBr(iso: string | null | undefined): string {
  const s = String(iso || "").slice(0, 10);
  const [a, m, d] = s.split("-");
  return a && m && d ? `${d}/${m}/${a}` : "—";
}

/** "vence em 12 dias" / "venceu há 3 dias" / "vence hoje". */
export function prazoTexto(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return "";
  if (dias === 0) return "vence hoje";
  if (dias > 0) return `vence em ${dias} dia${dias === 1 ? "" : "s"}`;
  const n = Math.abs(dias);
  return `venceu há ${n} dia${n === 1 ? "" : "s"}`;
}
