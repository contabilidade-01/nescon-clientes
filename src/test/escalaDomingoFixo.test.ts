import { describe, expect, it } from "vitest";
import { configPadrao, folgasDoDomingoFixo, modeloDaPessoa, SEMANAS_DOMINGO } from "@/lib/escala/planejamento";
import { gerarDias } from "@/lib/escala/modelos";
import { diaDaSemana } from "@/lib/escala/datas";

const contarDomingos = (dias: Array<{ data: string }>) => dias.filter((d) => diaDaSemana(d.data) === 0).length;

describe("5x2 domingo fixo + folga variável", () => {
  it("domingo é sempre folga e a 2ª folga anda de segunda a sexta (nunca no sábado)", () => {
    expect(SEMANAS_DOMINGO.map((s) => s[1])).toEqual([1, 2, 3, 4, 5]);
    expect(folgasDoDomingoFixo(0)).toEqual([0, 1]);
    expect(folgasDoDomingoFixo(6)).toEqual([0, 2]);
  });

  it("em 3 meses: todo domingo de folga, 2 folgas por semana, só dom+seg juntos (1 a cada 5 semanas) e nunca mais de 5 dias seguidos", () => {
    for (let r = 0; r < SEMANAS_DOMINGO.length; r++) {
      const c = { ...configPadrao("x", "X", "5x2_domingo"), rodizio: r };
      const dias = gerarDias(modeloDaPessoa(c, "2026-12"), "2026-11-29", "2027-03-06");
      let seguidos = 0;
      let maior = 0;
      dias.forEach((d, i) => {
        if (diaDaSemana(d.data) === 0) expect(d.turno).toBeNull();
        if (i > 0 && !d.turno && !dias[i - 1].turno) expect(diaDaSemana(d.data), `folgas seguidas em ${d.data}`).toBe(1);
        seguidos = d.turno ? seguidos + 1 : 0;
        maior = Math.max(maior, seguidos);
      });
      expect(maior).toBeLessThanOrEqual(5);
      const domSeg = dias.filter((d, i) => i > 0 && diaDaSemana(d.data) === 1 && !d.turno).length;
      expect(domSeg).toBeLessThanOrEqual(Math.ceil(contarDomingos(dias) / 5));
      // Semana a semana (domingo a sábado): 5 dias de trabalho.
      const domingos = dias.map((d, i) => (diaDaSemana(d.data) === 0 ? i : -1)).filter((i) => i >= 0);
      for (const i of domingos) {
        const semana = dias.slice(i, i + 7);
        if (semana.length === 7) expect(semana.filter((d) => d.turno).length).toBe(5);
      }
    }
  });
});

describe("equipe espalhada pelo ciclo", () => {
  it("10 pessoas em 5 pontos do ciclo: 2 de folga por dia, de segunda a sexta, e ninguém no sábado", () => {
    const pessoas = Array.from({ length: 10 }, (_, i) => ({ ...configPadrao(String(i), `P${i}`, "5x2_domingo"), rodizio: i % 5 }));
    const dias = pessoas.map((c) => gerarDias(modeloDaPessoa(c, "2026-12"), "2026-12-06", "2026-12-12"));
    for (let d = 1; d <= 6; d++) {
      const folgando = dias.filter((ds) => !ds[d].turno).length;
      expect(folgando).toBe(d === 6 ? 0 : 2);
    }
  });
});
