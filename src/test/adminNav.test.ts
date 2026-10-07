/**
 * Mapa de setores do painel. O que importa aqui: nenhuma página some do menu na
 * reorganização, rota repetida não existe, e cada pessoa só vê o que as permissões dela deixam.
 */
import { describe, it, expect } from "vitest";
import { SETORES, setoresVisiveis, setorDoCaminho, podeVerItem } from "@/lib/adminNav";
import { ADMIN_AREAS, mergeAdminAreas } from "@/lib/adminAreas";

const todasRotas = SETORES.flatMap((s) => s.items.map((i) => i.to));

describe("mapa de setores", () => {
  it("não repete rota entre setores", () => {
    expect(new Set(todasRotas).size).toBe(todasRotas.length);
  });

  it("mantém as rotas que o menu antigo tinha (links de e-mail e favoritos)", () => {
    for (const r of ["/admin/atendimentos", "/admin/admissoes", "/admin/propostas", "/admin/contratos", "/admin/empresas", "/admin/usuarios"]) {
      expect(todasRotas).toContain(r);
    }
  });

  it("todo item com área usa uma área que existe", () => {
    for (const s of SETORES) for (const i of s.items) if (i.area) expect(ADMIN_AREAS).toContain(i.area);
  });
});

describe("visibilidade", () => {
  it("dono vê todos os setores", () => {
    expect(setoresVisiveis({ isOwner: true, areas: mergeAdminAreas(null) }).map((s) => s.id)).toHaveLength(SETORES.length);
  });

  it("colaborador só com 'licencas' vê só o setor fiscal, e só esse item", () => {
    const areas = { ...mergeAdminAreas({}), licencas: true };
    const v = setoresVisiveis({ isOwner: false, areas });
    expect(v.map((s) => s.id)).toEqual(["fiscal"]);
    expect(v[0].items.map((i) => i.to)).toEqual(["/admin/licencas"]);
  });

  it("item só do dono fica escondido de colaborador", () => {
    const usuarios = SETORES.flatMap((s) => s.items).find((i) => i.to === "/admin/usuarios")!;
    expect(podeVerItem(usuarios, { isOwner: false, areas: mergeAdminAreas(null) })).toBe(false);
    expect(podeVerItem(usuarios, { isOwner: true })).toBe(true);
  });
});

describe("setor da rota atual", () => {
  it("acha o setor pela rota e por sub-rota", () => {
    expect(setorDoCaminho("/admin/contratos")?.id).toBe("comercial");
    expect(setorDoCaminho("/admin/contratos/123")?.id).toBe("comercial");
  });
  it("hub, visão geral e rota desconhecida não têm setor", () => {
    expect(setorDoCaminho("/admin")).toBeNull();
    expect(setorDoCaminho("/admin/hub")).toBeNull();
    expect(setorDoCaminho("/admin/folha-x")).toBeNull();
  });
});
