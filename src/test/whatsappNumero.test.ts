/**
 * Número de WhatsApp. É a trava mais barata do envio: número torto aceito aqui vira
 * mensagem que a uazapi diz ter entregue e que nunca chegou em ninguém.
 */
import { describe, it, expect } from "vitest";
import { normalizar, validar, formatar } from "../../api/src/whatsappNumero.js";

describe("normalizar", () => {
  it("põe o 55 quando o escritório digita só DDD + número", () => {
    expect(normalizar("34999998888")).toBe("5534999998888");
    expect(normalizar("(34) 99999-8888")).toBe("5534999998888");
  });

  it("não duplica o DDI de quem já veio completo", () => {
    expect(normalizar("5534999998888")).toBe("5534999998888");
  });

  it("vazio continua vazio", () => {
    expect(normalizar("")).toBe("");
    expect(normalizar(null)).toBe("");
  });
});

describe("validar", () => {
  it("aceita celular com o 9", () => {
    const r = validar("34 99999-8888");
    expect(r.ok).toBe(true);
    expect(r.numero).toBe("5534999998888");
  });

  it("aceita DDD de duas faixas diferentes", () => {
    expect(validar("11987654321").ok).toBe(true);
    expect(validar("85988887777").ok).toBe(true);
  });

  it("recusa fixo com mensagem que diz o que fazer", () => {
    const r = validar("3432223333");
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/fixo/i);
    expect(r.numero).toBeNull();
  });

  it("recusa DDD que não existe", () => {
    expect(validar("10999998888").ok).toBe(false);
    expect(validar("01999998888").ok).toBe(false);
  });

  it("recusa número curto, longo e vazio", () => {
    expect(validar("99998888").ok).toBe(false);
    expect(validar("5534999998888000").ok).toBe(false);
    expect(validar("").motivo).toMatch(/branco/i);
  });

  it("celular sem o 9 na frente não passa", () => {
    // 34 + 8 dígitos: é o formato antigo, hoje inválido no WhatsApp.
    expect(validar("5534 8888-7777").ok).toBe(false);
  });
});

describe("formatar", () => {
  it("mostra bonito na tela, com e sem DDI", () => {
    expect(formatar("5534999998888")).toBe("(34) 99999-8888");
    expect(formatar("34999998888")).toBe("(34) 99999-8888");
  });

  it("o que não reconhece devolve como veio", () => {
    expect(formatar("123")).toBe("123");
  });
});
