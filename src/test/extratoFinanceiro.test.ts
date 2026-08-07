/**
 * Leitura dos números do Extrato Mensal.
 *
 * Este arquivo já errou três vezes por eu ajustar o padrão contra UM extrato e assumir
 * que os outros eram iguais. Os trechos abaixo são recortes reais de PDFs diferentes
 * (Queijeiro Matriz e Maria Xavier, junho/2026), com os valores conferidos à mão.
 */
import { describe, it, expect } from "vitest";
import {
  parDeColunas,
  extrairSituacoes,
  extrairAfastamentos,
  extrairFaltas,
  calcularTurnover,
  extrairFinanceiro,
  diagnosticar,
} from "../../api/src/extratoFinanceiro.js";

/** Rodapé real do Queijeiro Matriz — note os valores INVERTIDOS em relação aos rótulos. */
const RODAPE_QUEIJEIRO = [
  "Situações",
  "No. Empregados: Demitido: 1\t13",
  "No. Estagiários: Transferido: 0\t0",
  "Trabalhando: Férias: 0\t12",
  "Doença: Admissões: 1\t0",
].join("\n");

/** Rodapé real da Maria Xavier: mesmo formato, números diferentes. */
const RODAPE_MARIA = [
  "Situações",
  "No. Empregados: Demitido: 0\t18",
  "Trabalhando: Férias: 0\t18",
  "Doença: Admissões: 2\t0",
].join("\n");

describe("rodapé de duas colunas — o valor vem antes do rótulo", () => {
  it("Empregados=13 e Demitido=1, não o contrário", () => {
    const r = parDeColunas("No. Empregados: Demitido: 1\t13", "No. Empregados", "Demitido");
    expect(r).toEqual({ "No. Empregados": 13, Demitido: 1 });
  });

  it("ler na ordem escrita daria 1 empregado e 13 demitidos — absurdo que o teste trava", () => {
    const r = parDeColunas("No. Empregados: Demitido: 1\t13", "No. Empregados", "Demitido");
    expect(r!["No. Empregados"]).toBeGreaterThan(r!.Demitido);
  });

  it("lê o rodapé inteiro do Queijeiro", () => {
    expect(extrairSituacoes(RODAPE_QUEIJEIRO)).toMatchObject({
      empregados: 13,
      demitidos: 1,
      admitidos: 1,
      trabalhando: 12,
    });
  });

  it("lê o rodapé da Maria Xavier — outro extrato, mesmo leitor", () => {
    expect(extrairSituacoes(RODAPE_MARIA)).toMatchObject({
      empregados: 18,
      demitidos: 0,
      admitidos: 2,
      trabalhando: 18,
    });
  });
});

describe("turnover", () => {
  it("(admissões + demissões) / 2 ÷ quadro", () => {
    // Queijeiro: (1+1)/2/13 = 7,69%
    expect(calcularTurnover({ admitidos: 1, demitidos: 1, empregados: 13 })).toBe(7.69);
  });

  it("sem quadro devolve null, não zero — zero afirmaria que não houve rotação", () => {
    expect(calcularTurnover({ admitidos: 1, demitidos: 0, empregados: 0 })).toBeNull();
    expect(calcularTurnover({ admitidos: null, demitidos: null, empregados: null })).toBeNull();
  });
});

describe("rubricas — provento e desconto têm formatos diferentes", () => {
  // Linha real: o valor do provento vem depois do marcador P; o fim da linha é a
  // coluna de DESCONTOS. Pegar os dois últimos números dava "607 dias de afastamento".
  const AFASTAMENTO = "8870 DIAS AFAST. P/DOENCA C/DIR.INTEGRAIS 998 184,71 D\tP\t66,52\t1,00 I.N.S.S. 7,95";

  it("afastamento: valor 66,52 e 1 dia — não os números do fim da linha", () => {
    const r = extrairAfastamentos(AFASTAMENTO);
    expect(r.valor).toBe(66.52);
    expect(r.dias).toBe(1);
  });

  it("soma as ocorrências de vários funcionários", () => {
    const texto = [
      AFASTAMENTO,
      "8870 DIAS AFAST. P/DOENCA C/DIR.INTEGRAIS 998 220,60 D\tP\t166,67\t2,00 I.N.S.S. 8,11",
    ].join("\n");
    const r = extrairAfastamentos(texto);
    expect(r.ocorrencias).toBe(2);
    expect(r.valor).toBe(233.19); // 66,52 + 166,67
    expect(r.dias).toBe(3);
  });

  it("faltas são DESCONTO: outro formato, e por isso vinham zeradas", () => {
    const texto = [
      "250 REFLEXO EXTRAS DSR 8794 266,09 D\tP\t29,57\t0,00 DIAS FALTAS DSR 4,00",
      "8792 266,09 D\tDIAS FALTAS 4,00",
    ].join("\n");
    const r = extrairFaltas(texto);
    expect(r.dias).toBe(4);
    expect(r.dias_dsr).toBe(4);
  });

  it("DSR não entra nas faltas: é consequência, não ausência a mais", () => {
    const texto = "8792 266,09 D\tDIAS FALTAS 4,00\n8794 100,00 D\tDIAS FALTAS DSR 2,00";
    const r = extrairFaltas(texto);
    expect(r.dias).toBe(4);
    expect(r.dias).not.toBe(6);
  });
});

describe("quadro pelo corpo quando o rodapé não existe", () => {
  it("usa a contagem de funcionários e marca a origem", () => {
    const r = extrairFinanceiro("Total Geral Proventos: 1,00", { funcionariosNoCorpo: 9 });
    expect(r.situacoes.empregados).toBe(9);
    expect(r.origem_quadro).toBe("corpo");
  });

  it("o rodapé continua tendo prioridade quando existe", () => {
    const r = extrairFinanceiro(RODAPE_QUEIJEIRO, { funcionariosNoCorpo: 99 });
    expect(r.situacoes.empregados).toBe(13);
    expect(r.origem_quadro).toBe("rodape");
  });

  it("admissões NÃO têm fallback: turnover fica nulo em vez de errado", () => {
    const r = extrairFinanceiro("Total Geral Proventos: 1,00", { funcionariosNoCorpo: 9 });
    expect(r.situacoes.admitidos).toBeNull();
    expect(r.turnover).toBeNull();
  });
});

describe("diagnóstico — o porquê, não só o sintoma", () => {
  it("PDF sem camada de texto", () => {
    expect(diagnosticar("").causa).toBe("sem_texto");
  });

  it("arquivo que não é extrato", () => {
    expect(diagnosticar("RECIBO DE ENTREGA Banco valor 10,00 ".repeat(30)).causa).toBe("nao_e_extrato");
  });

  it("extrato sem o bloco de situações", () => {
    const t = ("Total Geral Proventos: 1,00\nDIAS NORMAIS 8781 x\n").repeat(20);
    expect(diagnosticar(t).causa).toBe("extrato_parcial");
  });

  it("a amostra vem junto, para diagnosticar sem abrir o PDF", () => {
    const d = diagnosticar("RECIBO DE ENTREGA Banco valor 10,00 ".repeat(30));
    expect(d.amostra.length).toBeGreaterThan(0);
    expect(d.explicacao).toMatch(/não parece um Extrato Mensal/);
  });
});
