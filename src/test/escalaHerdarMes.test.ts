import { describe, expect, it } from "vitest";
import { configPadrao, mesAnteriorSalvo, modeloDaPessoa, planoHerdado, type PlanoMes } from "@/lib/escala/planejamento";
import { gerarDias } from "@/lib/escala/modelos";

describe("mês novo herda a escala do último mês salvo", () => {
  it("acha o último mês salvo antes do mês pedido", () => {
    const salvos = [{ mes: "2027-02" }, { mes: "2026-12" }, { mes: "2027-01" }];
    expect(mesAnteriorSalvo(salvos, "2027-03")).toBe("2027-02");
    expect(mesAnteriorSalvo(salvos, "2027-01")).toBe("2026-12");
    expect(mesAnteriorSalvo(salvos, "2026-12")).toBeNull();
  });

  it("leva pessoas, vagas, unidade, modelo, horário e rodízio; deixa os ajustes e a 6x1 até a virada", () => {
    const ana = { ...configPadrao("1", "Ana", "5x2_domingo"), rodizio: 2, saida: "17:24", unidade: "Matriz", seisPorUmAteVirada: true };
    const vaga = { ...configPadrao("vaga-1", "Carlos", "5x2_domingo"), rodizio: 1, unidade: "Terra Preta" };
    const dez: PlanoMes = { configs: [ana, vaga], ajustes: { "1": { "2026-12-10": null } } };
    const jan = planoHerdado(dez);
    expect(jan.ajustes).toEqual({});
    expect(jan.configs.map((c) => [c.id, c.unidade, c.rodizio, c.saida, c.seisPorUmAteVirada])).toEqual([
      ["1", "Matriz", 2, "17:24", false],
      ["vaga-1", "Terra Preta", 1, "17:00", false],
    ]);
  });

  it("o rodízio continua sem quebra na virada do mês", () => {
    const c = { ...configPadrao("1", "Ana", "5x2_domingo"), rodizio: 3 };
    const corrido = gerarDias(modeloDaPessoa(c, "2026-12"), "2026-12-27", "2027-01-09");
    const dez = gerarDias(modeloDaPessoa(c, "2026-12"), "2026-12-27", "2026-12-31");
    const jan = gerarDias(modeloDaPessoa(planoHerdado({ configs: [c], ajustes: {} }).configs[0], "2027-01"), "2027-01-01", "2027-01-09");
    expect([...dez, ...jan].map((d) => d.turno === null)).toEqual(corrido.map((d) => d.turno === null));
  });
});
