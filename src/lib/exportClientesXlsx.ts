import * as XLSX from "xlsx";
import { format } from "date-fns";
import { maskCNPJ } from "@/lib/masks";

export interface ClienteExportacao {
  name: string;
  cnpj: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  endereco: string | null;
}

/** (11) 98765-4321 / (11) 3456-7890; sem DDD ou fora do padrão volta como veio. */
export function formatTelefone(valor: string | null | undefined): string {
  if (!valor) return "";
  let d = valor.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return valor;
}

export function linhasClientes(clientes: ClienteExportacao[]): string[][] {
  const cabecalho = ["Nome", "CNPJ", "Telefone", "WhatsApp", "E-mail", "Endereço"];
  const linhas = clientes.map((c) => [
    c.name,
    maskCNPJ(c.cnpj),
    formatTelefone(c.phone),
    formatTelefone(c.whatsapp),
    c.email ?? "",
    c.endereco ?? "",
  ]);
  return [cabecalho, ...linhas];
}

/** Gera e baixa `clientes-AAAA-MM-DD.xlsx`. Tudo como texto, para o Excel não comer zeros do CNPJ. */
export function exportarClientesXlsx(clientes: ClienteExportacao[]): void {
  const linhas = linhasClientes(clientes);
  const sheet = XLSX.utils.aoa_to_sheet(linhas);
  sheet["!cols"] = [{ wch: 45 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 35 }, { wch: 60 }];
  sheet["!autofilter"] = { ref: `A1:F${linhas.length}` };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Clientes");
  XLSX.writeFile(wb, `clientes-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
}
