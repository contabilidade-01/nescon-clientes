/**
 * Reconhecimento de CNPJ em PDF. É o que decide para QUAL cliente vai o documento —
 * errar aqui mostra a guia de uma empresa para outra.
 */
import { describe, it, expect } from "vitest";
import { validarDigitosCnpj, onlyDigits } from "../../api/src/pdfCnpj.js";

// O mesmo regex do módulo. Duplicado de propósito: o teste quer provar o comportamento
// do padrão, e exportá-lo só para o teste sujaria a interface do módulo.
const RE_CNPJ = /(?<!\d)(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/g;

function acharCnpjs(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.match(RE_CNPJ) || []) {
    const d = onlyDigits(m);
    if (d.length === 14 && validarDigitosCnpj(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

describe("validarDigitosCnpj", () => {
  it("aceita CNPJ real, com e sem máscara", () => {
    expect(validarDigitosCnpj("35.736.034/0001-23")).toBe(true);
    expect(validarDigitosCnpj("35736034000123")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(validarDigitosCnpj("35736034000124")).toBe(false);
  });

  it("recusa repetição e tamanho errado", () => {
    expect(validarDigitosCnpj("11111111111111")).toBe(false);
    expect(validarDigitosCnpj("357360340001")).toBe(false);
    expect(validarDigitosCnpj("")).toBe(false);
  });
});

describe("padrão de busca", () => {
  it("acha o CNPJ no meio do texto, com máscara", () => {
    expect(acharCnpjs("Contribuinte: 35.736.034/0001-23 — DARF")).toEqual(["35736034000123"]);
  });

  it("não fatia 14 dígitos de dentro da linha digitável", () => {
    // Linha digitável de guia: 47 dígitos seguidos. Sem as âncoras, o padrão recortava
    // pedaços dela e cerca de 1% passava no dígito verificador, inventando um CNPJ.
    const linha = "85810000062819100202506102410123456789012345678";
    expect(acharCnpjs(`Pague com o código ${linha}`)).toEqual([]);
  });

  it("um CNPJ colado num número maior não conta", () => {
    expect(acharCnpjs("9935736034000123")).toEqual([]);
    expect(acharCnpjs("3573603400012399")).toEqual([]);
  });

  it("preserva a ordem de aparição — é ela que decide a sugestão", () => {
    const texto = "Emitente 35.736.034/0001-23 · Contribuinte 04.828.975/0001-63";
    expect(acharCnpjs(texto)).toEqual(["35736034000123", "04828975000163"]);
  });

  it("não repete o mesmo CNPJ que aparece várias vezes", () => {
    const texto = "04.828.975/0001-63 ... 04828975000163 ... 04.828.975/0001-63";
    expect(acharCnpjs(texto)).toEqual(["04828975000163"]);
  });
});
