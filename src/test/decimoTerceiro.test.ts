/**
 * Projeção do 13º. Erro aqui vira dinheiro errado numa decisão de caixa — o cliente se
 * programa por este número em outubro e paga em dezembro.
 */
import { describe, it, expect } from "vitest";
import { avosNoAno, inssEmpregado, projetarFuncionario, projetar } from "../../api/src/decimoTerceiro.js";

describe("avos — a regra dos 15 dias", () => {
  it("quem já estava na empresa tem os 12 avos", () => {
    expect(avosNoAno("2019-05-10", 2026)).toBe(12);
    expect(avosNoAno("2026-01-01", 2026)).toBe(12);
  });

  it("admitido com 15 dias ou mais no mês ganha o avo daquele mês", () => {
    // Março tem 31 dias: admitido dia 17 trabalha 15 dias -> conta março (10 avos).
    expect(avosNoAno("2026-03-17", 2026)).toBe(10);
  });

  it("admitido com menos de 15 dias perde o avo do mês", () => {
    // Dia 18 de março: 14 dias -> começa a contar em abril (9 avos).
    expect(avosNoAno("2026-03-18", 2026)).toBe(9);
  });

  it("fevereiro (28 dias) desloca o corte", () => {
    // Dia 14: 15 dias -> conta fevereiro (11 avos). Dia 15: 14 dias -> 10 avos.
    expect(avosNoAno("2026-02-14", 2026)).toBe(11);
    expect(avosNoAno("2026-02-15", 2026)).toBe(10);
  });

  it("admitido em dezembro com poucos dias fica sem nada", () => {
    expect(avosNoAno("2026-12-20", 2026)).toBe(0);
  });

  it("admissão futura não gera avo", () => {
    expect(avosNoAno("2027-01-05", 2026)).toBe(0);
  });

  it("sem data assume ano inteiro — subestimar caixa é o erro caro", () => {
    expect(avosNoAno(null, 2026)).toBe(12);
    expect(avosNoAno("", 2026)).toBe(12);
  });
});

describe("INSS do empregado — tabela progressiva", () => {
  it("cada faixa incide só sobre a parte dela", () => {
    // 1.518,00 * 7,5% = 113,85
    expect(inssEmpregado(1518)).toBeCloseTo(113.85, 2);
  });

  it("salário no meio da segunda faixa soma as duas partes", () => {
    // 113,85 + (2.000 - 1.518) * 9% = 113,85 + 43,38 = 157,23
    expect(inssEmpregado(2000)).toBeCloseTo(157.23, 2);
  });

  it("não é alíquota única sobre o total (erro clássico)", () => {
    expect(inssEmpregado(2000)).not.toBeCloseTo(2000 * 0.09, 2);
  });

  it("zero e negativo não quebram", () => {
    expect(inssEmpregado(0)).toBe(0);
    expect(inssEmpregado(null as unknown as number)).toBe(0);
  });
});

describe("projeção por funcionário", () => {
  it("ano inteiro: bruto é o salário, metade na 1ª parcela", () => {
    const r = projetarFuncionario({ nome: "MARIA", salario: 3000, admissao: "2020-01-10", ano: 2026 });
    expect(r.avos).toBe(12);
    expect(r.bruto).toBe(3000);
    expect(r.primeira_parcela).toBe(1500);
    // A 2ª desconta o INSS: por isso é menor que a 1ª — e isso é o esperado.
    expect(r.segunda_parcela).toBeLessThan(r.primeira_parcela!);
    expect(r.fgts).toBe(240); // 8%
  });

  it("proporcional aos avos", () => {
    const r = projetarFuncionario({ nome: "JOÃO", salario: 2400, admissao: "2026-07-01", ano: 2026 });
    expect(r.avos).toBe(6);
    expect(r.bruto).toBe(1200);
  });

  it("sem salário devolve null, nunca zero", () => {
    const r = projetarFuncionario({ nome: "SEM SALÁRIO", salario: null, admissao: null, ano: 2026 });
    expect(r.bruto).toBeNull();
    expect(r.sem_salario).toBe(true);
  });
});

describe("projeção da empresa", () => {
  const funcionarios = [
    { nome: "A", salario_base: 3000, admissao: "2020-01-10" },
    { nome: "B", salario_base: 2400, admissao: "2026-07-01" },
    { nome: "C", salario_base: null, admissao: "2021-03-03" },
  ];

  it("soma só quem tem salário e conta quem ficou de fora", () => {
    const r = projetar({ funcionarios, ano: 2026 });
    expect(r.funcionarios).toBe(3);
    expect(r.sem_salario).toBe(1);
    expect(r.bruto).toBe(4200); // 3000 + 1200
    expect(r.fgts).toBe(336); // 8% de 4200
  });

  it("custo total = bruto + FGTS (sem INSS patronal, que depende do regime)", () => {
    const r = projetar({ funcionarios, ano: 2026 });
    expect(r.custo_total).toBe(Number((r.bruto + r.fgts).toFixed(2)));
  });

  it("as duas parcelas mais o INSS fecham o bruto", () => {
    const r = projetar({ funcionarios, ano: 2026 });
    const soma = r.primeira_parcela + r.segunda_parcela + r.inss_empregado;
    expect(soma).toBeCloseTo(r.bruto, 1);
  });

  it("empresa sem ninguém não explode", () => {
    const r = projetar({ funcionarios: [], ano: 2026 });
    expect(r.bruto).toBe(0);
    expect(r.funcionarios).toBe(0);
  });
});
