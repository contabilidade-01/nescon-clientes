import { describe, it, expect } from "vitest";
import { classificarClientes, competenciaAtual, competenciaValida } from "../../api/src/clientesSemBoleto.js";

const emp = (id: string, boletos: number, extra: Record<string, unknown> = {}) => ({
  id, name: `Empresa ${id}`, cnpj: id, matriz_id: null, boletos, boletos_ativo: true,
  honorario_cobranca_ativo: true, gclick_status: "ATIVO", ...extra,
});

describe("competência", () => {
  it("valida YYYY-MM", () => {
    expect(competenciaValida("2026-10")).toBe(true);
    for (const c of ["2026-13", "2026-1", "10/2026", "", null]) expect(competenciaValida(c)).toBe(false);
  });
  it("mês atual no fuso de São Paulo (virada de mês em UTC ainda é o mês anterior)", () => {
    expect(competenciaAtual(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10");
    expect(competenciaAtual(new Date("2026-11-01T04:00:00Z"))).toBe("2026-11");
  });
});

describe("classificarClientes", () => {
  it("separa quem tem e quem não tem boleto, em ordem de nome", () => {
    const r = classificarClientes([emp("c", 0), emp("a", 1), emp("b", 0, { boletos_ativo: false })]);
    expect(r.total_ativas).toBe(3);
    expect(r.com_boleto).toBe(1);
    expect(r.sem_boleto.map((e) => e.id)).toEqual(["b", "c"]);
    expect(r.sem_boleto[0].boletos_ativo).toBe(false);
  });

  it("filial sem boleto com matriz que teve boleto vai para cobertas_pela_matriz", () => {
    const r = classificarClientes([
      emp("m", 1),
      emp("f1", 0, { matriz_id: "m" }),
      emp("m2", 0),
      emp("f2", 0, { matriz_id: "m2" }),
    ]);
    expect(r.cobertas_pela_matriz.map((e) => e.id)).toEqual(["f1"]);
    expect(r.cobertas_pela_matriz[0].matriz_nome).toBe("Empresa m");
    expect(r.sem_boleto.map((e) => e.id)).toEqual(["f2", "m2"]);
  });

  it("boletos vindo como string do pg conta como número", () => {
    const r = classificarClientes([emp("a", "2" as unknown as number), emp("b", "0" as unknown as number)]);
    expect(r.com_boleto).toBe(1);
    expect(r.sem_boleto.map((e) => e.id)).toEqual(["b"]);
  });
});
