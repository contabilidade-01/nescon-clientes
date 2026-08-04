import { describe, expect, it } from "vitest";
import { extractFileCnpj, parseEmployeesCsv } from "@/lib/parseEmployeeSpreadsheet";

const sampleCsv = `Empresa:;EMPRESA EXEMPLO LTDA;;
C.N.P.J.:;12.345.678/0001-95;;
RELAÇÃO DE EMPREGADOS;;;
Nome;;CPF;Data demissão
JOAO DA SILVA SANTOS;;12345678900;
MARIA APARECIDA DE SOUZA;;98765432100;
PEDRO HENRIQUE OLIVEIRA;;11122233344;01/01/2020`;

describe("parseEmployeeSpreadsheet", () => {
  it("extracts CNPJ from relação de empregados format", () => {
    expect(extractFileCnpj(sampleCsv)).toBe("12345678000195");
  });

  it("parses active employees and skips dismissed", () => {
    const { rows, skippedDismissed } = parseEmployeesCsv(sampleCsv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "JOAO DA SILVA SANTOS", cpf: "12345678900" });
    expect(skippedDismissed).toBe(1);
  });
});
