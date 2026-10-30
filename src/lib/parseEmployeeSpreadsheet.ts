import * as XLSX from "xlsx";
import { lerCelulasXlsBiff } from "@/lib/xlsBiff";

export type EmployeeImportRow = { name: string; cpf: string };

export type ParsedEmployeeImport = {
  fileCnpj: string;
  /** Ativos (sem data de demissão): cadastra quem é novo, atualiza quem já existe. */
  rows: EmployeeImportRow[];
  /** Demitidos: não são cadastrados, mas quem já estiver cadastrado é inativado. */
  dismissed: EmployeeImportRow[];
  skippedDismissed: number;
  /** Linhas sem CPF (ex.: "Relação de Empregados" só com nome) — casam pelo nome. */
  withoutCpf: number;
};

const cnpjRegex = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/;
const dismissalDate = /\d{2}\/\d{2}\/\d{4}/;

function rowsToDelimitedText(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => String(cell ?? "").trim()).join(";"))
    .join("\n");
}

export function extractFileCnpj(csv: string): string | null {
  const lines = csv.split(/\r?\n/).filter(Boolean);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const cells = line
      .split(/[;,\t]/)
      .map((cell) => cell.trim())
      .filter(Boolean);

    for (const cell of cells) {
      const maskedMatch = cell.match(cnpjRegex);
      if (maskedMatch) {
        const digits = maskedMatch[0].replace(/\D/g, "");
        if (digits.length === 14) return digits;
      }

      const digitsOnly = cell.replace(/\D/g, "");
      if (digitsOnly.length === 14) return digitsOnly;
    }

    const lineMatch = line.match(cnpjRegex);
    if (lineMatch) {
      const digits = lineMatch[0].replace(/\D/g, "");
      if (digits.length === 14) return digits;
    }
  }

  return null;
}

function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .trim();
}

/** Colunas da linha de cabeçalho ("Nome", "CPF", "Situação", "Data demissão"). */
type Header = { nome: number; cpf: number; situacao: number; demissao: number };

function findHeader(cells: string[]): Header | null {
  const idx = (re: RegExp) => cells.findIndex((c) => re.test(c.trim()));
  const nome = idx(/^nome( do (empregado|funcion[aá]rio))?$/i);
  if (nome < 0) return null;
  const header = {
    nome,
    cpf: idx(/^c\.?p\.?f\.?$/i),
    situacao: idx(/^situa[çc][ãa]o$/i),
    demissao: idx(/demiss[ãa]o/i),
  };
  // Só "Nome" sozinho pode ser um rótulo qualquer; exige ao menos mais uma coluna conhecida.
  return header.cpf >= 0 || header.situacao >= 0 || header.demissao >= 0 ? header : null;
}

/**
 * Lê as linhas de funcionário. Dois formatos:
 *
 *  - **Com cabeçalho** (Relação de Empregados do Domínio, com ou sem coluna de CPF): usa
 *    as colunas. Demitido = data de demissão preenchida (texto ou data do Excel, que chega
 *    como número) ou situação 8/"Demitido".
 *  - **Sem cabeçalho**: procura um CPF e um nome em qualquer célula da linha.
 */
export function parseEmployeesCsv(csv: string): {
  rows: EmployeeImportRow[];
  dismissed: EmployeeImportRow[];
  skippedDismissed: number;
  withoutCpf: number;
} {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ativos = new Map<string, EmployeeImportRow>();
  const demitidos = new Map<string, EmployeeImportRow>();
  let header: Header | null = null;

  const add = (name: string, cpf: string, dismissed: boolean) => {
    const key = cpf || `nome:${nameKey(name)}`;
    if (dismissed) {
      // Recontratado aparece duas vezes (demitido e ativo): vale o ativo.
      if (!ativos.has(key)) demitidos.set(key, { name, cpf });
    } else {
      demitidos.delete(key);
      ativos.set(key, { name, cpf });
    }
  };

  for (const line of lines) {
    if (!line.includes(";")) continue;
    const cells = line.split(";").map((part) => part.trim());

    if (!header) {
      const h = findHeader(cells);
      if (h) {
        header = h;
        continue;
      }
    }

    if (header) {
      const rawName = cells[header.nome] ?? "";
      if (/^total\b|itens listados/i.test(cells.filter(Boolean).join(" "))) continue;
      const name = rawName.replace(/\s+/g, " ").trim().toUpperCase();
      if (name.length < 3 || /^\d/.test(name)) continue;
      let cpf = header.cpf >= 0 ? (cells[header.cpf] ?? "").replace(/\D/g, "") : "";
      if (cpf.length !== 11) {
        cpf = cells.map((c) => c.replace(/\D/g, "")).find((d, i) => i !== header!.nome && d.length === 11) ?? "";
      }
      const situacao = header.situacao >= 0 ? (cells[header.situacao] ?? "") : "";
      const demissao = header.demissao >= 0 ? (cells[header.demissao] ?? "") : "";
      const dismissed = demissao !== "" || /^0*8$|demitid/i.test(situacao);
      add(name, cpf, dismissed);
      continue;
    }

    if (/empresa|cnpj|rela/i.test(line)) continue;
    const parts = cells.filter((part) => part.length > 0);
    if (!parts.length) continue;

    let cpf = "";
    let name = "";

    for (const part of parts) {
      const digits = part.replace(/\D/g, "");
      if (!cpf && digits.length === 11) cpf = digits;
    }
    for (const part of parts) {
      if (part.replace(/\D/g, "").length === 11) continue;
      if (dismissalDate.test(part)) continue;
      if (/^situa/i.test(part)) continue;
      if (part.length >= 3) {
        name = part.replace(/\s+/g, " ").trim().toUpperCase();
        break;
      }
    }

    if (!cpf || !name) continue;
    add(name, cpf, parts.some((part) => dismissalDate.test(part)));
  }

  const rows = Array.from(ativos.values());
  const dismissed = Array.from(demitidos.values());
  return {
    rows,
    dismissed,
    skippedDismissed: dismissed.length,
    withoutCpf: [...rows, ...dismissed].filter((r) => !r.cpf).length,
  };
}

export async function readEmployeeImportText(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xlsm")) {
    const buffer = await file.arrayBuffer();
    return spreadsheetBufferToText(buffer);
  }
  return file.text();
}

/** Planilha → texto separado por ";", com o plano B para .xls que o SheetJS não abre. */
export function spreadsheetBufferToText(buffer: ArrayBuffer): string {
  let rows: string[][] = [];
  try {
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (sheet) {
      rows = XLSX.utils
        .sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: "" })
        .map((row) => row.map((cell) => String(cell)));
    }
  } catch {
    rows = [];
  }
  // Sem aba legível o SheetJS cai no modo texto e devolve o binário como "células" —
  // byte de controle numa célula é o sinal. Aí vale o leitor direto do .xls.
  const vazio = !rows.some((r) => r.some((c) => c.trim()));
  const binario = rows.some((r) => r.some((c) => [...c].some((ch) => ch.charCodeAt(0) < 9)));
  if (vazio || binario) {
    rows = lerCelulasXlsBiff(buffer) ?? (binario ? [] : rows);
  }
  return rowsToDelimitedText(rows);
}

/** O que vai para a API: ativos e demitidos, com a situação explícita. */
export function toImportPayload(parsed: Pick<ParsedEmployeeImport, "rows" | "dismissed">) {
  return [
    ...parsed.rows.map((r) => ({ ...r, active: true })),
    ...parsed.dismissed.map((r) => ({ ...r, active: false })),
  ];
}

/** Resumo do retorno da importação para o toast. */
export function describeImportResult(r: {
  inserted: number;
  skipped: number;
  inativados?: number;
  reativados?: number;
  unificados?: number;
}): string {
  const partes = [`${r.inserted} cadastrado(s)`, `${r.skipped} já existiam`];
  if (r.inativados) partes.push(`${r.inativados} inativado(s) por demissão`);
  if (r.reativados) partes.push(`${r.reativados} reativado(s)`);
  if (r.unificados) partes.push(`${r.unificados} unificado(s) com o cadastro da folha`);
  return `Importação concluída: ${partes.join(", ")}`;
}

export async function parseEmployeeImportFile(file: File): Promise<ParsedEmployeeImport | null> {
  const text = await readEmployeeImportText(file);
  if (!text.trim()) return null;

  const fileCnpj = extractFileCnpj(text);
  if (!fileCnpj) return null;

  const parsed = parseEmployeesCsv(text);
  return { fileCnpj, ...parsed };
}
