/**
 * Bloqueio de jornada, contingente, feriados da empresa e o que é salvo (config e mês).
 */
import { describe, it, expect } from "vitest";
import { motivoBloqueio, tetoDoDia } from "@/lib/escala/bloqueio";
import { compararCenarios, diasPorPessoa, pessoasNecessarias, type Demanda } from "@/lib/escala/contingente";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";
import { configPadrao, mesclarPlano, normalizarConfigEmpresa } from "@/lib/escala/planejamento";
import escalasRoute from "../../api/src/routes/escalas.js";

const { empresaDe, validarDados } = escalasRoute as unknown as {
  empresaDe: (req: unknown) => { companyId?: string; erro?: string; status?: number };
  validarDados: (d: unknown) => string | null;
};

describe("bloqueio de jornada diária", () => {
  const t = (entrada: string, saida: string, intervaloMin = 60) => ({ entrada, saida, intervaloMin });

  it("desligado nunca bloqueia", () => {
    expect(motivoBloqueio(t("06:00", "22:00"), "desligado", false)).toBeNull();
  });

  it("limite legal barra acima de 10h e deixa a hora extra até lá", () => {
    expect(motivoBloqueio(t("07:00", "18:00"), "limite_legal", false)).toBeNull(); // 10h
    expect(motivoBloqueio(t("07:00", "18:30"), "limite_legal", false)).toMatch(/10h30.*10h/);
  });

  it("sem hora extra barra qualquer minuto acima de 8h", () => {
    expect(motivoBloqueio(t("08:00", "17:00"), "sem_hora_extra", false)).toBeNull(); // 8h
    expect(motivoBloqueio(t("08:00", "17:15"), "sem_hora_extra", false)).not.toBeNull();
  });

  it("na 12x36 o teto é o plantão de 12h", () => {
    expect(tetoDoDia("sem_hora_extra", true)).toBe(720);
    expect(motivoBloqueio(t("07:00", "19:00", 0), "limite_legal", true)).toBeNull();
    expect(motivoBloqueio(t("07:00", "20:00", 0), "limite_legal", true)).not.toBeNull();
  });

  it("folga não bloqueia", () => {
    expect(motivoBloqueio(null, "sem_hora_extra", false)).toBeNull();
  });
});

describe("contingente", () => {
  // Loja que precisa de 4 pessoas de segunda a sábado e 2 no domingo: 26 dias-pessoa.
  const demanda: Demanda = [2, 4, 4, 4, 4, 4, 4];

  it("8h por dia: 5,5 dias hoje, 5 dias nas etapas", () => {
    expect(diasPorPessoa(44, 1, 8)).toBe(5.5);
    expect(diasPorPessoa(42, 2, 8)).toBe(5);
    expect(diasPorPessoa(40, 2, 8)).toBe(5);
  });

  it("quadro mínimo por fase", () => {
    const c = compararCenarios(demanda, 8, 2000);
    expect(c.map((x) => x.pessoas)).toEqual([5, 6, 6, 8]); // 26/5,5→5; 26/5→6; 26/3,5→8
    expect(c[0].custoMensal).toBeCloseTo(5 * 2000 * 1.08);
  });

  it("nunca menos que o pico de um dia", () => {
    expect(pessoasNecessarias([0, 0, 0, 0, 0, 0, 9], 5)).toBe(9);
  });

  it("sem salário, custo fica em branco", () => {
    expect(compararCenarios(demanda, 8, null)[0].custoMensal).toBeNull();
  });
});

describe("feriados da empresa", () => {
  it("junta nacionais, municipais anuais e de um ano só", () => {
    const f = feriadosDaEmpresa([2027], [
      { data: "01-20", nome: "São Sebastião" },
      { data: "2027-03-19", nome: "Só em 2027" },
      { data: "2026-03-19", nome: "Outro ano" },
    ]);
    expect(f.get("2027-11-15")).toBe("Proclamação da República");
    expect(f.get("2027-01-20")).toBe("São Sebastião");
    expect(f.get("2027-03-19")).toBe("Só em 2027");
    expect(f.has("2026-03-19")).toBe(false);
  });

  it("pontos facultativos só quando a empresa escolhe", () => {
    expect(feriadosDaEmpresa([2027]).has("2027-02-09")).toBe(false); // terça de Carnaval
    expect(feriadosDaEmpresa([2027], [], true).get("2027-02-09")).toBe("Carnaval (terça)");
  });
});

describe("o que é salvo", () => {
  it("config torta volta ao padrão sem quebrar", () => {
    const c = normalizarConfigEmpresa({ segmento: "x", bloqueio: "y", demanda: [1, 2], feriadosLocais: [{ data: "lixo" }, { data: "05-01", nome: 3 }] });
    expect(c.segmento).toBe("comercio");
    expect(c.bloqueio).toBe("limite_legal");
    expect(c.demanda).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(c.feriadosLocais).toEqual([{ data: "05-01", nome: "3" }]);
  });

  it("mês salvo se ajusta ao quadro: quem saiu some, quem entrou ganha o padrão, vaga fica", () => {
    const salvo = {
      configs: [{ ...configPadrao("a", "Ana", "5x2") }, configPadrao("saiu", "Saiu"), configPadrao("vaga-1", "Vaga simulada 1")],
      ajustes: { a: { "2027-01-04": null }, saiu: { "2027-01-04": null } },
    };
    const p = mesclarPlano(salvo, [{ id: "a", name: "Ana Souza" }, { id: "novo", name: "Novo" }], "6x1");
    expect(p.configs.map((c) => [c.id, c.modelo, c.nome])).toEqual([
      ["a", "5x2", "Ana Souza"],
      ["novo", "6x1", "Novo"],
      ["vaga-1", "6x1", "Vaga simulada 1"],
    ]);
    expect(Object.keys(p.ajustes)).toEqual(["a"]);
  });
});

describe("API de escalas: quem pode", () => {
  const UUID = "11111111-1111-4111-8111-111111111111";

  it("escritório precisa da área funcionarios e informar a empresa", () => {
    expect(empresaDe({ isAdmin: true, admin: { areas: {} }, query: { company_id: UUID } }).status).toBe(403);
    expect(empresaDe({ isAdmin: true, admin: { isOwner: true }, query: {} }).status).toBe(400);
    expect(empresaDe({ isAdmin: true, admin: { areas: { funcionarios: true } }, query: { company_id: UUID } })).toEqual({ companyId: UUID });
  });

  it("cliente só com a ferramenta liberada, e só a própria empresa", () => {
    const cliente = (escalas: boolean) => ({ isAdmin: false, company: { id: UUID }, companyToolAccess: { escalas }, query: { company_id: "outra" } });
    expect(empresaDe(cliente(false)).status).toBe(403);
    expect(empresaDe(cliente(true))).toEqual({ companyId: UUID });
  });

  it("recusa dados que não são objeto", () => {
    expect(validarDados([])).not.toBeNull();
    expect(validarDados(null)).not.toBeNull();
    expect(validarDados({ configs: [] })).toBeNull();
  });
});
