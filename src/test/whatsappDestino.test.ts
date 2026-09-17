import { describe, it, expect } from "vitest";
import { chaveNumero, classificarDestino } from "../../api/src/whatsappDestino.js";

describe("chaveNumero", () => {
  it("mesmo celular com e sem 55 e com máscara dá a mesma chave", () => {
    const k = chaveNumero("5511948626605");
    expect(k).toBe("1148626605");
    expect(chaveNumero("(11) 94862-6605")).toBe(k);
    expect(chaveNumero("11 4862-6605")).toBe(k); // sem o 9º dígito
  });

  it("número curto demais não gera chave", () => {
    expect(chaveNumero("")).toBe("");
    expect(chaveNumero("48626605")).toBe("");
  });

  it("DDD diferente é número diferente", () => {
    expect(chaveNumero("21948626605")).not.toBe(chaveNumero("11948626605"));
  });
});

describe("classificarDestino", () => {
  const conjuntos = {
    clientes: new Set([chaveNumero("34999998888")]),
    escritorio: new Set([chaveNumero("11948626605")]),
  };

  it("cliente cadastrado passa", () => {
    expect(classificarDestino("5534999998888", conjuntos)).toMatchObject({ ok: true, tipo: "cliente" });
  });

  it("número do escritório passa como escritório", () => {
    expect(classificarDestino("11948626605", conjuntos)).toMatchObject({ ok: true, tipo: "escritorio" });
  });

  it("número desconhecido é bloqueado", () => {
    const r = classificarDestino("5534988887777", conjuntos);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/não pertence/);
  });

  it("número inválido é bloqueado", () => {
    expect(classificarDestino("abc", conjuntos).ok).toBe(false);
  });
});
