import { describe, expect, it } from "vitest";
import { empresaCasaBusca } from "@/lib/buscaEmpresa";

const queijeiro = { name: "Restaurante do Queijeiro Ltda", cnpj: "26786637000149" };
const volts = { name: "13 VOLTS LTDA", cnpj: "52747415000127" };

describe("empresaCasaBusca", () => {
  it("termo só com letras não casa com qualquer CNPJ", () => {
    expect(empresaCasaBusca(volts, "queijeiro")).toBe(false);
    expect(empresaCasaBusca(queijeiro, "queijeiro")).toBe(true);
  });
  it("ignora acento e maiúsculas", () => {
    expect(empresaCasaBusca(queijeiro, "QUEIJÉIRO")).toBe(true);
    expect(empresaCasaBusca({ name: "Padaria São João", cnpj: "1" }, "sao joao")).toBe(true);
  });
  it("busca por CNPJ com ou sem máscara", () => {
    expect(empresaCasaBusca(queijeiro, "26.786.637")).toBe(true);
    expect(empresaCasaBusca(queijeiro, "26786637000149")).toBe(true);
    expect(empresaCasaBusca(volts, "26.786")).toBe(false);
  });
  it("busca vazia mostra tudo", () => {
    expect(empresaCasaBusca(volts, "  ")).toBe(true);
  });
});
