/**
 * Cenários de escala e a trava de regras: os cenários variam quem folga e quando, mas
 * todos passam pelo mesmo motor; o que tem erro não pode ser aplicado.
 */
import { describe, it, expect } from "vitest";
import { simularCenarios } from "@/lib/escala/cenarios";
import { diaDaSemana } from "@/lib/escala/datas";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";
import {
  avaliarPessoa,
  configPadrao,
  definirCelula,
  diasParaValidar,
  errosNovos,
  mesclarPlano,
  modeloPadraoDoMes,
  normalizarConfigEmpresa,
  semanasDoRodizio,
  type ConfigEmpresa,
  type ConfigPessoa,
} from "@/lib/escala/planejamento";
import type { Segmento } from "@/lib/escala/regras";

const PESSOAS = Array.from({ length: 6 }, (_, i) => ({ id: String(i), nome: `P${i}` }));
const empresa = (segmento: Segmento, temAcordoColetivo = false): ConfigEmpresa => ({
  ...normalizarConfigEmpresa(null),
  segmento,
  temAcordoColetivo,
});
const feriados = (ano: number) => new Set(feriadosDaEmpresa([ano - 1, ano], [], false).keys());

describe("modelo padrão do mês", () => {
  it("6x1 até a emenda, 5x2 depois, 12x36 se a empresa usa", () => {
    expect(modeloPadraoDoMes("2026-11")).toBe("6x1");
    expect(modeloPadraoDoMes("2026-12")).toBe("5x2");
    expect(modeloPadraoDoMes("2027-01")).toBe("5x2");
    expect(modeloPadraoDoMes("2027-01", true)).toBe("12x36");
  });
});

describe("rodízio de folgas", () => {
  it("semanas vizinhas dividem uma folga e a 1ª tem o domingo", () => {
    expect(semanasDoRodizio(1, 2)).toEqual([[0, 1], [1, 4]]);
    expect(semanasDoRodizio(3, 3)).toEqual([[0, 3], [3, 6], [6, 3]]);
  });

  it("dá 2 folgas por semana e o domingo volta a cada 2 semanas", () => {
    const c: ConfigPessoa = { ...configPadrao("p", "Ana", "5x2_rev"), folgaFixa: 5 };
    const dias = diasParaValidar(c, "2027-03", {});
    const semanas = new Map<number, number>();
    dias.forEach((d, i) => !d.turno && semanas.set(Math.floor(i / 7), (semanas.get(Math.floor(i / 7)) || 0) + 1));
    expect([...semanas.values()].every((n) => n === 2)).toBe(true);
    const domingos = dias.filter((d) => diaDaSemana(d.data) === 0).map((d) => d.turno === null);
    expect(domingos.slice(0, 4)).toEqual([domingos[0], !domingos[0], domingos[0], !domingos[0]]);
  });
});

describe("feriado nasce de folga", () => {
  it("no 5x2, 25/12 vira folga; ajuste à mão vence", () => {
    const f = feriados(2026);
    const c = configPadrao("p", "Ana", "5x2");
    expect(diasParaValidar(c, "2026-12", {}, f).find((d) => d.data === "2026-12-25")!.turno).toBeNull();
    const t = { entrada: "08:00", saida: "17:00", intervaloMin: 60 };
    const aj = definirCelula({}, "p", "2026-12-25", t);
    expect(diasParaValidar(c, "2026-12", aj, f).find((d) => d.data === "2026-12-25")!.turno).toEqual(t);
  });

  it("na 12x36 o plantão do feriado continua", () => {
    const c = configPadrao("p", "Ana", "12x36"); // turma A: trabalha nos dias ímpares de dez/2026
    expect(diasParaValidar(c, "2026-12", {}, feriados(2026)).find((d) => d.data === "2026-12-25")!.turno).not.toBeNull();
  });
});

describe("cenários do mês", () => {
  const segmentos: Segmento[] = ["comercio", "restaurante", "construcao_civil", "outro"];

  for (const mes of ["2026-11", "2027-01", "2027-03", "2028-02"]) {
    for (const seg of segmentos) {
      it(`${mes}, ${seg}: todo cenário disponível passa sem erro`, () => {
        const r = simularCenarios(PESSOAS, mes, empresa(seg, true), feriados(Number(mes.slice(0, 4))));
        for (const c of r.filter((x) => !x.indisponivel)) {
          expect({ id: c.id, motivos: c.motivos, erros: c.erros }).toEqual({ id: c.id, motivos: [], erros: 0 });
        }
      });
    }
  }

  it("a 6x1 sai da lista depois de 16/12/2026, e a 4x3 pede acordo", () => {
    const r = simularCenarios(PESSOAS, "2027-01", empresa("comercio"), feriados(2027));
    const seis = r.find((c) => c.id === "6x1")!;
    expect(seis.podeAplicar).toBe(false);
    expect(seis.motivos[0]).toMatch(/duas folgas/);
    expect(r.find((c) => c.id === "4x3")!.podeAplicar).toBe(false);
    expect(r.find((c) => c.id === "5x2_rev3")!.podeAplicar).toBe(true);
    // Antes da emenda a 6x1 ainda pode.
    expect(simularCenarios(PESSOAS, "2026-11", empresa("comercio"), feriados(2026)).find((c) => c.id === "6x1")!.podeAplicar).toBe(true);
  });

  it("o rodízio cobre o domingo, o 5x2 de fim de semana não", () => {
    const r = simularCenarios(PESSOAS, "2027-03", empresa("comercio"), feriados(2027));
    expect(r.find((c) => c.id === "5x2_fds")!.mediaPorDia[0]).toBe(0);
    expect(r.find((c) => c.id === "5x2_rev2")!.mediaPorDia[0]).toBe(3);
    expect(r.find((c) => c.id === "5x2_rev3")!.mediaPorDia[0]).toBeGreaterThan(3);
  });

  it("outra variação muda as folgas sem quebrar regra", () => {
    const a = simularCenarios(PESSOAS, "2027-03", empresa("comercio"), feriados(2027), 0).find((c) => c.id === "5x2_rev2")!;
    const b = simularCenarios(PESSOAS, "2027-03", empresa("comercio"), feriados(2027), 1).find((c) => c.id === "5x2_rev2")!;
    expect(a.configs.map((c) => c.folgaFixa)).not.toEqual(b.configs.map((c) => c.folgaFixa));
    expect(b.erros).toBe(0);
  });

  it("bloqueio sem hora extra barra o 4x3 de 10h", () => {
    const cfg = { ...empresa("outro", true), bloqueio: "sem_hora_extra" as const };
    const r = simularCenarios(PESSOAS, "2027-03", cfg, feriados(2027)).find((c) => c.id === "4x3")!;
    expect(r.podeAplicar).toBe(false);
  });
});

describe("trava de regras", () => {
  const cfg = empresa("comercio");
  const f = feriados(2027);
  const c = configPadrao("p", "Ana", "5x2");

  it("tirar uma folga cria erro novo (duas folgas por semana)", () => {
    const antes = avaliarPessoa(c, "2027-03", {}, cfg, f).ocorrencias;
    const depois = avaliarPessoa(c, "2027-03", definirCelula({}, "p", "2027-03-06", c && { entrada: "08:00", saida: "17:00", intervaloMin: 60 }), cfg, f).ocorrencias;
    expect(errosNovos(antes, depois).map((o) => o.regra)).toContain("REPOUSO_SEMANAL");
  });

  it("mover a folga dentro da semana não cria erro", () => {
    const t = { entrada: "08:00", saida: "17:00", intervaloMin: 60 };
    let aj = definirCelula({}, "p", "2027-03-06", t); // sábado passa a trabalhar
    aj = definirCelula(aj, "p", "2027-03-03", null); // folga vai para a quarta
    const antes = avaliarPessoa(c, "2027-03", {}, cfg, f).ocorrencias;
    expect(errosNovos(antes, avaliarPessoa(c, "2027-03", aj, cfg, f).ocorrencias)).toEqual([]);
  });
});

describe("planos salvos antes do rodízio", () => {
  it("ganham os campos novos com valor padrão", () => {
    const velho = { ...configPadrao("a", "Ana", "5x2") } as Partial<ConfigPessoa>;
    delete velho.folgaFixa;
    delete velho.rodizio;
    delete velho.semanasRodizio;
    const p = mesclarPlano({ configs: [velho as ConfigPessoa], ajustes: {} }, [{ id: "a", name: "Ana" }], "5x2");
    expect(p.configs[0]).toMatchObject({ folgaFixa: 1, rodizio: 0, semanasRodizio: 2, modelo: "5x2" });
  });

  it("a atividade começa em aberto e fica marcada ao salvar", () => {
    expect(normalizarConfigEmpresa(null).atividadeDefinida).toBe(false);
    expect(normalizarConfigEmpresa({ atividadeDefinida: true, usa12x36: true })).toMatchObject({ atividadeDefinida: true, usa12x36: true });
  });
});
