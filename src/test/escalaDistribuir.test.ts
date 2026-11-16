import { describe, expect, it } from "vitest";
import { distribuir, espalhar, separarEmGrupos, sorteador } from "@/lib/escala/distribuir";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";
import { normalizarConfigEmpresa } from "@/lib/escala/planejamento";
import type { Demanda } from "@/lib/escala/contingente";

const PESSOAS = Array.from({ length: 8 }, (_, i) => ({ id: String(i), nome: `P${i}` }));
const fer = (ano: number) => new Set(feriadosDaEmpresa([ano - 1, ano], [], false).keys());
const comercio = { ...normalizarConfigEmpresa(null), segmento: "comercio" as const, demanda: [2, 4, 4, 4, 4, 4, 4] as Demanda };

describe("ferramentas do sorteio", () => {
  it("a mesma semente dá o mesmo resultado", () => {
    const a = sorteador(42);
    const b = sorteador(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("espalhar não repete antes de usar todos", () => {
    const r = espalhar([1, 2, 3], 6, sorteador(1));
    expect(new Set(r.slice(0, 3)).size).toBe(3);
    expect(r.slice(3)).toEqual(r.slice(0, 3));
  });
  it("separa por quantidade e o resto vai para o grupo sem quantidade", () => {
    const g = separarEmGrupos(
      PESSOAS,
      [
        { id: "a", modelo: "12x36", quantidade: 2, folgaFixa: null },
        { id: "b", modelo: "5x2", quantidade: null, folgaFixa: 1, pessoas: ["7"] },
      ],
      sorteador(3),
    );
    expect(g.a).toHaveLength(2);
    expect(g.b).toHaveLength(6);
    expect(g.b.map((p) => p.id)).toContain("7");
  });
});

describe("distribuir", () => {
  it("5x2 com folga variável em jan/2027 sai sem erro e cobre a demanda", () => {
    const r = distribuir(PESSOAS, [{ id: "g", modelo: "5x2_rev", quantidade: null, folgaFixa: null }], "2027-01", comercio, fer(2027), 7);
    expect(r.valida).toBe(true);
    expect(r.cenario.erros).toBe(0);
    expect(r.validas).toBeGreaterThan(0);
  });

  it("mistura 12x36 e 5x2 com folga fixa na segunda", () => {
    const r = distribuir(
      PESSOAS,
      [
        { id: "plantao", modelo: "12x36", quantidade: 4, folgaFixa: null },
        { id: "dia", modelo: "5x2", quantidade: null, folgaFixa: 1 },
      ],
      "2027-02",
      { ...comercio, segmento: "restaurante" },
      fer(2027),
      11,
    );
    expect(r.porGrupo.plantao).toHaveLength(4);
    const doze = r.cenario.configs.filter((c) => c.modelo === "12x36");
    expect(doze.filter((c) => c.turma === "A")).toHaveLength(2);
    const cinco = r.cenario.configs.filter((c) => c.modelo === "5x2");
    expect(cinco.every((c) => c.folgas5x2.includes(1))).toBe(true);
    expect(r.valida).toBe(true);
  });

  it("6x1 em nov/2026 (antes da emenda) é aceita; em jan/2027 nenhuma tentativa serve", () => {
    const antes = distribuir(PESSOAS, [{ id: "g", modelo: "6x1", quantidade: null, folgaFixa: null }], "2026-11", comercio, fer(2026), 5);
    expect(antes.valida).toBe(true);
    const depois = distribuir(PESSOAS, [{ id: "g", modelo: "6x1", quantidade: null, folgaFixa: null }], "2027-01", comercio, fer(2027), 5, 5);
    expect(depois.valida).toBe(false);
    expect(depois.cenario.motivos.length).toBeGreaterThan(0);
  });

  it("outra semente muda a distribuição", () => {
    const g = [{ id: "g", modelo: "5x2" as const, quantidade: null, folgaFixa: null }];
    const a = distribuir(PESSOAS, g, "2027-03", comercio, fer(2027), 1, 3);
    const b = distribuir(PESSOAS, g, "2027-03", comercio, fer(2027), 2, 3);
    expect(JSON.stringify(a.cenario.configs.map((c) => c.folgas5x2))).not.toBe(JSON.stringify(b.cenario.configs.map((c) => c.folgas5x2)));
  });
});
