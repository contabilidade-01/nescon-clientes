/**
 * O cruzamento entre a Programação de Férias e a folha. É aqui que um erro faria o
 * cliente ver o custo de outro funcionário — ou um custo que não existe.
 */
import { describe, it, expect } from "vitest";
import { enriquecer, normalizar } from "../../api/src/routes/vacations.js";

const salarios = {
  porCodigo: new Map([["8", { salario: 3000, competencia: "07/2026" }]]),
  porNome: new Map([["JOSE DA SILVA", { salario: 1500, competencia: "07/2026" }]]),
};

const periodo = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  codigo: "8",
  nome: "FLAVIA MORAES DE GOIS",
  admissao: "2024-05-01",
  inicio_aquisitivo: "2025-05-01",
  fim_aquisitivo: "2026-04-30",
  inicio_gozo: null,
  limite_gozo: "2027-04-07",
  dias_acumulados: "24",
  dias_gozados: "0",
  dias_direito: "24",
  dias_afastamento: 0,
  faltas: 11,
  ...over,
});

describe("cruzamento com a folha", () => {
  it("casa pelo código e calcula o custo", () => {
    const [r] = enriquecer([periodo()], salarios, new Date(2026, 7, 4));
    expect(r.salario_base).toBe(3000);
    // 24 dias de 3.000 = 2.400 + 1/3 + FGTS
    expect(r.custo).toMatchObject({ bruto: 2400, umTerco: 800, fgts: 256, total: 3456 });
  });

  it("sem código, cai para o nome normalizado", () => {
    const [r] = enriquecer([periodo({ codigo: null, nome: "José da  Silva" })], salarios);
    expect(r.salario_base).toBe(1500);
  });

  it("funcionário desconhecido fica sem custo, não com zero", () => {
    const [r] = enriquecer([periodo({ codigo: "999", nome: "QUEM NUNCA" })], salarios);
    expect(r.salario_base).toBeNull();
    expect(r.custo).toBeNull();
  });

  it("dias já gozados saem da conta do que ainda vai custar", () => {
    const [r] = enriquecer([periodo({ dias_gozados: "10" })], salarios);
    expect(r.dias_a_pagar).toBe(14);
    expect(r.custo!.bruto).toBe(1400);
  });

  it("período todo gozado não custa mais nada", () => {
    const [r] = enriquecer([periodo({ dias_gozados: "24" })], salarios);
    expect(r.dias_a_pagar).toBe(0);
    expect(r.custo).toBeNull();
  });

  it("traz o alerta de faltas junto", () => {
    const [r] = enriquecer([periodo()], salarios);
    expect(r.alerta_faltas).toMatchObject({ faltasRestantes: 4, diasDepois: 18 });
  });

  it("a situação é calculada contra hoje", () => {
    const [vencida] = enriquecer([periodo({ limite_gozo: "2026-08-01" })], salarios, new Date(2026, 7, 4));
    expect(vencida.situacao).toBe("vencida");
    const [ok] = enriquecer([periodo()], salarios, new Date(2026, 7, 4));
    expect(ok.situacao).toBe("ok");
  });
});

describe("normalizar nome", () => {
  it("ignora acento, caixa e espaço repetido", () => {
    expect(normalizar("José  da Silva")).toBe(normalizar("JOSE DA SILVA"));
  });
});
