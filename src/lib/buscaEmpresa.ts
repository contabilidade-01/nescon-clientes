/** Tira acentos e deixa minúsculo, para comparar textos digitados na busca. */
export function normalizarBusca(texto: string): string {
  return (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Diz se a empresa casa com o termo da busca: pelo nome (razão social ou nome
 * fantasia, sem acento e sem diferenciar maiúsculas) ou pelo CNPJ.
 *
 * O CNPJ só é comparado quando o termo tem dígitos. Antes, um termo só de letras
 * ("queijeiro") virava "" e `cnpj.includes("")` é sempre verdadeiro, então a lista
 * não filtrava nada.
 */
export function empresaCasaBusca(
  empresa: { name?: string | null; cnpj?: string | null; nome_fantasia?: string | null; apelido?: string | null },
  termo: string,
): boolean {
  const t = normalizarBusca(termo);
  if (!t) return true;
  const nomes = [empresa.name, empresa.nome_fantasia, empresa.apelido];
  if (nomes.some((n) => n && normalizarBusca(n).includes(t))) return true;
  const digitos = termo.replace(/\D/g, "");
  return digitos.length > 0 && String(empresa.cnpj || "").replace(/\D/g, "").includes(digitos);
}
