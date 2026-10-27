/**
 * Simulador de regime (Simples puro x híbrido x Lucro Presumido): tabelas do Simples,
 * transição da reforma e a régua de comparação. Casos conferidos à mão.
 */
import { describe, it, expect } from "vitest";
import { ANEXOS, aliquotaEfetiva, partilhaEfetiva } from "@/lib/regime/simples";
import { prazosAbertos, regrasDoAno } from "@/lib/regime/regras";
import { defaultToolAccess } from "@/lib/companyTools";
import { lerSalvo } from "@/lib/regime/salvo";
import { DEFAULT_TOOL_ACCESS } from "../../api/src/companyTools.js";
import { anexoDe, creditoDoSimples, dadosPadrao, pendencias, pontoDeVirada, recomendacao, simular, simularAno, type DadosRegime } from "@/lib/regime/simular";

const comercioVarejo = (): DadosRegime => ({
  ...dadosPadrao(),
  atividade: "comercio",
  receitaMensal: 30_000, // RBT12 360 mil: 2ª faixa do Anexo I
  vendas: { regular: 0, simples: 0, consumidor: 100, governo: 0, exportacao: 0 },
  comprasRegular: 12_000,
  icmsIssForaSimples: 6,
});

describe("tabelas do Simples", () => {
  it("a partilha de cada faixa soma 100%", () => {
    for (const anexo of Object.values(ANEXOS)) {
      for (const f of anexo.faixas) {
        const s = Object.values(f.partilha).reduce((a, b) => a + b, 0);
        expect(s).toBeCloseTo(100, 6);
      }
    }
  });

  it("alíquota efetiva segue (RBT12 × nominal − dedução) / RBT12", () => {
    expect(aliquotaEfetiva("I", 180_000)).toBeCloseTo(0.04, 6);
    expect(aliquotaEfetiva("I", 360_000)).toBeCloseTo((360_000 * 0.073 - 5_940) / 360_000, 6);
    expect(aliquotaEfetiva("III", 1_000_000)).toBeCloseTo((1_000_000 * 0.16 - 35_640) / 1_000_000, 6);
  });

  it("ISS dentro do DAS não passa de 5% e o excesso vai para os federais", () => {
    const rbt = 3_600_000;
    const pt = partilhaEfetiva("III", rbt);
    expect(aliquotaEfetiva("III", rbt) * pt.local).toBeCloseTo(0.05, 6);
    expect(Object.values(pt).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("fator R leva o Anexo V para o III a partir de 28%", () => {
    const base = { ...dadosPadrao(), atividade: "servico" as const, sujeitoFatorR: true, receitaMensal: 50_000 };
    expect(anexoDe({ ...base, folhaSalarios: 14_000 }).anexo).toBe("III");
    expect(anexoDe({ ...base, folhaSalarios: 13_000 }).anexo).toBe("V");
  });
});

describe("transição", () => {
  it("2027-2028 CBS menos 0,1 ponto e IBS 0,1%; 2029 ICMS/ISS a 90%; 2033 só IBS/CBS", () => {
    expect(regrasDoAno(2027)).toMatchObject({ cbs: 8.7, ibs: 0.1, icmsIssRestante: 1, ibsNoDas: 0 });
    expect(regrasDoAno(2029).icmsIssRestante).toBeCloseTo(0.9, 6);
    expect(regrasDoAno(2029).ibs).toBeCloseTo(1.77, 6);
    expect(regrasDoAno(2033)).toMatchObject({ cbs: 8.8, ibs: 17.7, icmsIssRestante: 0, ibsNoDas: 1 });
  });

  it("crédito que o Simples puro repassa cresce quando o ICMS do DAS vira IBS", () => {
    const rbt = 360_000;
    const ef = aliquotaEfetiva("I", rbt);
    expect(creditoDoSimples("I", rbt, 2027)).toBeCloseTo(ef * (0.1274 + 0.0276), 6);
    expect(creditoDoSimples("I", rbt, 2033)).toBeCloseTo(ef * (0.1274 + 0.0276 + 0.34), 6);
  });

  it("prazos: em 26/10/2026 a opção do 1º semestre de 2027 está aberta até 30/10", () => {
    const [primeiro] = prazosAbertos("2026-10-26");
    expect(primeiro).toMatchObject({ fim: "2026-10-30", aberto: true });
    expect(prazosAbertos("2026-11-01")[0].fim).toBe("2026-12-20");
  });
});

describe("comparação dos regimes", () => {
  it("Simples puro: sobra = receita − DAS", () => {
    const d = comercioVarejo();
    const r = simularAno(d, 2027).cenarios.puro;
    expect(r.das).toBeCloseTo(360_000 * aliquotaEfetiva("I", 360_000), 2);
    expect(r.sobra).toBeCloseTo(360_000 - r.das, 2);
    expect(r.creditoAoComprador).toBe(0);
  });

  it("varejo para consumidor final: o Simples puro ganha", () => {
    const anos = simular(comercioVarejo());
    for (const a of anos) expect(a.cenarios.puro.sobra).toBeGreaterThan(a.cenarios.hibrido.sobra);
    expect(recomendacao(comercioVarejo(), anos).melhor).toBe("puro");
  });

  it("vendendo só para empresas do regime regular, com compras com crédito, o híbrido ganha", () => {
    const d: DadosRegime = {
      ...comercioVarejo(),
      vendas: { regular: 100, simples: 0, consumidor: 0, governo: 0, exportacao: 0 },
      comprasRegular: 20_000,
    };
    const a = simularAno(d, 2027);
    expect(a.cenarios.hibrido.sobra).toBeGreaterThan(a.cenarios.puro.sobra);
    expect(a.cenarios.hibrido.creditoAoComprador).toBeGreaterThan(a.cenarios.puro.creditoAoComprador);
  });

  it("ponto de virada fica entre 0 e 100% e o híbrido compensa a partir dele", () => {
    const d = { ...comercioVarejo(), comprasRegular: 5_000 };
    const v = pontoDeVirada(d, 2033);
    expect(v).not.toBeNull();
    const com = (pct: number) => simularAno({ ...d, vendas: { regular: pct, simples: 0, consumidor: 100 - pct, governo: 0, exportacao: 0 } }, 2033).cenarios;
    expect(com(v!).hibrido.sobra).toBeGreaterThanOrEqual(com(v!).puro.sobra);
    if (v! > 0) expect(com(v! - 1).hibrido.sobra).toBeLessThan(com(v! - 1).puro.sobra);
  });

  it("Lucro Presumido soma IRPJ, CSLL, INSS sobre a folha e ICMS até 2032", () => {
    const d = { ...comercioVarejo(), folhaSalarios: 5_000 };
    const p27 = simularAno(d, 2027).cenarios.presumido;
    const p33 = simularAno(d, 2033).cenarios.presumido;
    expect(p27.inss).toBeCloseTo(5_000 * 12 * 0.278, 2);
    expect(p27.icmsIss).toBeGreaterThan(0);
    expect(p33.icmsIss).toBe(0);
    expect(p27.irpjCsll).toBeCloseTo(p27.receita * (0.08 * 0.15 + 0.12 * 0.09), 2);
  });

  it("pendências: sem faturamento e com fatias que não fecham, bloqueia", () => {
    const p = pendencias({ ...dadosPadrao(), vendas: { regular: 50, simples: 0, consumidor: 0, governo: 0, exportacao: 0 } });
    expect(p.filter((x) => x.bloqueia).map((x) => x.campo)).toEqual(["receitaMensal", "vendas"]);
  });
});

describe("liberação e salvo", () => {
  it("a ferramenta nasce desligada no portal e na API", () => {
    expect(defaultToolAccess().regime_tributario).toBe(false);
    expect(DEFAULT_TOOL_ACCESS.regime_tributario).toBe(false);
  });

  it("simulação salva antes de um campo novo abre com o padrão nele", () => {
    const s = lerSalvo({ questionarioConcluido: true, dados: { receitaMensal: 10_000, vendas: { regular: 40 } } });
    expect(s.dados.receitaMensal).toBe(10_000);
    expect(s.dados.vendas).toEqual({ regular: 40, simples: 0, consumidor: 100, governo: 0, exportacao: 0 });
    expect(s.dados.cbsReferencia).toBe(8.8);
    expect(lerSalvo(null).questionarioConcluido).toBe(false);
  });
});
