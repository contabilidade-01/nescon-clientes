import { describe, it, expect } from "vitest";
import { senhaTemporariaExpirada, novoPrazoSenhaTemporaria } from "../../api/src/senhaExpiracao.js";

const agora = new Date("2026-09-18T12:00:00Z");
const ontem = "2026-09-17T12:00:00Z";
const amanha = "2026-09-19T12:00:00Z";

describe("senhaTemporariaExpirada", () => {
  it("senha temporária vencida barra", () => {
    expect(senhaTemporariaExpirada({ mustChangePassword: true, passwordExpiresAt: ontem }, agora)).toBe(true);
  });

  it("senha temporária no prazo passa", () => {
    expect(senhaTemporariaExpirada({ mustChangePassword: true, passwordExpiresAt: amanha }, agora)).toBe(false);
  });

  it("senha criada pelo cliente não expira, mesmo com data velha no banco", () => {
    // O caso real: "esqueci minha senha" não limpava a data e o cliente ficava barrado.
    expect(senhaTemporariaExpirada({ mustChangePassword: false, passwordExpiresAt: ontem }, agora)).toBe(false);
  });

  it("sem data não expira", () => {
    expect(senhaTemporariaExpirada({ mustChangePassword: true, passwordExpiresAt: null }, agora)).toBe(false);
  });
});

describe("novoPrazoSenhaTemporaria", () => {
  it("30 dias à frente", () => {
    expect(novoPrazoSenhaTemporaria(agora).toISOString()).toBe("2026-10-18T12:00:00.000Z");
  });
});
