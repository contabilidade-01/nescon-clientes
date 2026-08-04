export function maskCPF(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

export function maskCNPJ(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function maskPIS(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{5})(\d)/, "$1.$2")
    .replace(/(\d{2})(\d{1})$/, "$1-$2");
}

/**
 * Inscrição do cliente no G-Click: pode ser CNPJ (14), CPF (11) — cliente pessoa
 * física — ou lixo de cadastro, como um "0" solto. Mascarar tudo como CNPJ deixava
 * o CPF ilegível, então a máscara segue o tamanho.
 */
export function maskDocumento(value: string): string {
  const d = (value || "").replace(/\D/g, "");
  if (d.length === 14) return maskCNPJ(d);
  if (d.length === 11) return maskCPF(d);
  return d || "—";
}
