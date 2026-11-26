/**
 * 5x2 com folga corrida (pedido do restaurante): as 2 folgas juntas andam um dia por semana,
 * sempre dentro da semana de domingo a sábado, num ciclo de 7 semanas.
 */
import { describe, it, expect } from "vitest";
import { simularCenarios, turnoQuePreenche } from "@/lib/escala/cenarios";
import { diaDaSemana } from "@/lib/escala/datas";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";
import {
  avaliarPessoa,
  configPadrao,
  diasDoMes,
  folgasDaCorrida,
  fraseDaPessoa,
  normalizarConfigEmpresa,
  type ConfigEmpresa,
} from "@/lib/escala/planejamento";

// Restaurante e comércio exigem domingo a cada 3 semanas, o que a folga corrida não cumpre;
// ela é testada numa atividade com a régua geral de 7 semanas.
const restaurante = (temAcordoColetivo = false): ConfigEmpresa => ({
  ...normalizarConfigEmpresa(null),
  segmento: "outro",
  temAcordoColetivo,
});
const semFeriado = new Set<string>();

describe("5x2 folga corrida", () => {
  it("a dupla de folgas anda um dia por semana e continua de um mês para o outro", () => {
    const c = { ...configPadrao("1", "Ana", "5x2_corrida"), rodizio: 0 };
    const folgasPorSemana = new Map<string, number[]>();
    for (const mes of ["2027-01", "2027-02", "2027-03"]) {
      for (const d of avaliarPessoa(c, mes, {}, restaurante(), semFeriado).dias) {
        if (d.turno) continue;
        const dom = new Date(`${d.data}T12:00:00Z`);
        dom.setUTCDate(dom.getUTCDate() - diaDaSemana(d.data));
        const k = dom.toISOString().slice(0, 10);
        folgasPorSemana.set(k, [...(folgasPorSemana.get(k) || []), diaDaSemana(d.data)]);
      }
    }
    const semanas = [...folgasPorSemana.entries()].filter(([k]) => k >= "2027-01-03" && k <= "2027-03-21").map(([, v]) => v);
    expect(semanas.every((f) => f.length === 2)).toBe(true);
    // Cada semana é a seguinte do ciclo.
    const indice = (f: number[]) => [0, 1, 2, 3, 4, 5, 6].find((g) => folgasDaCorrida(g).join() === [...f].sort().join())!;
    const seq = semanas.map(indice);
    seq.slice(1).forEach((g, i) => expect(g).toBe((seq[i] + 1) % 7));
  });

  it("8h por dia: 40h, 2 folgas por semana e nenhum alerta na régua de 7 semanas", () => {
    for (let r = 0; r < 7; r++) {
      const c = { ...configPadrao("1", "Ana", "5x2_corrida"), rodizio: r };
      for (const mes of ["2027-01", "2027-02", "2027-03", "2028-01"]) {
        const a = avaliarPessoa(c, mes, {}, restaurante(), semFeriado);
        expect(a.ocorrencias).toEqual([]);
        expect(a.maiorSemana).toBe(40);
      }
    }
  });

  it("cenário pronto aplica sem erro e espalha a equipe pelos 7 pontos do ciclo", () => {
    const pessoas = Array.from({ length: 18 }, (_, i) => ({ id: String(i), nome: `P${i}` }));
    const feriados = new Set(feriadosDaEmpresa([2026, 2027], [], false).keys());
    const r = simularCenarios(pessoas, "2027-01", restaurante(), feriados).find((x) => x.id === "5x2_corrida")!;
    expect(r.podeAplicar).toBe(true);
    expect(new Set(r.configs.map((c) => c.rodizio)).size).toBe(7);
    expect(Math.min(...r.mediaPorDia)).toBeGreaterThanOrEqual(10);
  });

  it("42h sem acordo: 8h24 vira hora extra (aviso), sem erro de limite na etapa 1", () => {
    const base = configPadrao("1", "Ana", "5x2_corrida");
    const t = turnoQuePreenche({ entrada: base.entrada, saida: base.saida, intervaloMin: base.intervaloMin }, "5x2_corrida", 42)!;
    expect(t.saida).toBe("17:24");
    const c = { ...base, saida: t.saida };
    const a = avaliarPessoa(c, "2027-02", {}, restaurante(false), semFeriado);
    expect(a.maiorSemana).toBe(42);
    expect(a.ocorrencias.filter((o) => o.gravidade === "erro")).toEqual([]);
    expect(a.ocorrencias.some((o) => o.regra === "HORA_EXTRA")).toBe(true);
    // Na etapa 2 (40h) o mesmo horário passa do limite.
    const depois = avaliarPessoa(c, "2028-02", {}, restaurante(false), semFeriado);
    expect(depois.ocorrencias.some((o) => o.regra === "LIMITE_SEMANAL" && o.gravidade === "erro")).toBe(true);
  });

  it("dezembro de 2026: 6x1 até 13/12, folga corrida a partir de 14/12", () => {
    const c = { ...configPadrao("1", "Ana", "5x2_corrida"), folga6x1: 0 };
    const a = avaliarPessoa(c, "2026-12", {}, restaurante(), semFeriado);
    expect(a.ocorrencias.filter((o) => o.gravidade === "erro")).toEqual([]);
    expect(diasDoMes("2026-12").length).toBe(31);
    expect(fraseDaPessoa(c)).toContain("andam um dia por semana");
  });
});

describe("5x2 folga corrida no comércio e no restaurante", () => {
  it.each(["comercio", "restaurante"] as const)("fica indisponível em %s: o domingo de folga não volta a cada 3 semanas", (segmento) => {
    const pessoas = Array.from({ length: 6 }, (_, i) => ({ id: String(i), nome: `P${i}` }));
    const empresa = { ...normalizarConfigEmpresa(null), segmento, temAcordoColetivo: false };
    const r = simularCenarios(pessoas, "2027-01", empresa, semFeriado).find((x) => x.id === "5x2_corrida")!;
    expect(r.podeAplicar).toBe(false);
    expect(r.motivos[0]).toContain("domingo");
  });
});

describe("unidade da pessoa (lojas com o mesmo CNPJ)", () => {
  it("fica salva no plano, é limpa e lista as unidades da equipe", async () => {
    const { mesclarPlano, unidadesDa, nomeDeUnidade } = await import("@/lib/escala/planejamento");
    const a = { ...configPadrao("1", "Ana", "5x2_corrida"), unidade: "  Terra   Preta " };
    const b = { ...configPadrao("2", "Bia", "5x2_corrida"), unidade: "Mairiporã" };
    const vaga = { ...configPadrao("vaga-1", "Maria", "5x2_corrida"), unidade: "Terra Preta" };
    const plano = mesclarPlano({ configs: [a, b, vaga], ajustes: {} }, [{ id: "1", name: "Ana" }, { id: "2", name: "Bia" }, { id: "3", name: "Caio" }], "5x2");
    expect(plano.configs.map((c) => c.unidade)).toEqual(["Terra Preta", "Mairiporã", undefined, "Terra Preta"]);
    expect(unidadesDa(plano.configs)).toEqual(["Mairiporã", "Terra Preta"]);
    expect(nomeDeUnidade("   ")).toBeUndefined();
  });
});

describe("empresa escolhe se abre nos feriados", () => {
  it("fechada: feriado nasce de folga; aberta: segue o modelo e avisa do pagamento", () => {
    const fer = new Set(["2027-01-01"]);
    // Grupo 0 começa seg+ter na semana de 03/01; na semana de 27/12 (grupo anterior) a sexta 01/01 é dia de trabalho.
    const c = { ...configPadrao("1", "Ana", "5x2_corrida"), rodizio: 0 };
    const fechada = avaliarPessoa(c, "2027-01", {}, restaurante(), fer);
    expect(fechada.dias.find((d) => d.data === "2027-01-01")?.turno).toBeNull();
    const aberta = avaliarPessoa(c, "2027-01", {}, { ...restaurante(), abreNosFeriados: true }, fer);
    expect(aberta.dias.find((d) => d.data === "2027-01-01")?.turno).not.toBeNull();
    expect(aberta.ocorrencias.some((o) => o.regra === "FERIADO")).toBe(true);
    expect(aberta.ocorrencias.filter((o) => o.gravidade === "erro")).toEqual([]);
    expect(normalizarConfigEmpresa({ abreNosFeriados: true }).abreNosFeriados).toBe(true);
    expect(normalizarConfigEmpresa(null).abreNosFeriados).toBe(false);
  });
});
