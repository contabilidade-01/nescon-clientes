import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { linhasDaPlanilha, pdfDaEscala, semanasDoMes, textoDoDia, type EscalaExportada } from "@/lib/escala/exportarEscala";
import { configPadrao, diasDoMes, diasParaValidar } from "@/lib/escala/planejamento";

function escala(): EscalaExportada {
  const mes = "2026-12";
  const feriados = new Map([["2026-12-25", "Natal"]]);
  const pessoas = ["Ana", "Bruno"].map((nome, i) => {
    const c = { ...configPadrao(String(i), nome, "5x2"), folgas5x2: [6, 0], seisPorUmAteVirada: false };
    const dias = diasParaValidar(c, mes, {}, new Set(feriados.keys())).filter((d) => d.data.startsWith(mes));
    return { nome, descricao: "Trabalha 5 dias", dias };
  });
  return { mes, empresa: "Padaria Exemplo LTDA", regra: "A partir de 16/12/2026: no máximo 42h por semana.", pessoas, feriados, erros: 0 };
}

describe("baixar a escala", () => {
  it("separa o mês em semanas de domingo a sábado", () => {
    const s = semanasDoMes(diasDoMes("2026-12"));
    expect(s[0].slice(0, 3)).toEqual([null, null, "2026-12-01"]);
    expect(s.every((w) => w.length === 7)).toBe(true);
    expect(s.flat().filter(Boolean)).toHaveLength(31);
  });

  it("planilha: um dia por coluna, folga escrita e horas no mês", () => {
    const l = linhasDaPlanilha(escala());
    expect(l[0][0]).toBe("Funcionário");
    expect(l[0][1]).toBe("Ter 01/12");
    expect(l[0].at(-1)).toBe("Horas no mês");
    expect(l[1][1]).toBe("08:00–17:00");
    expect(l[1][6]).toBe("Folga"); // sábado 05/12
    expect(l[1][25]).toBe("Folga (Natal)");
    expect(l[1].at(-1)).toMatch(/^\d+h/);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(l), "Escala");
    expect(XLSX.write(wb, { type: "array", bookType: "xlsx" }).byteLength).toBeGreaterThan(0);
  });

  it("texto do dia com feriado trabalhado", () => {
    expect(textoDoDia({ data: "2026-12-25", turno: { entrada: "08:00", saida: "12:00", intervaloMin: 0 } }, "Natal")).toBe("08:00–12:00 (feriado)");
  });

  it("PDF sai com as semanas do mês", () => {
    const doc = pdfDaEscala({ ...escala(), erros: 2 });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(1000);
  });
});
