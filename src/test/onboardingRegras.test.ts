/**
 * Regras do onboarding: que modelo serve a cada contrato e como o roteiro vira itens com
 * data. Um prazo contado da data errada faz o cliente novo ser cobrado antes de começar.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import {
  areasDoContrato,
  condicaoBate,
  escolherModelo,
  preencherTexto,
  somarDiasUteis,
  calcularPrazo,
  resolverItens,
  calcularStatus,
  itensAtrasados,
} from "../../api/src/onboardingRegras.js";

const require = createRequire(import.meta.url);
const seed = require("../../api/src/seeds/onboarding-modelos.json");

const simples = {
  objeto: { enquadramento: "simples", areaContabil: true, areaFiscal: true, areaPessoal: true, funcionariosIncluidos: 3 },
  prazos: { diaVariaveisFolha: 20, diaDocsFinanceiros: 5, diasGuias: "Guias até 3 dias antes do vencimento", horarioAtendimento: "8h às 18h", prazoRespostaDiasUteis: 1 },
  vigencia: { dataInicio: "2026-11-03" },
};

describe("áreas e condições", () => {
  it("sem nenhuma área marcada, considera todas (contrato antigo)", () => {
    expect(areasDoContrato({ objeto: {} })).toEqual(["contabil", "fiscal", "pessoal"]);
  });
  it("exige todas as áreas listadas", () => {
    const so = { objeto: { areaContabil: true } };
    expect(condicaoBate({ areas: ["contabil"] }, so)).toBe(true);
    expect(condicaoBate({ areas: ["contabil", "pessoal"] }, so)).toBe(false);
  });
  it("comFuncionarios só vale com área pessoal contratada", () => {
    const semArea = { objeto: { areaContabil: true, funcionariosIncluidos: 4 } };
    expect(condicaoBate({ comFuncionarios: true }, semArea)).toBe(false);
    expect(condicaoBate({ comFuncionarios: true }, simples)).toBe(true);
  });
});

describe("escolherModelo", () => {
  it("escolhe pelo enquadramento e cai no padrão geral quando nada específico bate", () => {
    expect(escolherModelo(simples, seed).nome).toMatch(/Simples/);
    expect(escolherModelo({ objeto: { enquadramento: "mei" } }, seed).nome).toBe("MEI");
    expect(escolherModelo({ objeto: { enquadramento: "outro" } }, seed).nome).toMatch(/geral/);
  });
  it("o mais específico vence; ignora inativo", () => {
    const m = [
      { nome: "geral", regras: {}, ordem: 0 },
      { nome: "simples+func", regras: { enquadramento: ["simples"], comFuncionarios: true }, ordem: 1 },
      { nome: "inativo", regras: { enquadramento: ["simples"], comFuncionarios: true }, ordem: 0, ativo: false },
    ];
    expect(escolherModelo(simples, m).nome).toBe("simples+func");
  });
  it("devolve null sem modelo aplicável", () => {
    expect(escolherModelo(simples, [])).toBeNull();
  });
});

describe("datas", () => {
  it("dias úteis pulam fim de semana e feriado", () => {
    // 2026-11-13 é sexta; +1 útil = segunda 16
    expect(somarDiasUteis("2026-11-13", 1)).toBe("2026-11-16");
    // 14/11 é sábado: 0 dias úteis anda para segunda
    expect(somarDiasUteis("2026-11-14", 0)).toBe("2026-11-16");
  });
  it("prazo 'inicio' conta da vigência; sem vigência, da assinatura", () => {
    const p = { ref: "inicio", dias: 7 };
    expect(calcularPrazo(p, { assinatura: "2026-10-07", inicio: "2026-11-03" })).toBe("2026-11-10");
    expect(calcularPrazo(p, { assinatura: "2026-10-07", inicio: null })).toBe("2026-10-14");
  });
  it("sem data-base devolve null, e dias fora do limite são contidos", () => {
    expect(calcularPrazo({ ref: "assinatura", dias: 3 }, { assinatura: null })).toBeNull();
    expect(calcularPrazo({ ref: "assinatura", dias: 99999 }, { assinatura: "2026-01-01" })).toBe("2027-01-01");
  });
});

describe("resolverItens", () => {
  it("filtra blocos por condição e preenche textos do contrato", () => {
    const modelo = seed.find((m: any) => /Simples/.test(m.nome));
    const itens = resolverItens(modelo, simples, "2026-10-07");
    const folha = itens.find((i: any) => i.titulo === "Variáveis da folha");
    expect(folha.regra).toBe("Todo mês, até o dia 20.");
    expect(itens.some((i: any) => /funcionários/.test(i.titulo))).toBe(true);

    const semFunc = { ...simples, objeto: { ...simples.objeto, areaPessoal: false, funcionariosIncluidos: 0 } };
    const itens2 = resolverItens(modelo, semFunc, "2026-10-07");
    expect(itens2.some((i: any) => /funcionários/.test(i.titulo))).toBe(false);
    expect(itens2.some((i: any) => i.titulo === "Variáveis da folha")).toBe(false);
  });
  it("documentos têm data; ids são únicos", () => {
    const modelo = seed.find((m: any) => /Simples/.test(m.nome));
    const itens = resolverItens(modelo, simples, "2026-10-07");
    const docs = itens.filter((i: any) => i.tipo === "documento");
    expect(docs.length).toBeGreaterThan(2);
    expect(docs.every((d: any) => /^\d{4}-\d{2}-\d{2}$/.test(d.prazoData))).toBe(true);
    expect(new Set(itens.map((i: any) => i.id)).size).toBe(itens.length);
  });
  it("ignora tipo de bloco desconhecido", () => {
    const itens = resolverItens({ blocos: [{ tipo: "x", titulo: "a" }, { tipo: "etapa", titulo: "b" }] }, simples, "2026-10-07");
    expect(itens.map((i: any) => i.titulo)).toEqual(["b"]);
  });
  it("campo ausente some do texto em vez de virar 'undefined'", () => {
    expect(preencherTexto("dia {{prazos.nada}}!", simples)).toBe("dia !");
  });
});

describe("status e atrasos", () => {
  const itens = [
    { id: "1-documento", tipo: "documento", obrigatorio: true, prazoData: "2026-10-10" },
    { id: "2-documento", tipo: "documento", obrigatorio: true, prazoData: "2026-10-20" },
    { id: "3-documento", tipo: "documento", obrigatorio: false, prazoData: "2026-10-01" },
  ];
  it("aguardando → em_andamento → em_analise → concluido", () => {
    expect(calcularStatus(itens, {})).toBe("aguardando");
    expect(calcularStatus(itens, { "1-documento": "enviado" })).toBe("em_andamento");
    expect(calcularStatus(itens, { "1-documento": "enviado", "2-documento": "enviado" })).toBe("em_analise");
    expect(calcularStatus(itens, { "1-documento": "aprovado", "2-documento": "aprovado" })).toBe("concluido");
  });
  it("reprovado volta para em_andamento", () => {
    expect(calcularStatus(itens, { "1-documento": "reprovado", "2-documento": "enviado" })).toBe("em_andamento");
  });
  it("atrasado = obrigatório vencido sem envio; opcional não conta", () => {
    const a = itensAtrasados(itens, { "2-documento": "enviado" }, "2026-10-15");
    expect(a.map((i: any) => i.id)).toEqual(["1-documento"]);
  });
});
