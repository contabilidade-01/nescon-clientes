import * as XLSX from "xlsx";

export type ParsedEmployeeImport = {
  fileCnpj: string;
  rows: Array<{ name: string; cpf: string }>;
  skippedDismissed: number;
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

export function parseEmployeesCsv(csv: string): {
  rows: Array<{ name: string; cpf: string }>;
  skippedDismissed: number;
} {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed = new Map<string, { name: string; cpf: string }>();
  let skippedDismissed = 0;

  for (const line of lines) {
    if (!line.includes(";")) continue;
    if (/empresa|cnpj|rela/i.test(line)) continue;

    const parts = line.split(";").map((part) => part.trim()).filter((part) => part.length > 0);
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
    if (parts.some((part) => dismissalDate.test(part))) {
      skippedDismissed += 1;
      continue;
    }
    parsed.set(cpf, { name, cpf });
  }

  return { rows: Array.from(parsed.values()), skippedDismissed };
}

export async function readEmployeeImportText(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xlsm")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return "";
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: "" });
    return rowsToDelimitedText(rows.map((row) => row.map((cell) => String(cell))));
  }
  return file.text();
}

export async function parseEmployeeImportFile(file: File): Promise<ParsedEmployeeImport | null> {
  const text = await readEmployeeImportText(file);
  if (!text.trim()) return null;

  const fileCnpj = extractFileCnpj(text);
  if (!fileCnpj) return null;

  const { rows, skippedDismissed } = parseEmployeesCsv(text);
  return { fileCnpj, rows, skippedDismissed };
}
