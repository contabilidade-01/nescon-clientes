import { describe, expect, it } from "vitest";
import { configPadrao, folgasDoDomingoFixo, modeloDaPessoa, SEMANAS_DOMINGO } from "@/lib/escala/planejamento";
import { gerarDias } from "@/lib/escala/modelos";
import { diaDaSemana } from "@/lib/escala/datas";

describe("5x2 domingo fixo + folga variável", () => {
  it("domingo é sempre folga e a 2ª folga anda um dia por semana", () => {
    expect(SEMANAS_DOMINGO.map((s) => s[1])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(folgasDoDomingoFixo(0)).toEqual([0, 1]);
    expect(folgasDoDomingoFixo(7)).toEqual([0, 2]);
  });

  it("em 3 meses: todo domingo de folga, 2 folgas por semana e nunca mais de 5 dias seguidos", () => {
    for (let r = 0; r < 6; r++) {
      const c = { ...configPadrao("x", "X", "5x2_domingo"), rodizio: r };
      const dias = gerarDias(modeloDaPessoa(c, "2026-12"), "2026-11-29", "2027-03-06");
      let seguidos = 0;
      let maior = 0;
      for (const d of dias) {
        if (diaDaSemana(d.data) === 0) expect(d.turno).toBeNull();
        seguidos = d.turno ? seguidos + 1 : 0;
        maior = Math.max(maior, seguidos);
      }
      expect(maior).toBeLessThanOrEqual(5);
      // Semana a semana (domingo a sábado): 5 dias de trabalho.
      const domingos = dias.map((d, i) => (diaDaSemana(d.data) === 0 ? i : -1)).filter((i) => i >= 0);
      for (const i of domingos) {
        const semana = dias.slice(i, i + 7);
        if (semana.length === 7) expect(semana.filter((d) => d.turno).length).toBe(5);
      }
    }
  });
});
