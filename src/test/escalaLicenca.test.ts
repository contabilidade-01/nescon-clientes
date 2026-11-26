import { describe, expect, it } from "vitest";
import { configPadrao, diasParaValidar, normalizarConfigPessoa, planoHerdado } from "@/lib/escala/planejamento";
import { textoDoDia } from "@/lib/escala/exportarEscala";

describe("licença no lugar de folga", () => {
  const c = { ...configPadrao("1", "Ingrid", "5x2_domingo"), seisPorUmAteVirada: false, licenca: { inicio: "2026-10-20", fim: "2027-02-16" } };

  it("dias da licença não trabalham e saem como Licença; depois segue o modelo", () => {
    const fev = diasParaValidar(c, "2027-02", {}).filter((d) => d.data.startsWith("2027-02"));
    const dia16 = fev.find((d) => d.data === "2027-02-16")!;
    expect(dia16.turno).toBeNull();
    expect(textoDoDia(dia16)).toBe("Licença");
    const depois = fev.filter((d) => d.data >= "2027-02-17");
    expect(depois.some((d) => d.turno)).toBe(true);
    expect(depois.every((d) => !d.licenca)).toBe(true);
    expect(textoDoDia(depois.find((d) => !d.turno))).toBe("Folga");
  });

  it("a licença passa para o mês seguinte e data torta é descartada", () => {
    expect(planoHerdado({ configs: [c], ajustes: {} }).configs[0].licenca).toEqual(c.licenca);
    expect(normalizarConfigPessoa({ ...c, licenca: { inicio: "2027-03-01", fim: "2027-02-01" } }, "5x2").licenca).toBeUndefined();
    expect(normalizarConfigPessoa(c, "5x2").licenca).toEqual(c.licenca);
  });
});
