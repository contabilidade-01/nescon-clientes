import type { LicenseStatus, LicenseType, AnnualTaxStatus } from "@/lib/api";

/** Rótulos e cores dos 3 tipos e dos 4 estados — um lugar só, para o painel e a lista não divergirem. */
export const LICENSE_TYPES: LicenseType[] = ["funcionamento", "avcb_clcb", "sanitaria"];

export const LICENSE_TYPE_LABELS: Record<LicenseType, { title: string; short: string }> = {
  funcionamento: { title: "Alvará de Funcionamento", short: "Funcionamento" },
  avcb_clcb: { title: "AVCB / CLCB (Bombeiros)", short: "AVCB/CLCB" },
  sanitaria: { title: "Vigilância Sanitária", short: "Sanitária" },
};

export const LICENSE_STATUSES: LicenseStatus[] = ["ativa", "a_vencer", "vencida", "ausente"];

export const LICENSE_STATUS_LABELS: Record<
  LicenseStatus,
  { title: string; description: string; badge: "default" | "secondary" | "destructive" | "outline"; dot: string }
> = {
  ativa: {
    title: "Ativas",
    description: "Dentro do prazo",
    badge: "default",
    dot: "bg-emerald-500",
  },
  a_vencer: {
    title: "A vencer",
    description: "Vencem em breve",
    badge: "secondary",
    dot: "bg-amber-500",
  },
  vencida: {
    title: "Vencidas",
    description: "Já passaram do prazo",
    badge: "destructive",
    dot: "bg-red-500",
  },
  ausente: {
    title: "Sem licença",
    description: "Nunca cadastrada",
    badge: "outline",
    dot: "bg-muted-foreground",
  },
};

export const ANNUAL_TAX_LABELS: Record<AnnualTaxStatus, { title: string; description: string }> = {
  pendente: { title: "Pendente", description: "Guia ainda não enviada" },
  enviado: { title: "Enviada", description: "Escritório já enviou ao cliente" },
  confirmado: { title: "Confirmada", description: "Cliente confirmou o recebimento" },
};

/** "faltam 12 dias" / "venceu há 3 dias" — texto humano a partir do número do servidor. */
export function diasLabel(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return "sem data";
  if (dias === 0) return "vence hoje";
  if (dias > 0) return `faltam ${dias} dia${dias > 1 ? "s" : ""}`;
  const atraso = Math.abs(dias);
  return `venceu há ${atraso} dia${atraso > 1 ? "s" : ""}`;
}

/** Data ISO (AAAA-MM-DD) → dd/MM/aaaa, sem passar por fuso horário. */
export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}
