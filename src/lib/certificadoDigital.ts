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

/** Um certificado do lote gerado a partir da pasta do escritório (arquivo + senha). */
export type CertificadoLoteItem = {
  doc: string; // CNPJ (e-CNPJ) ou CPF (e-CPF), só números
  titular: CertificadoTitular;
  nome: string; // titular como está no certificado
  emitido_em: string | null;
  vence_em: string;
  emissor: string | null;
  senha: string;
  arquivo_base64: string;
};

const soDigitos = (s: string | null | undefined) => String(s || "").replace(/\D/g, "");
const normalizarNome = (s: string | null | undefined) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/**
 * Empresa de um certificado do lote. e-CNPJ: pelo CNPJ. e-CPF: quando a empresa é
 * cadastrada pelo CPF, quando o CPF aparece no nome (MEI) ou quando o nome é igual.
 */
export function casarCertificado<T extends { company_id: string; cnpj: string; name: string }>(
  empresas: T[],
  item: Pick<CertificadoLoteItem, "doc" | "titular" | "nome">
): T | null {
  const doc = soDigitos(item.doc);
  if (!doc) return null;
  if (item.titular === "e_cnpj") return empresas.find((e) => soDigitos(e.cnpj) === doc) ?? null;
  return (
    empresas.find((e) => soDigitos(e.cnpj) === doc) ??
    empresas.find((e) => soDigitos(e.name).length >= 11 && soDigitos(e.name).includes(doc)) ??
    empresas.find((e) => normalizarNome(e.name) === normalizarNome(item.nome) && normalizarNome(item.nome) !== "") ??
    null
  );
}
