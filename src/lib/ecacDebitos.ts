import type { EcacDebito } from "@/lib/api";

/**
 * Débito como aparece na tela. INSS vem do relatório da Receita segregado por código
 * (1082, 1099…), mas a guia é UMA DARF da DCTFWeb por competência com todos os códigos —
 * como o e-CAC emite. Aqui as linhas de INSS da mesma competência viram uma só.
 */
export interface DebitoTela extends EcacDebito {
  /** Tipo de guia que o central-ecac emite (SN, MEI, DCTFWEB) ou null. */
  tipo_guia: "SN" | "MEI" | "DCTFWEB" | null;
  /** Códigos de receita somados nesta linha (só INSS agrupado). */
  codigos: string[];
}

export function tipoGuia(d: EcacDebito): DebitoTela["tipo_guia"] {
  const t = String(d.tipo || "").toUpperCase();
  if (t === "SN" || t === "MEI") return t;
  if (t === "INSS") return "DCTFWEB";
  return null;
}

export function agruparDebitos(debitos: EcacDebito[]): DebitoTela[] {
  const saida: DebitoTela[] = [];
  const inss = new Map<string, DebitoTela>();
  for (const d of debitos) {
    const tg = tipoGuia(d);
    if (tg === "DCTFWEB" && d.periodo_aaaamm) {
      const atual = inss.get(d.periodo_aaaamm);
      if (atual) {
        atual.codigos.push(d.receita);
        atual.valor_original = round2(Number(atual.valor_original) + Number(d.valor_original || 0));
        atual.saldo_devedor_total = round2(Number(atual.saldo_devedor_total) + Number(d.saldo_devedor_total || 0));
        if (d.data_vencimento && (!atual.data_vencimento || d.data_vencimento < atual.data_vencimento)) {
          atual.data_vencimento = d.data_vencimento;
        }
        atual.recalculo_disponivel = atual.recalculo_disponivel || d.recalculo_disponivel;
        continue;
      }
      const novo: DebitoTela = { ...d, tipo_guia: tg, codigos: [d.receita] };
      inss.set(d.periodo_aaaamm, novo);
      saida.push(novo);
      continue;
    }
    saida.push({ ...d, tipo_guia: tg, codigos: [] });
  }
  return saida;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function rotuloDebito(d: DebitoTela): string {
  if (d.tipo_guia === "SN") return "DAS Simples";
  if (d.tipo_guia === "MEI") return "DAS MEI";
  if (d.tipo_guia === "DCTFWEB") return "DARF DCTFWeb (INSS)";
  return d.receita || d.tipo;
}

/** Parcelamentos que o central-ecac consulta/emite. */
export const TIPOS_PARCELA: Array<{ valor: string; rotulo: string }> = [
  { valor: "PARC_SN", rotulo: "Parcelamento Simples Nacional" },
  { valor: "PERT_SN", rotulo: "PERT Simples Nacional" },
  { valor: "RELP_SN", rotulo: "RELP Simples Nacional" },
  { valor: "PARC_MEI", rotulo: "Parcelamento MEI" },
  { valor: "PERT_MEI", rotulo: "PERT MEI" },
  { valor: "RELP_MEI", rotulo: "RELP MEI" },
];

/** 'AAAAMM' → 'MM/AAAA' */
export function mesAno(aaaamm: string | null | undefined) {
  const d = String(aaaamm || "").replace(/\D/g, "");
  return d.length === 6 ? `${d.slice(4)}/${d.slice(0, 4)}` : aaaamm || "";
}
