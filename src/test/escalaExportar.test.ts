import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { gruposPorUnidade, linhasDaPlanilha, mediaDe2Semanas, mediaSemanal, pdfDaEscala, linhasDasSemanas, semanaDaLei, semanasDoMes, textoDaSemanaDaLei, textoDoDia, type EscalaExportada } from "@/lib/escala/exportarEscala";
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

describe("PDF separado por unidade", () => {
  it("agrupa por unidade, na ordem da tela, e deixa quem não tem unidade no fim", () => {
    const e = escala();
    const [ana, bruno] = e.pessoas;
    const pessoas = [
      { ...ana, nome: "Sem time" },
      { ...ana, unidade: "Matriz" },
      { ...bruno, unidade: "Terra Preta" },
      { ...bruno, nome: "Carla", unidade: "Matriz" },
    ];
    const g = gruposPorUnidade(pessoas);
    expect(g.map((x) => x.titulo)).toEqual(["Unidade Matriz", "Unidade Terra Preta", "Sem unidade"]);
    expect(g[0].pessoas.map((p) => p.nome)).toEqual(["Ana", "Carla"]);
    expect(g[2].pessoas.map((p) => p.nome)).toEqual(["Sem time"]);
  });

  it("uma unidade só (ou nenhuma) sai como antes, sem título", () => {
    expect(gruposPorUnidade(escala().pessoas)).toEqual([{ pessoas: escala().pessoas }]);
    const unica = escala().pessoas.map((p) => ({ ...p, unidade: "Matriz" }));
    expect(gruposPorUnidade(unica)[0].titulo).toBeUndefined();
  });

  it("cada unidade começa em página nova", () => {
    const e = escala();
    const so = pdfDaEscala(e).getNumberOfPages();
    const duas = pdfDaEscala({ ...e, pessoas: [{ ...e.pessoas[0], unidade: "Matriz" }, { ...e.pessoas[1], unidade: "Terra Preta" }] });
    expect(duas.getNumberOfPages()).toBeGreaterThanOrEqual(so + 1);
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

describe("12x36 igual na tela e no arquivo", () => {
  it("turma A com 16 plantões e B com 15 em dez/2026; média de 2 semanas 38h30 nas duas", () => {
    const mes = "2026-12";
    const fer = new Set(feriadosDaEmpresa([2025, 2026], [], false).keys());
    const cfg = { ...configEmpresaPadrao(), atividadeDefinida: true, usa12x36: true };
    const datas = diasDoMes(mes);
    for (const [turma, plantoes] of [["A", 16], ["B", 15]] as const) {
      const a = avaliarPessoa({ ...configPadrao(turma, turma, "12x36"), turma }, mes, {}, cfg, fer);
      expect(a.dias.filter((d) => d.turno).length).toBe(plantoes);
      expect(a.horas).toBe(plantoes * 11);
      expect(mediaDe2Semanas(a.dias, datas)).toBe(38.5 * 60);
      expect(a.maiorSemana).toBe(38.5);
    }
  });
});

describe("PDF da 12x36 com equipe grande", () => {
  it("19 pessoas com nomes longos: cada semana cabe em uma página (5 semanas = 5 páginas)", () => {
    const mes = "2026-12";
    const fer = new Set(feriadosDaEmpresa([2025, 2026], [], false).keys());
    const cfg = { ...configEmpresaPadrao(), atividadeDefinida: true, usa12x36: true };
    const pessoas = Array.from({ length: 19 }, (_, i) => {
      const turma = i % 2 ? "B" : "A";
      const a = avaliarPessoa({ ...configPadrao(String(i), `PESSOA ${i}`, "12x36"), turma }, mes, {}, cfg, fer);
      return { nome: i % 2 ? "ANA CLAUDIA CICERO DE FREITAS SALES" : "DANIELA ADAMOLI VILAR PRIETO EVANGELISTA", descricao: "12x36", dias: a.dias.filter((d) => d.data.startsWith(mes)), doze36: true };
    });
    const doc = pdfDaEscala({ mes, empresa: "RESTAURANTE EXEMPLO LTDA", regra: "A partir de 16/12/2026: no máximo 42h por semana.", pessoas, feriados: new Map([["2026-12-25", "Natal"]]), erros: 0 });
    expect(doc.getNumberOfPages()).toBe(5);
  });
});

describe("semana pela lei no PDF e no Excel", () => {
  const restaurante = { segmento: "restaurante" as const, temAcordoColetivo: false, abreNosFeriados: true };
  const pessoa = (saida: string) => {
    const c = { ...configPadrao("1", "Ana", "5x2_3semanas"), saida, seisPorUmAteVirada: false };
    const a = avaliarPessoa(c, "2027-01", {}, restaurante, new Set());
    return {
      nome: "Ana",
      descricao: "",
      dias: a.dias,
      semanas: a.semanasInteiras.map((s) => ({ inicio: s.inicio, horas: s.horas, folgas: s.folgas, limiteHoras: s.limiteHoras, repousosExigidos: s.repousosExigidos })),
    };
  };

  it("a semana cortada pelo mês conta os dias do mês vizinho e mostra o limite", () => {
    const p = pessoa("17:24");
    const primeira = semanasDoMes(diasDoMes("2027-01"))[0]; // 27/12 a 02/01
    const lei = semanaDaLei(p, primeira)!;
    expect(lei.inicio).toBe("2026-12-27");
    expect(textoDaSemanaDaLei(lei)).toBe("42h de 42h · 2 folgas");
  });

  it("acima do limite sai marcado, e a aba Semanas (lei) diz o que falta", () => {
    const p = pessoa("18:00");
    expect(textoDaSemanaDaLei(p.semanas[1])).toMatch(/\(ACIMA\)$/);
    const linhas = linhasDasSemanas({ mes: "2027-01", regra: "", pessoas: [p], feriados: new Map(), erros: 1 });
    expect(linhas[0]).toEqual(["Funcionário", "Semana", "Horas", "Limite", "Folgas", "Exigidas", "Situação"]);
    expect(linhas[1].slice(0, 2)).toEqual(["Ana", "27/12 a 02/01"]);
    expect(linhas[1][6]).toBe("acima do limite");
  });
});
