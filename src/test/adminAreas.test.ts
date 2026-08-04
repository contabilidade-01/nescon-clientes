/**
 * Permissão por área do painel. O risco aqui é nos dois extremos: liberar demais
 * (login antigo que perde acesso, ou chave desconhecida virando permissão) e liberar
 * de menos (usuário novo que deveria nascer sem nada).
 */
import { describe, it, expect } from "vitest";
import { ADMIN_AREAS, mergeAreas, sanitizeAreas } from "../../api/src/adminAreas.js";

describe("mergeAreas", () => {
  it("areas nulo = acesso total (login antigo continua funcionando)", () => {
    const r = mergeAreas(null);
    expect(Object.values(r).every(Boolean)).toBe(true);
    expect(Object.keys(r).sort()).toEqual([...ADMIN_AREAS].sort());
  });

  it("objeto vazio = nenhuma área (usuário novo nasce sem nada)", () => {
    expect(Object.values(mergeAreas({})).some(Boolean)).toBe(false);
  });

  it("chave ausente vira false, sem herdar nada", () => {
    const r = mergeAreas({ licencas: true });
    expect(r.licencas).toBe(true);
    expect(r.empresas).toBe(false);
    expect(r.lgpd).toBe(false);
  });

  it("valores não booleanos são normalizados", () => {
    const r = mergeAreas({ licencas: "sim", empresas: 0, lgpd: 1 });
    expect(r.licencas).toBe(true);
    expect(r.empresas).toBe(false);
    expect(r.lgpd).toBe(true);
  });

  it("array não é tratado como permissão", () => {
    expect(Object.values(mergeAreas(["licencas"])).some(Boolean)).toBe(false);
  });
});

describe("sanitizeAreas", () => {
  it("descarta chave desconhecida enviada pelo cliente", () => {
    const r = sanitizeAreas({ licencas: true, superpoder: true });
    expect(r.licencas).toBe(true);
    expect("superpoder" in r).toBe(false);
    expect(Object.keys(r).sort()).toEqual([...ADMIN_AREAS].sort());
  });

  it("corpo inválido devolve todas as áreas fechadas", () => {
    expect(Object.values(sanitizeAreas(null)).some(Boolean)).toBe(false);
    expect(Object.values(sanitizeAreas("tudo")).some(Boolean)).toBe(false);
  });
});
