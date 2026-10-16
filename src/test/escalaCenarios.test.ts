/**
 * Cenários de escala e a trava de regras: os cenários variam quem folga e quando, mas
 * todos passam pelo mesmo motor; o que tem erro não pode ser aplicado.
 */
import { describe, it, expect } from "vitest";
import { avaliarEscalaAtual, simularCenarios } from "@/lib/escala/cenarios";
import { diaDaSemana } from "@/lib/escala/datas";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";
import {
  ajustesEmLote,
  aplicarLote,
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

describe("casa fechada e horário personalizado", () => {
  const mes = "2027-03";
  const f = feriados(2027);
  const restaurante = empresa("restaurante");

  it("segunda a sábado: ninguém trabalha no domingo e cada dia fica com 5 de 6", () => {
    const c = simularCenarios(PESSOAS, mes, restaurante, f).find((x) => x.id === "seg_sab")!;
    expect(c.podeAplicar).toBe(true);
    expect(c.mediaPorDia[0]).toBe(0);
    // Sexta 26/03 é Sexta-feira Santa (folga de todos), então sexta fica abaixo de 5.
    expect(c.mediaPorDia.slice(1, 5)).toEqual([5, 5, 5, 5]);
  });

  it("fecha na segunda: ninguém trabalha na segunda e o domingo respeita o mínimo do segmento", () => {
    for (const seg of ["restaurante", "comercio"] as Segmento[]) {
      for (const m of ["2027-01", "2027-03", "2027-06", "2028-02"]) {
        const c = simularCenarios(PESSOAS, m, empresa(seg), feriados(Number(m.slice(0, 4)))).find((x) => x.id === "fecha_seg")!;
        expect({ seg, m, erros: c.erros, motivos: c.motivos }).toEqual({ seg, m, erros: 0, motivos: [] });
        expect(c.mediaPorDia[1]).toBe(0);
      }
    }
  });

  it("cenário que escala gente no dia fechado sai da lista", () => {
    const r = simularCenarios(PESSOAS, mes, { ...restaurante, diasFechados: [0] }, f);
    expect(r.find((x) => x.id === "seg_sab")!.podeAplicar).toBe(true);
    const rod = r.find((x) => x.id === "5x2_rev2")!;
    expect(rod.podeAplicar).toBe(false);
    expect(rod.motivos[0]).toMatch(/domingo, dia em que a casa fecha/);
  });

  it("horário personalizado que passa do limite fica vermelho e não aplica", () => {
    const longo = { entrada: "08:00", saida: "19:00", intervaloMin: 60 }; // 10h x 5 = 50h
    const c = simularCenarios(PESSOAS, mes, restaurante, f, 0, { seg_sab: longo }).find((x) => x.id === "seg_sab")!;
    expect(c.personalizado).toBe(true);
    expect(c.podeAplicar).toBe(false);
    expect(c.semanaAcima).toBe("erro");
    expect(c.maiorSemana).toBeGreaterThan(c.limiteSemana);
  });

  it("horário personalizado dentro do limite aplica (restaurante 11h às 19h)", () => {
    const t = { entrada: "11:00", saida: "19:00", intervaloMin: 30 }; // 7h30 com acordo
    const c = simularCenarios(PESSOAS, mes, empresa("restaurante", true), f, 0, { fecha_seg: t }).find((x) => x.id === "fecha_seg")!;
    expect(c.podeAplicar).toBe(true);
    expect(c.configs.every((p) => p.entrada === "11:00" && p.saida === "19:00")).toBe(true);
  });

  it("a escala de hoje em 12x36 é medida para comparar com os cenários", () => {
    const configs = PESSOAS.map((p, i) => ({ ...configPadrao(p.id, p.nome, "12x36"), turma: i % 2 ? ("B" as const) : ("A" as const) }));
    const atual = avaliarEscalaAtual(configs, {}, mes, restaurante, f);
    expect(atual.erros).toBe(0);
    expect(atual.mediaPorDia.every((n) => n === 3)).toBe(true);
    expect(atual.descricao).toMatch(/12x36/);
  });
});

describe("edição em lote", () => {
  const f = feriados(2027);
  const cfg = empresa("comercio");
  const t = { entrada: "09:00", saida: "17:00", intervaloMin: 60 };

  it("aplica folga, horário e volta ao modelo em vários dias", () => {
    let aj = ajustesEmLote({}, ["2027-03-01", "2027-03-02"], { tipo: "horario", turno: t });
    expect(aj).toEqual({ "2027-03-01": t, "2027-03-02": t });
    aj = ajustesEmLote(aj, ["2027-03-02"], { tipo: "folga" });
    expect(aj["2027-03-02"]).toBeNull();
    expect(ajustesEmLote(aj, ["2027-03-01", "2027-03-02"], { tipo: "modelo" })).toEqual({});
  });

  it("muda o horário de várias pessoas de uma vez", () => {
    const configs = PESSOAS.slice(0, 3).map((p) => configPadrao(p.id, p.nome, "5x2"));
    const datas = ["2027-03-01", "2027-03-02", "2027-03-03"];
    const r = aplicarLote(configs, {}, ["0", "1", "2"], (c, aj) => ({ config: c, ajustes: ajustesEmLote(aj, datas, { tipo: "horario", turno: t }) }), "2027-03", cfg, f);
    expect(r.aceitos).toEqual(["0", "1", "2"]);
    expect(r.recusados).toEqual([]);
    expect(Object.keys(r.ajustes)).toHaveLength(3);
  });

  it("recusa só quem ficaria fora da regra e aplica nos outros", () => {
    // P0 folga sáb+dom, P1 folga dom+seg. Trabalhar no sábado 06/03 tira a 2ª folga só da P0.
    const configs = [
      { ...configPadrao("0", "P0", "5x2"), folgas5x2: [6, 0] },
      { ...configPadrao("1", "P1", "5x2"), folgas5x2: [0, 1] },
    ];
    const r = aplicarLote(configs, {}, ["0", "1"], (c, aj) => ({ config: c, ajustes: ajustesEmLote(aj, ["2027-03-06"], { tipo: "horario", turno: t }) }), "2027-03", cfg, f);
    expect(r.aceitos).toEqual(["1"]);
    expect(r.recusados.map((x) => x.nome)).toEqual(["P0"]);
    expect(r.recusados[0].motivo).toMatch(/semana|folga/);
    expect(r.ajustes["0"]).toBeUndefined();
  });

  it("troca o modelo de várias pessoas", () => {
    const configs = PESSOAS.slice(0, 2).map((p) => configPadrao(p.id, p.nome, "12x36"));
    const r = aplicarLote(configs, {}, ["0", "1"], (c) => ({ config: { ...c, ...configPadrao(c.id, c.nome, "5x2") }, ajustes: {} }), "2027-03", cfg, f);
    expect(r.configs.every((c) => c.modelo === "5x2")).toBe(true);
  });
});
