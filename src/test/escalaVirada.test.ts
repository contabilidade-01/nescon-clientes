/**
 * Datas da emenda na simulação: abre na próxima etapa, e em dezembro/2026 a 6x1
 * vale até o domingo 13/12 e o modelo novo começa na semana do dia 16.
 */
import { describe, it, expect } from "vitest";
import { simularCenarios } from "@/lib/escala/cenarios";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";
import { avaliarPessoa, configPadrao, diasParaValidar, normalizarConfigEmpresa, normalizarConfigPessoa } from "@/lib/escala/planejamento";
import { mesInicialDaSimulacao, viradaNoMes } from "@/lib/escala/regras";

const feriados = new Set(feriadosDaEmpresa([2025, 2026, 2027], [], false).keys());
const empresa = { ...normalizarConfigEmpresa(null), segmento: "comercio" as const };
const turnoEm = (dias: ReturnType<typeof diasParaValidar>, data: string) => dias.find((d) => d.data === data)!.turno;

describe("datas de implementação da emenda", () => {
  it("a simulação abre no mês da próxima etapa", () => {
    expect(mesInicialDaSimulacao("2026-10-17")).toBe("2026-12");
    expect(mesInicialDaSimulacao("2026-12-15")).toBe("2026-12");
    expect(mesInicialDaSimulacao("2026-12-16")).toBe("2027-12");
    expect(mesInicialDaSimulacao("2028-03-02")).toBe("2028-03");
  });

  it("acha a virada no meio do mês", () => {
    expect(viradaNoMes("2026-12")?.inicio).toBe("2026-12-16");
    expect(viradaNoMes("2027-12")?.limiteSemanalHoras).toBe(40);
    expect(viradaNoMes("2027-01")).toBeNull();
  });

  it("em dez/2026 segue a 6x1 até o domingo 13/12 e o 5x2 a partir de 14/12, sem erro", () => {
    const c = configPadrao("p", "Ana", "5x2");
    const dias = diasParaValidar(c, "2026-12", {}, feriados);
    expect(turnoEm(dias, "2026-12-05")).toEqual({ entrada: "08:00", saida: "16:20", intervaloMin: 60 }); // sábado na 6x1
    expect(turnoEm(dias, "2026-12-19")).toBeNull(); // sábado no 5x2
    expect(turnoEm(dias, "2026-12-12")).toEqual({ entrada: "08:00", saida: "16:20", intervaloMin: 60 });
    expect(turnoEm(dias, "2026-12-13")).toBeNull(); // domingo, folga da 6x1
    expect(turnoEm(dias, "2026-12-14")).toEqual({ entrada: "08:00", saida: "17:00", intervaloMin: 60 }); // 5x2 já na semana do dia 16
    const erros = avaliarPessoa(c, "2026-12", {}, empresa, feriados).ocorrencias.filter((o) => o.gravidade === "erro");
    expect(erros).toEqual([]);
  });

  it("desligando, o modelo novo vale o mês todo; fora de dez/2026 nada muda", () => {
    const c = { ...configPadrao("p", "Ana", "5x2"), seisPorUmAteVirada: false };
    expect(turnoEm(diasParaValidar(c, "2026-12", {}, feriados), "2026-12-05")).toBeNull();
    const nov = diasParaValidar(configPadrao("p", "Ana", "5x2"), "2026-11", {}, feriados);
    expect(turnoEm(nov, "2026-11-28")).toBeNull();
  });

  it("escala salva antes do campo existir segue na 6x1 até a virada", () => {
    const { seisPorUmAteVirada: _, ...antiga } = configPadrao("p", "Ana", "5x2");
    expect(normalizarConfigPessoa(antiga as never, "5x2").seisPorUmAteVirada).toBe(true);
  });

  it("os cenários de 2 folgas aplicam em dez/2026", () => {
    const pessoas = Array.from({ length: 6 }, (_, i) => ({ id: String(i), nome: `P${i}` }));
    const r = simularCenarios(pessoas, "2026-12", empresa, feriados);
    for (const id of ["seg_sab", "5x2_fds", "5x2_rev2", "5x2_rev3", "12x36"]) {
      expect([id, r.find((x) => x.id === id)!.motivos]).toEqual([id, []]);
    }
  });
});
