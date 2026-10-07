/**
 * Um cadastro só: o que a proposta sabe do cliente vira o parcial de contrato que o
 * contrato e o onboarding usam. Nunca se inventa valor que a proposta não tem.
 */
import { describe, it, expect } from "vitest";
import { propostaParaDadosContrato, mesclarParcial } from "../../api/src/propostaParaDados.js";
import { escolherModelo, resolverItens } from "../../api/src/onboardingRegras.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const seed = require("../../api/src/seeds/onboarding-modelos.json");

const proposta = {
  cliente: { nome: "Padaria Bom Pão ME", cnpj: "12.345.678/0001-90", email: "dono@padaria.com", telefone: "11999990000", contato: "Maria", enquadramento: "simples", tipoEmpresa: "comercio", complexidade: "media", funcionarios: 4 },
  condicoes: { vencimentoDia: 10, formaPagamento: "Pix", funcionariosIncluidos: 3, valorFuncionarioExtra: 45, guiasAntecedenciaDias: 5 },
};

describe("propostaParaDadosContrato", () => {
  it("leva cliente, enquadramento, funcionários e honorário", () => {
    const d = propostaParaDadosContrato(proposta, 890);
    expect(d.contratante).toMatchObject({ razao: "Padaria Bom Pão ME", email: "dono@padaria.com", repNome: "Maria" });
    expect(d.objeto).toMatchObject({ enquadramento: "simples", modelo: "completo", tipoEmpresa: "comercio", funcionariosIncluidos: 3 });
    expect(d.honorarios).toMatchObject({ valorMensal: 890, vencimentoDia: 10, valorFuncAdicional: 45, meioPagamento: "Pix" });
    expect(d.prazos).toEqual({ diasGuias: 5 });
  });
  it("MEI usa o modelo simplificado", () => {
    expect(propostaParaDadosContrato({ cliente: { enquadramento: "mei" } }, 0).objeto.modelo).toBe("mei");
  });
  it("não inventa: sem valor mensal, sem seção honorários; valor inválido é ignorado", () => {
    const d = propostaParaDadosContrato({ cliente: { nome: "X", enquadramento: "xyz", tipoEmpresa: "?" } }, 0);
    expect(d.honorarios).toBeUndefined();
    expect(d.objeto).toBeUndefined();
    expect(d.contratante).toEqual({ razao: "X" });
  });
  it("entrada vazia não quebra", () => {
    expect(propostaParaDadosContrato(null, null)).toEqual({});
  });
});

describe("mesclarParcial", () => {
  it("sobrescreve por campo, sem apagar o resto da seção", () => {
    const m = mesclarParcial({ contratante: { razao: "A", email: "a@a.com" } }, { contratante: { email: "b@b.com" }, objeto: { enquadramento: "mei" } });
    expect(m).toEqual({ contratante: { razao: "A", email: "b@b.com" }, objeto: { enquadramento: "mei" } });
  });
});

describe("da proposta ao roteiro de onboarding", () => {
  it("proposta Simples escolhe o modelo Simples e gera documentos com data", () => {
    const dados = propostaParaDadosContrato(proposta, 890);
    const modelo = escolherModelo(dados, seed);
    expect(modelo.nome).toMatch(/Simples/);
    const itens = resolverItens(modelo, dados, "2026-10-07");
    expect(itens.filter((i: any) => i.tipo === "documento").every((i: any) => i.prazoData)).toBe(true);
  });
});
