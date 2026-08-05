/**
 * A trava de acesso por área. Ela decide quem enxerga dados de quais clientes, e até
 * agora não tinha um único teste — o tipo de coisa que uma refatoração desliga sem
 * ninguém notar.
 */
import { describe, it, expect, vi } from "vitest";
import { adminHasArea, requireArea, requireOwner } from "../../api/src/middleware/adminArea.js";

type FakeReq = { isAdmin?: boolean; admin?: { isOwner?: boolean; areas?: Record<string, boolean> } };

type ResFake = {
  code: number;
  body: unknown;
  status: (c: number) => ResFake;
  json: (b: unknown) => ResFake;
};

function resFake(): ResFake {
  const r: ResFake = {
    code: 0,
    body: null,
    status: (c) => {
      r.code = c;
      return r;
    },
    json: (b) => {
      r.body = b;
      return r;
    },
  };
  return r;
}

const usuario = (areas: Record<string, boolean>): FakeReq => ({ isAdmin: true, admin: { areas } });
const dono: FakeReq = { isAdmin: true, admin: { isOwner: true, areas: {} } };
const empresa: FakeReq = { isAdmin: false };

describe("adminHasArea", () => {
  it("o dono passa em qualquer área, mesmo sem nada marcado", () => {
    expect(adminHasArea(dono, "licencas")).toBe(true);
    expect(adminHasArea(dono, "lgpd")).toBe(true);
  });

  it("usuário passa só nas áreas que tem", () => {
    const req = usuario({ licencas: true, lgpd: false });
    expect(adminHasArea(req, "licencas")).toBe(true);
    expect(adminHasArea(req, "lgpd")).toBe(false);
  });

  it("login de empresa nunca passa, mesmo que o objeto tenha áreas", () => {
    expect(adminHasArea({ isAdmin: false, admin: { areas: { licencas: true } } }, "licencas")).toBe(false);
  });

  it("área desconhecida é negada em vez de liberada", () => {
    expect(adminHasArea(usuario({ licencas: true }), "inventada")).toBe(false);
  });
});

describe("requireArea", () => {
  it("deixa passar quem tem a área", () => {
    const next = vi.fn();
    requireArea("licencas")(usuario({ licencas: true }), resFake(), next);
    expect(next).toHaveBeenCalled();
  });

  it("responde 403 e NÃO chama o próximo quando falta a área", () => {
    const next = vi.fn();
    const res = resFake();
    requireArea("licencas")(usuario({ licencas: false }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(403);
  });

  it("empresa logada leva 403 em rota de painel", () => {
    const next = vi.fn();
    const res = resFake();
    requireArea("licencas")(empresa, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(403);
  });
});

describe("requireOwner", () => {
  it("só o dono passa", () => {
    const next = vi.fn();
    requireOwner(dono, resFake(), next);
    expect(next).toHaveBeenCalled();
  });

  it("usuário com TODAS as áreas ainda não é dono", () => {
    const next = vi.fn();
    const res = resFake();
    const todoPoderoso = usuario({ empresas: true, funcionarios: true, licencas: true, lgpd: true });
    requireOwner(todoPoderoso, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(403);
  });
});
