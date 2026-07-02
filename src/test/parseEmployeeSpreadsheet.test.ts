import { describe, expect, it } from "vitest";
import { extractFileCnpj, parseEmployeesCsv } from "@/lib/parseEmployeeSpreadsheet";

const sampleCsv = `Empresa:;RESTAURANTE DO QUEIJEIRO 4 LTDA;;
C.N.P.J.:;54.803.962/0001-08;;
RELAÇÃO DE EMPREGADOS;;;
Nome;;CPF;Data demissão
MATHEUS MATOS ALVES TAKAHASHI;;43140151870;
SILVANA ELIZABETH COSTA DE OLIVEIRA;;35740074851;
JOSE EVERALDO DA SILVA;;36507437875;01/01/2020`;

describe("parseEmployeeSpreadsheet", () => {
  it("extracts CNPJ from relação de empregados format", () => {
    expect(extractFileCnpj(sampleCsv)).toBe("54803962000108");
  });

  it("parses active employees and skips dismissed", () => {
    const { rows, skippedDismissed } = parseEmployeesCsv(sampleCsv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "MATHEUS MATOS ALVES TAKAHASHI", cpf: "43140151870" });
    expect(skippedDismissed).toBe(1);
  });
});
