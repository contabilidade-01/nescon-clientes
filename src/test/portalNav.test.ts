/**
 * Mapa de setores do portal. O que importa: nenhuma tela do menu antigo some no hub,
 * rota não se repete e cada empresa só vê o que o tool_access libera.
 */
import { describe, it, expect } from "vitest";
import {
  PORTAL_SETORES,
  ITEM_CHAT,
  ACOES_RAPIDAS,
  ATALHOS_INICIO,
  itemPorChave,
  itensPorChaves,
  setoresVisiveisPortal,
  setorDoCaminhoPortal,
} from "@/lib/portalNav";
import { COMPANY_TOOL_KEYS, mergeClientToolAccess } from "@/lib/companyTools";
import { situacaoPagamentos } from "@/lib/situacaoPagamentos";
import type { Deliverable } from "@/lib/api";

const tudo = mergeClientToolAccess(Object.fromEntries(COMPANY_TOOL_KEYS.map((k) => [k, true])));
const nada = mergeClientToolAccess(Object.fromEntries(COMPANY_TOOL_KEYS.map((k) => [k, false])));
const rotas = [...PORTAL_SETORES.flatMap((s) => s.items.map((i) => i.path)), ITEM_CHAT.path];

describe("mapa do portal", () => {
  it("não repete rota", () => {
    expect(new Set(rotas).size).toBe(rotas.length);
  });

  it("mantém todas as telas do menu antigo", () => {
    for (const r of ["/calendario", "/proximos-pagamentos", "/guias", "/impostos-pendentes", "/boletos", "/folha",
      "/custo-folha", "/documentos", "/ferias", "/atestados", "/suspensao", "/advertencia", "/chatbot",
      "/salario-avulso", "/funcionarios", "/escalas", "/regime", "/historico", "/mensagens"]) {
      expect(rotas).toContain(r);
    }
  });

  it("atalhos e ações rápidas apontam para itens que existem", () => {
    for (const k of [...ATALHOS_INICIO, ...ACOES_RAPIDAS]) expect(itemPorChave(k)).toBeDefined();
  });
});

describe("visibilidade", () => {
  it("empresa com tudo liberado vê os três setores", () => {
    expect(setoresVisiveisPortal({ toolAccess: tudo }).map((s) => s.id)).toEqual(["financeiro", "documentos", "dp"]);
  });

  it("ferramenta desligada some; setor sem item some", () => {
    const so = { ...nada, fiscal_guides: true };
    const v = setoresVisiveisPortal({ toolAccess: so, gerente: { id: "g", nome: "Ana" } });
    expect(v.map((s) => s.id)).toEqual(["financeiro"]);
    expect(v[0].items.map((i) => i.key)).toEqual(["fiscal_guides"]);
  });

  it("gerente só vê advertência e suspensão", () => {
    const g = { ...nada, warning: true, suspension: true };
    const v = setoresVisiveisPortal({ toolAccess: g, gerente: { id: "g", nome: "Ana" } });
    expect(v.flatMap((s) => s.items.map((i) => i.key))).toEqual(["warning", "suspension"]);
  });

  it("empresa só com pró-labore não vê férias", () => {
    const v = setoresVisiveisPortal({ toolAccess: tudo, temFuncionarios: false });
    expect(v.flatMap((s) => s.items.map((i) => i.key))).not.toContain("vacations");
  });

  it("atalhos do Início param em quatro", () => {
    expect(itensPorChaves(ATALHOS_INICIO, { toolAccess: tudo }, 4)).toHaveLength(4);
  });
});

describe("setor da rota", () => {
  it("reconhece a tela do setor e as telas dele", () => {
    expect(setorDoCaminhoPortal("/setor/dp")).toBe("dp");
    expect(setorDoCaminhoPortal("/guias")).toBe("financeiro");
    expect(setorDoCaminhoPortal("/certificado-digital")).toBe("documentos");
    expect(setorDoCaminhoPortal("/")).toBeNull();
  });
});

describe("situação dos pagamentos", () => {
  const d = (p: Partial<Deliverable>): Deliverable =>
    ({ id: "x", company_id: "c", category: "guia", doc_type: null, title: "DAS", competencia: null,
      due_date: null, file_name: "a.pdf", status: "pending", paid_at: null, source: "gclick", created_at: "", ...p }) as Deliverable;

  it("separa pagas, a vencer e vencidas e ignora o que não é cobrança", () => {
    const r = situacaoPagamentos(
      [
        d({ due_date: "2026-11-01", status: "paid" }),
        d({ due_date: "2026-11-03" }),
        d({ due_date: "2026-11-20", category: "boleto" }),
        d({ due_date: "2026-11-20", category: "folha" }),
        d({ due_date: "2026-01-10" }), // fora dos 90 dias
        d({ due_date: "2026-11-20", historico: true }),
      ],
      "2026-11-04"
    );
    expect(r).toEqual({ pagas: 1, aVencer: 1, vencidas: 1 });
  });
});
