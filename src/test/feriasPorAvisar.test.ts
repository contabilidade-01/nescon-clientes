/**
 * feriasPorAvisar — identifica, por funcionário, a data limite de gozo e em que marco
 * (90/60/30/15) ela cai HOJE. A extração da data do PDF é coberta em vacationParser.test;
 * aqui o foco é o casamento marco × funcionário, com um `db` falso (sem Postgres).
 */
import { describe, it, expect } from "vitest";
import { feriasPorAvisar } from "../../api/src/alertas.js";
import { somarDias } from "../../api/src/diasBancarios.js";

const HOJE = "2026-08-14";
const marco = (n: number) => somarDias(HOJE, n);

/** db falso: devolve as linhas dadas e guarda os parâmetros da consulta. */
function fakeDb(rows: unknown[], capture: { params?: unknown[] } = {}) {
  return {
    query: async (_sql: string, params: unknown[]) => {
      capture.params = params;
      return { rows };
    },
  };
}

describe("feriasPorAvisar", () => {
  it("passa os 4 marcos (hoje + 90/60/30/15) para a consulta", async () => {
    const cap: { params?: unknown[] } = {};
    await feriasPorAvisar(fakeDb([], cap), { hoje: HOJE });
    expect(cap.params?.[0]).toEqual([marco(90), marco(60), marco(30), marco(15)]);
  });

  it("associa código, data limite e dias restantes a cada funcionário", async () => {
    const rows = [
      { company_id: "c1", codigo: "8", nome: "FLAVIA MORAES DE GOIS", dias_direito: 24, ferias_vencidas: 0, limite_gozo: marco(90) },
      { company_id: "c1", codigo: "30", nome: "ANA CLAUDIA", dias_direito: 30, ferias_vencidas: 0, limite_gozo: marco(30) },
    ];
    const r = await feriasPorAvisar(fakeDb(rows), { hoje: HOJE });
    expect(r).toEqual([
      {
        company_id: "c1",
        func_codigo: "8",
        nome: "FLAVIA MORAES DE GOIS",
        dias_direito: 24,
        ferias_vencidas: 0,
        limite_gozo: marco(90),
        dias_restantes: 90,
        codigo: "FERIAS_LIMITE",
      },
      {
        company_id: "c1",
        func_codigo: "30",
        nome: "ANA CLAUDIA",
        dias_direito: 30,
        ferias_vencidas: 0,
        limite_gozo: marco(30),
        dias_restantes: 30,
        codigo: "FERIAS_LIMITE",
      },
    ]);
  });

  it("o mesmo funcionário com dois períodos vira dois avisos (um por limite)", async () => {
    const rows = [
      { company_id: "c1", codigo: "8", nome: "FLAVIA", dias_direito: 24, ferias_vencidas: 0, limite_gozo: marco(60) },
      { company_id: "c1", codigo: "8", nome: "FLAVIA", dias_direito: 30, ferias_vencidas: 0, limite_gozo: marco(15) },
    ];
    const r = await feriasPorAvisar(fakeDb(rows), { hoje: HOJE });
    expect(r.map((f) => f.dias_restantes)).toEqual([60, 15]);
    expect(r.map((f) => f.limite_gozo)).toEqual([marco(60), marco(15)]);
  });
});
