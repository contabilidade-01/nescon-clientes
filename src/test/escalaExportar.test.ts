import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { linhasDaPlanilha, mediaSemanal, pdfDaEscala, semanasDoMes, textoDoDia, type EscalaExportada } from "@/lib/escala/exportarEscala";
import { avaliarPessoa, configEmpresaPadrao, configPadrao, diasDoMes, diasParaValidar } from "@/lib/escala/planejamento";
import { simularCenarios, turnoQuePreenche } from "@/lib/escala/cenarios";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";

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
    expect(l[0].slice(-2)).toEqual(["Horas no mês", "Média por semana"]);
    expect(l[1][1]).toBe("08:00–17:00");
    expect(l[1][6]).toBe("Folga"); // sábado 05/12
    expect(l[1][25]).toBe("Folga (Natal)");
    expect(l[1].at(-2)).toMatch(/^\d+h/);
    expect(l[1].at(-1)).toBe("37h20"); // 40h, 40h e 32h (semana do Natal)
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

describe("usar as 42h", () => {
  it("5x2 de 8h vira 8h24 por dia (08:00 às 17:24) para fechar 42h", () => {
    const t = turnoQuePreenche({ entrada: "08:00", saida: "17:00", intervaloMin: 60 }, "5x2", 42);
    expect(t).toEqual({ entrada: "08:00", saida: "17:24", intervaloMin: 60 });
    expect(turnoQuePreenche({ entrada: "08:00", saida: "17:00", intervaloMin: 60 }, "5x2", 40)).toBeNull();
    expect(turnoQuePreenche({ entrada: "07:00", saida: "19:00", intervaloMin: 60 }, "12x36", 42)).toBeNull();
  });

  it("com acordo, a sugestão de 42h passa nas regras e cada semana inteira soma 42h", () => {
    const mes = "2027-01";
    const fer = new Set(feriadosDaEmpresa([2026, 2027], [], false).keys());
    const cfg = { ...configEmpresaPadrao(), temAcordoColetivo: true, atividadeDefinida: true };
    const pessoas = Array.from({ length: 4 }, (_, i) => ({ id: String(i), nome: `P${i}` }));
    const turno = turnoQuePreenche({ entrada: "08:00", saida: "17:00", intervaloMin: 60 }, "5x2", 42)!;
    const c = simularCenarios(pessoas, mes, cfg, fer, 0, { "5x2_fds": turno }).find((x) => x.id === "5x2_fds")!;
    expect(c.podeAplicar).toBe(true);
    const a = avaliarPessoa(c.configs[0], mes, {}, cfg, fer);
    expect(mediaSemanal(a.dias, diasDoMes(mes))).toBe(42 * 60);
  });
});
