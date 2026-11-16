import { describe, expect, it } from "vitest";
import { formatTelefone, linhasClientes } from "@/lib/exportClientesXlsx";

describe("formatTelefone", () => {
  it("formata celular e fixo, com ou sem 55", () => {
    expect(formatTelefone("11987654321")).toBe("(11) 98765-4321");
    expect(formatTelefone("5511987654321")).toBe("(11) 98765-4321");
    expect(formatTelefone("1134567890")).toBe("(11) 3456-7890");
  });
  it("vazio vira string vazia e formato estranho volta como veio", () => {
    expect(formatTelefone(null)).toBe("");
    expect(formatTelefone("123")).toBe("123");
  });
});

describe("linhasClientes", () => {
  it("monta cabeçalho e linha com CNPJ mascarado e campos faltantes em branco", () => {
    const linhas = linhasClientes([
      { name: "ACME LTDA", cnpj: "35736034000123", phone: "11987654321", whatsapp: null, email: null, endereco: null },
    ]);
    expect(linhas[0]).toEqual(["Nome", "CNPJ", "Telefone", "WhatsApp", "E-mail", "Endereço"]);
    expect(linhas[1]).toEqual(["ACME LTDA", "35.736.034/0001-23", "(11) 98765-4321", "", "", ""]);
  });
});
