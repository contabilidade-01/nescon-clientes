import { describe, it, expect } from "vitest";
import { calcularPeriodoSuspensao } from "@/lib/suspensaoPeriodo";

const d = (iso: string) => new Date(`${iso}T00:00:00`);
const br = (x: Date) => `${x.getDate()}/${x.getMonth() + 1}`;

describe("período da suspensão — escala normal (dias corridos)", () => {
  it("1 dia começando dia 10: fim 10, retorno 11", () => {
    const r = calcularPeriodoSuspensao({ inicio: d("2026-09-10"), dias: 1, escala12x36: false });
    expect(br(r.fim)).toBe("10/9");
    expect(br(r.retorno)).toBe("11/9");
  });

  it("3 dias começando dia 10: fim 12, retorno 13", () => {
    const r = calcularPeriodoSuspensao({ inicio: d("2026-09-10"), dias: 3, escala12x36: false });
    expect(br(r.fim)).toBe("12/9");
    expect(br(r.retorno)).toBe("13/9");
  });
});

describe("período da suspensão — 12x36 (plantões)", () => {
  // O caso relatado: dia 11 é folga, então prometer retorno no 11 não faz sentido.
  it("1 plantão começando dia 10: fim 10, retorno 12 (pula a folga do 11)", () => {
    const r = calcularPeriodoSuspensao({ inicio: d("2026-09-10"), dias: 1, escala12x36: true });
    expect(br(r.fim)).toBe("10/9");
    expect(br(r.retorno)).toBe("12/9");
  });

  it("2 plantões começando dia 10: suspende 10 e 12, retorno 14", () => {
    const r = calcularPeriodoSuspensao({ inicio: d("2026-09-10"), dias: 2, escala12x36: true });
    expect(br(r.fim)).toBe("12/9");
    expect(br(r.retorno)).toBe("14/9");
  });

  it("3 plantões começando dia 10: suspende 10, 12 e 14, retorno 16", () => {
    const r = calcularPeriodoSuspensao({ inicio: d("2026-09-10"), dias: 3, escala12x36: true });
    expect(br(r.fim)).toBe("14/9");
    expect(br(r.retorno)).toBe("16/9");
  });

  it("atravessa a virada de mês", () => {
    const r = calcularPeriodoSuspensao({ inicio: d("2026-09-29"), dias: 2, escala12x36: true });
    expect(br(r.fim)).toBe("1/10");
    expect(br(r.retorno)).toBe("3/10");
  });
});
