/**
 * Regra central do painel de licenças: o estado é derivado do vencimento, nunca gravado.
 * Se esta função errar, o dashboard e a listagem erram juntos — por isso ela é testada
 * nas fronteiras (hoje, último dia da janela, primeiro dia fora dela).
 */
import { describe, it, expect } from "vitest";
import { statusOf } from "../../api/src/licenseStatus.js";

const hoje = new Date(2026, 7, 3); // 03/08/2026
const JANELA = 60;

describe("statusOf", () => {
  it("sem data cadastrada é 'ausente'", () => {
    expect(statusOf(null, hoje, JANELA)).toBe("ausente");
    expect(statusOf(undefined, hoje, JANELA)).toBe("ausente");
    expect(statusOf("não é data", hoje, JANELA)).toBe("ausente");
  });

  it("vencimento no passado é 'vencida'", () => {
    expect(statusOf("2026-08-02", hoje, JANELA)).toBe("vencida");
    expect(statusOf("2025-01-01", hoje, JANELA)).toBe("vencida");
  });

  it("vencer hoje ainda conta como 'a vencer', não como vencida", () => {
    expect(statusOf("2026-08-03", hoje, JANELA)).toBe("a_vencer");
  });

  it("dentro da janela de aviso é 'a vencer'; o dia seguinte já é 'ativa'", () => {
    expect(statusOf("2026-10-02", hoje, JANELA)).toBe("a_vencer"); // 60º dia
    expect(statusOf("2026-10-03", hoje, JANELA)).toBe("ativa"); // 61º dia
  });

  it("vencimento distante é 'ativa'", () => {
    expect(statusOf("2027-05-10", hoje, JANELA)).toBe("ativa");
  });

  it("aceita timestamp com hora sem escorregar de dia por fuso", () => {
    expect(statusOf("2026-08-03T00:00:00.000Z", hoje, JANELA)).toBe("a_vencer");
  });
});
