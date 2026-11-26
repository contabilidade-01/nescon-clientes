import { describe, expect, it } from "vitest";
import { aplicarCargos, coberturaPorCargo, normalizarCargos } from "@/lib/escala/cargos";
import { linhasDaPlanilha, pdfDaEscala } from "@/lib/escala/exportarEscala";
import { normalizarConfigEmpresa } from "@/lib/escala/planejamento";

const T = { entrada: "08:00", saida: "17:00", intervaloMin: 60 };

describe("cargos na escala", () => {
  it("cargo marcado na tela vale mais que o do cadastro; sem nenhum, fica o do mês", () => {
    const configs = [{ id: "a" }, { id: "b" }, { id: "c", cargo: "Caixa" }];
    const r = aplicarCargos(configs, { a: "Garçom" }, new Map([["a", "COZINHEIRO"], ["b", " Ajudante  de cozinha "]]));
    expect(r.map((c) => c.cargo)).toEqual(["Garçom", "Ajudante de cozinha", "Caixa"]);
  });

  it("lê cargos e mínimo do JSON salvo, descartando o que vier torto", () => {
    const n = normalizarCargos({ cargos: { a: "Cozinheiro", b: "" }, minimoPorCargo: { Cozinheiro: [1, 1, 1, 1, 1, 2, 2], Garçom: [0, 0, 0, 0, 0, 0, 0], X: [1] } });
    expect(n).toEqual({ cargos: { a: "Cozinheiro" }, minimoPorCargo: { Cozinheiro: [1, 1, 1, 1, 1, 2, 2] } });
    expect(normalizarConfigEmpresa({}).minimoPorCargo).toEqual({});
  });

  it("conta quantos de cada cargo trabalham e acusa o dia abaixo do mínimo (sem ligar para maiúsculas e acentos)", () => {
    const datas = ["2026-12-06", "2026-12-07"]; // domingo e segunda
    const linhas = [
      { config: { cargo: "Cozinheiro" }, dias: [{ data: datas[0], turno: null }, { data: datas[1], turno: T }] },
      { config: { cargo: "COZINHEIRO" }, dias: [{ data: datas[0], turno: null }, { data: datas[1], turno: T }] },
      { config: { cargo: "Garçom" }, dias: [{ data: datas[0], turno: T }, { data: datas[1], turno: T }] },
    ];
    const c = coberturaPorCargo(linhas, datas, { Cozinheiro: [1, 1, 1, 1, 1, 1, 1] });
    const coz = c.find((x) => x.cargo === "Cozinheiro")!;
    expect([...coz.porDia.values()]).toEqual([0, 2]);
    expect(coz.faltas).toEqual(["2026-12-06"]);
    expect(c.find((x) => x.cargo === "Garçom")!.faltas).toEqual([]);
  });

  it("planilha ganha a coluna Cargo e o PDF sai com as linhas de cobertura", () => {
    const dias = ["2026-12-06", "2026-12-07"].map((data) => ({ data, turno: T }));
    const e = { mes: "2026-12", regra: "", pessoas: [{ nome: "Ana", descricao: "", dias, cargo: "Cozinheiro" }], feriados: new Map(), erros: 0, minimoPorCargo: { Cozinheiro: [2, 2, 2, 2, 2, 2, 2] as [number, number, number, number, number, number, number] } };
    expect(linhasDaPlanilha(e)[0].slice(0, 2)).toEqual(["Funcionário", "Cargo"]);
    expect(linhasDaPlanilha(e)[1].slice(0, 2)).toEqual(["Ana", "Cozinheiro"]);
    expect(pdfDaEscala(e).getNumberOfPages()).toBeGreaterThan(0);
  });
});
