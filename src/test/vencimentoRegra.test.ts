/**
 * Regra de vencimento por tipo de documento.
 *
 * O que este teste protege: a regra do catálogo só manda para os tipos identificados
 * SEM ambiguidade (FGTS/DAS/DCTF Web). ICMS/ISS (regra regional) e INSS (doc_type
 * ambíguo — GPS dia 20 vs contribuinte individual dia 15) NÃO podem ser forçados: para
 * eles a resposta é null, e quem chama continua lendo a data do documento.
 */
import { describe, it, expect } from "vitest";
import {
  vencimentoPorRegra,
  temRegraFixa,
  DOC_TYPE_PARA_OBRIGACAO,
} from "../../api/src/vencimentoRegra.js";

describe("vencimentoPorRegra — tipos com regra fixa", () => {
  it("FGTS cai no dia 20 quando é dia bancário (competência = mês de pagamento)", () => {
    expect(vencimentoPorRegra("FGTS", "2026-08")).toBe("2026-08-20");
  });

  it("FGTS antecipa quando o dia 20 não é bancário (set/2026, domingo)", () => {
    expect(vencimentoPorRegra("FGTS", "2026-09")).toBe("2026-09-18");
  });

  it("DAS ADIA quando o dia 20 não é bancário (set/2026) — regra do Simples", () => {
    expect(vencimentoPorRegra("DAS", "2026-09")).toBe("2026-09-21");
  });

  it("DCTF Web (INSS) cai no dia 20 antecipando", () => {
    expect(vencimentoPorRegra("DCTF_WEB", "2026-09")).toBe("2026-09-18");
  });

  it("aceita âncora como data completa YYYY-MM-DD (usa só o mês)", () => {
    // A data veio errada (dia 7), mas o mês está certo: a regra corrige para dia 20.
    expect(vencimentoPorRegra("FGTS", "2026-08-07")).toBe("2026-08-20");
  });

  it("é indiferente a maiúsculas/minúsculas no doc_type", () => {
    expect(vencimentoPorRegra("fgts", "2026-08")).toBe("2026-08-20");
  });
});

describe("vencimentoPorRegra — o que NÃO pode ser forçado devolve null", () => {
  it("ICMS não é forçado (regra é estadual)", () => {
    expect(vencimentoPorRegra("ICMS", "2026-08")).toBeNull();
  });

  it("ISS não é forçado (regra é municipal)", () => {
    expect(vencimentoPorRegra("ISS", "2026-08")).toBeNull();
  });

  it("INSS não é forçado (doc_type ambíguo: GPS dia 20 vs CI dia 15)", () => {
    expect(vencimentoPorRegra("INSS", "2026-08")).toBeNull();
  });

  it("tipo desconhecido devolve null", () => {
    expect(vencimentoPorRegra("CONTRATO", "2026-08")).toBeNull();
    expect(vencimentoPorRegra("", "2026-08")).toBeNull();
    expect(vencimentoPorRegra(null, "2026-08")).toBeNull();
  });

  it("referência de mês inválida devolve null (não chuta)", () => {
    expect(vencimentoPorRegra("FGTS", "")).toBeNull();
    expect(vencimentoPorRegra("FGTS", "agosto")).toBeNull();
    expect(vencimentoPorRegra("FGTS", "2026-13")).toBeNull();
  });
});

describe("temRegraFixa / mapa", () => {
  it("reconhece só os três tipos identificados sem ambiguidade", () => {
    expect(temRegraFixa("FGTS")).toBe(true);
    expect(temRegraFixa("DAS")).toBe(true);
    expect(temRegraFixa("DCTF_WEB")).toBe(true);
    expect(temRegraFixa("ICMS")).toBe(false);
    expect(temRegraFixa("ISS")).toBe(false);
    expect(temRegraFixa("INSS")).toBe(false);
  });

  it("todo código do mapa existe no catálogo de obrigações", async () => {
    const { obrigacao } = await import("../../api/src/obrigacoes.js");
    for (const codigo of Object.values(DOC_TYPE_PARA_OBRIGACAO)) {
      expect(obrigacao(codigo), `código ${codigo} deve existir no catálogo`).not.toBeNull();
    }
  });
});
