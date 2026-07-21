import { describe, it, expect } from "vitest";
import { extrairDoTexto, cpfValido } from "../../api/src/extratoEmployees.js";

// Trecho real de um Extrato Mensal (com os campos que importam).
const EXTRATO = `
Empresa: 49 - EMPRESA EXEMPLO LTDA Página: 1/4
CNPJ: 54.803.962/0001-08
EXTRATO MENSAL
Empr.: 15DAYLA APARECIDA BUENO Situação: Trabalhando CPF:510.512.768-45 Adm: 18/09/2025
Vínculo: Celetista CC:1 Depto: 1
Empr.: 28GABRIEL RODRIGUES SILVA LECI DOS SANTOSSituação: Trabalhando CPF:510.185.348-81 Adm: 10/03/2026
Empr.: 16GILMAR ALVES DE JESUS Situação: Trabalhando CPF:136.715.478-20 Adm: 18/09/2025
`;

// Como o pdf-parse (Node) embaralha as colunas: código+nome no início, rótulos soltos.
const EXTRATO_PDFPARSE = [
  "15 DAYLA APARECIDA BUENO\tEmpr.: 18/09/2025\tAdm:\t510.512.768-45\tTrabalhando CPF:\tSituação:",
  "8781 1.995,66 P\tDIAS NORMAIS 30,00",
  "998 143,31 D\tI.N.S.S. 7,69",
  "28 GABRIEL RODRIGUES SILVA LECI DOS SANTOS\tEmpr.: 10/03/2026\tAdm:\t510.185.348-81\tTrabalhando CPF:\tSituação:",
].join("\n");

describe("dígito verificador de CPF", () => {
  it("aceita CPF válido e rejeita sequência/estrutura inválida", () => {
    expect(cpfValido("510.512.768-45")).toBe(true);
    expect(cpfValido("111.111.111-11")).toBe(false); // todos iguais
    expect(cpfValido("123.456.789-00")).toBe(false); // DV errado
    expect(cpfValido("510512768")).toBe(false); // curto
  });
});

describe("parser do extrato de folha", () => {
  it("extrai nome + CPF de cada funcionário", () => {
    const { funcionarios } = extrairDoTexto(EXTRATO);
    expect(funcionarios).toHaveLength(3);
    expect(funcionarios[0]).toMatchObject({ name: "DAYLA APARECIDA BUENO", cpf: "51051276845" });
  });

  it("separa o nome colado em 'Situação' (sem número do código no nome)", () => {
    const { funcionarios } = extrairDoTexto(EXTRATO);
    const gabriel = funcionarios.find((f: { cpf: string }) => f.cpf === "51018534881");
    expect(gabriel.name).toBe("GABRIEL RODRIGUES SILVA LECI DOS SANTOS");
    expect(gabriel.codigo).toBe("28");
  });

  it("não duplica o mesmo CPF", () => {
    const { funcionarios } = extrairDoTexto(EXTRATO + EXTRATO);
    expect(funcionarios).toHaveLength(3);
  });

  it("conta CPF ilegível como inválido em vez de cadastrar errado", () => {
    const ruim = "Empr.: 99FULANO DE TAL Situação: Trabalhando CPF:000.000.000-00 Adm: 01/01/2026";
    const { funcionarios, invalidos } = extrairDoTexto(ruim);
    expect(funcionarios).toHaveLength(0);
    expect(invalidos).toBe(1);
  });

  it("também lê o layout embaralhado do pdf-parse (colunas fora de ordem)", () => {
    const { funcionarios } = extrairDoTexto(EXTRATO_PDFPARSE);
    expect(funcionarios).toHaveLength(2);
    expect(funcionarios[0]).toMatchObject({ name: "DAYLA APARECIDA BUENO", cpf: "51051276845", codigo: "15" });
    expect(funcionarios[1].name).toBe("GABRIEL RODRIGUES SILVA LECI DOS SANTOS");
  });

  it("não confunde linhas de proventos/descontos com empregados", () => {
    const { funcionarios } = extrairDoTexto("8781 1.995,66 P\tDIAS NORMAIS 30,00\n981 798,26 D\tDESC.ADIANT.SALARIAL");
    expect(funcionarios).toHaveLength(0);
  });
});
