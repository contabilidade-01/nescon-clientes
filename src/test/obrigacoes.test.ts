/**
 * Catálogo de obrigações: a data de cada tributo.
 *
 * O caso que mais importa aqui é FGTS × DAS. Os dois vencem "dia 20", mas quando o 20
 * não é dia bancário um antecipa e o outro adia. Trocar os dois faz o cliente pagar com
 * multa — e o alerta teria sido a causa.
 */
import { describe, it, expect } from "vitest";
import {
  OBRIGACOES,
  obrigacao,
  calcularVencimento,
  competenciaDe,
  obrigacoesQueVencemEm,
} from "../../api/src/obrigacoes.js";

describe("catálogo", () => {
  it("todo código é único", () => {
    const codigos = OBRIGACOES.map((o: { codigo: string }) => o.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it("só as automáticas têm gatilho, e o gatilho é conhecido", () => {
    const validos = [
      null,
      "funcionario",
      "funcionario_ou_prolabore",
      "funcionario_ou_estagiario",
      "das_no_portal",
    ];
    for (const o of OBRIGACOES) expect(validos).toContain(o.auto);
  });

  it("código desconhecido devolve null em vez de chutar", () => {
    expect(obrigacao("NAO_EXISTE")).toBeNull();
    expect(calcularVencimento("NAO_EXISTE", 2026, 8)).toBeNull();
  });
});

describe("dia 20 — antecipa ou adia conforme o tributo", () => {
  it("em setembro/2026 o dia 20 é domingo", () => {
    // FGTS e INSS (DCTF Web) antecipam.
    expect(calcularVencimento("FGTS", 2026, 9)?.data).toBe("2026-09-18");
    expect(calcularVencimento("INSS_DCTFWEB", 2026, 9)?.data).toBe("2026-09-18");
    // O Simples adia (LC 123, art. 21 §3º).
    expect(calcularVencimento("DAS", 2026, 9)?.data).toBe("2026-09-21");
  });

  it("quando o dia 20 é útil, todos caem no mesmo dia", () => {
    for (const c of ["FGTS", "DAS", "INSS_DCTFWEB"]) {
      expect(calcularVencimento(c, 2026, 8)?.data).toBe("2026-08-20");
    }
  });
});

describe("demais regras da tabela do escritório", () => {
  it("salário no 5º dia útil, antecipando para sexta quando cair em sábado", () => {
    expect(calcularVencimento("SALARIO", 2026, 8)?.data).toBe("2026-08-06");
    expect(calcularVencimento("SALARIO", 2026, 8)?.observacao).toBeNull();

    // Dezembro 2026: 5º dia útil = sábado 05/12 → antecipa para sexta 04/12
    const dez = calcularVencimento("SALARIO", 2026, 12);
    expect(dez?.data).toBe("2026-12-04");
    expect(dez?.observacao).toMatch(/sexta/);
  });
});

describe("competência × mês de pagamento", () => {
  it("o pagamento de janeiro refere-se a dezembro do ano anterior", () => {
    expect(competenciaDe(2026, 1)).toEqual({ ano: 2025, mes: 12 });
    expect(competenciaDe(2026, 8)).toEqual({ ano: 2026, mes: 7 });
  });
});

describe("obrigacoesQueVencemEm", () => {
  const todas = ["FGTS", "DAS", "SALARIO"];

  it("acha o que cai exatamente no dia", () => {
    const r = obrigacoesQueVencemEm("2026-08-20", todas);
    expect(r.map((x: { codigo: string }) => x.codigo).sort()).toEqual(["DAS", "FGTS"]);
  });

  it("dia sem vencimento devolve lista vazia", () => {
    expect(obrigacoesQueVencemEm("2026-08-13", todas)).toEqual([]);
  });

  it("só considera as obrigações que a empresa recebe", () => {
    // SALARIO vence no 5º dia útil, não no dia 20 — logo, não entra nesta data.
    const r = obrigacoesQueVencemEm("2026-08-20", ["SALARIO"]);
    expect(r).toEqual([]);
  });

  it("carrega a observação do salário junto (antecipado para sexta)", () => {
    // Com a antecipação, o salário de dezembro vence em 04/12 (sexta), não 05/12 (sábado)
    const r = obrigacoesQueVencemEm("2026-12-04", ["SALARIO"]);
    expect(r).toHaveLength(1);
    expect(r[0].observacao).toMatch(/sexta/);
  });

  it("data malformada não explode", () => {
    expect(obrigacoesQueVencemEm("20/08/2026", todas)).toEqual([]);
  });
});
