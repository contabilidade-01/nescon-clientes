/**
 * Domingo de folga: restaurante a cada 3 semanas (como o comércio, Portaria 671 Anexo IV e
 * Lei 10.101), mulher a cada 2 semanas (art. 386 da CLT), e o modelo 5x2 domingo quinzenal
 * (ciclo de 4 semanas) que cumpre as duas.
 */
import { describe, it, expect } from "vitest";
import { simularCenarios, turnoQuePreenche } from "@/lib/escala/cenarios";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";
import {
  SEMANAS_QUINZENAL,
  avaliarPessoa,
  configPadrao,
  fraseDaPessoa,
  normalizarConfigEmpresa,
  normalizarConfigPessoa,
  type ConfigEmpresa,
} from "@/lib/escala/planejamento";
import { SEGMENTOS } from "@/lib/escala/regras";

const restaurante: ConfigEmpresa = { ...normalizarConfigEmpresa(null), segmento: "restaurante", temAcordoColetivo: false };
const semFeriado = new Set<string>();
const domingos = (o: { regra: string }[]) => o.filter((x) => x.regra === "DOMINGO");

describe("regra do domingo", () => {
  it("restaurante: domingo de folga a cada 3 semanas", () => {
    expect(SEGMENTOS.restaurante.domingoACadaSemanas).toBe(3);
  });

  it("mulher: 2 domingos seguidos trabalhados já é erro; homem só no 3º", () => {
    // 5x2 fixo seg+ter: nunca folga no domingo.
    const base = { ...configPadrao("1", "Ana", "5x2"), folgas5x2: [1, 2], seisPorUmAteVirada: false };
    const mulher = avaliarPessoa({ ...base, sexo: "F" }, "2027-02", {}, restaurante, semFeriado);
    const homem = avaliarPessoa({ ...base, sexo: "M" }, "2027-02", {}, restaurante, semFeriado);
    const m = domingos(mulher.ocorrencias);
    const h = domingos(homem.ocorrencias);
    expect(m.length).toBeGreaterThan(0);
    expect(m[0].mensagem).toContain("art. 386");
    expect(h.length).toBeGreaterThan(0);
    expect(m[0].data < h[0].data).toBe(true);
  });

  it("sexo fica salvo no plano e lixo vira vazio", () => {
    expect(normalizarConfigPessoa({ ...configPadrao("1", "Ana", "5x2"), sexo: "F" }, "5x2").sexo).toBe("F");
    expect(normalizarConfigPessoa({ ...configPadrao("1", "Ana", "5x2"), sexo: "x" as never }, "5x2").sexo).toBeUndefined();
  });
});

describe("5x2 domingo quinzenal", () => {
  it("ciclo de 4 semanas com domingo em semanas alternadas", () => {
    expect(SEMANAS_QUINZENAL.map((s) => s.includes(0))).toEqual([true, false, true, false]);
  });

  it("mulher, 8h e 8h24 (42h sem acordo): nenhum erro em nenhum grupo, de dez/2026 a 2028", () => {
    for (let r = 0; r < 4; r++) {
      for (const saida of ["17:00", "17:24"]) {
        const c = { ...configPadrao("1", "Ana", "5x2_quinzenal"), rodizio: r, saida, sexo: "F" as const, seisPorUmAteVirada: false };
        for (const mes of ["2027-01", "2027-02", "2027-03", "2027-06", "2027-11"]) {
          const a = avaliarPessoa(c, mes, {}, restaurante, semFeriado);
          expect(a.ocorrencias.filter((o) => o.gravidade === "erro")).toEqual([]);
          expect(a.maiorSemana).toBe(saida === "17:00" ? 40 : 42);
        }
      }
    }
  });

  it("dezembro de 2026: com a folga da 6x1 no domingo, a virada em 14/12 não dá erro", () => {
    for (let r = 0; r < 4; r++) {
      const c = { ...configPadrao("1", "Ana", "5x2_quinzenal"), rodizio: r, folga6x1: 0, sexo: "F" as const, saida: "17:24" };
      const a = avaliarPessoa(c, "2026-12", {}, restaurante, semFeriado);
      expect(a.ocorrencias.filter((o) => o.gravidade === "erro")).toEqual([]);
    }
    expect(fraseDaPessoa(configPadrao("1", "Ana", "5x2_quinzenal"))).toContain("domingo a cada 2 semanas");
  });

  it("cenário pronto aplica no restaurante, com as mulheres da equipe", () => {
    const pessoas = Array.from({ length: 8 }, (_, i) => ({ id: String(i), nome: `P${i}`, sexo: "F" as const }));
    const feriados = new Set(feriadosDaEmpresa([2026, 2027], [], false).keys());
    const r = simularCenarios(pessoas, "2027-01", restaurante, feriados).find((x) => x.id === "5x2_quinzenal")!;
    expect(r.podeAplicar).toBe(true);
    expect(new Set(r.configs.map((c) => c.rodizio)).size).toBe(4);
    expect(r.configs.every((c) => c.sexo === "F")).toBe(true);
    expect(turnoQuePreenche({ entrada: "08:00", saida: "17:00", intervaloMin: 60 }, "5x2_quinzenal", 42)?.saida).toBe("17:24");
  });
});
