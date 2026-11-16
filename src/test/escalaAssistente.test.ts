import { describe, expect, it } from "vitest";
import { executarFerramenta, type EstadoEscala } from "@/lib/escala/assistenteFerramentas";
import type { ResultadoDistribuicao } from "@/lib/escala/distribuir";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";
import { configPadrao, normalizarConfigEmpresa } from "@/lib/escala/planejamento";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validarMensagens, FERRAMENTAS } = require("../../api/src/escalaAssistente.js");

const fer = (ano: number) => new Set(feriadosDaEmpresa([ano - 1, ano], [], false).keys());
const estado = (mes: string, modelo: "6x1" | "5x2" = "5x2"): EstadoEscala => ({
  mes,
  cfg: { ...normalizarConfigEmpresa(null), segmento: "comercio" },
  configs: Array.from({ length: 5 }, (_, i) => ({ ...configPadrao(`p${i}`, `Pessoa ${i}`, modelo), folgas5x2: [6, 0] })),
  ajustes: {},
  feriados: fer(Number(mes.slice(0, 4))),
});

describe("ferramentas do assistente", () => {
  it("ver_situacao devolve pessoas com id e a regra do mês", async () => {
    const r = await executarFerramenta("ver_situacao", {}, estado("2027-02"), new Map());
    const o = JSON.parse(r.conteudo);
    expect(o.regra.limite_semanal_h).toBe(42);
    expect(o.pessoas).toHaveLength(5);
    expect(o.pessoas[0].id).toBe("p0");
  });

  it("projetar_etapas aponta a 6x1 de hoje fora da regra em 2027", async () => {
    const r = await executarFerramenta("projetar_etapas", {}, estado("2026-11", "6x1"), new Map());
    const [etapa1] = JSON.parse(r.conteudo);
    expect(etapa1.limite_semanal_h).toBe(42);
    expect(etapa1.pessoas_fora_da_regra.length).toBe(5);
  });

  it("simula e aplica uma distribuição válida", async () => {
    const sims = new Map<string, ResultadoDistribuicao>();
    const e = estado("2027-02");
    const s = await executarFerramenta(
      "simular_distribuicao",
      { grupos: [{ modelo: "5x2_rev", quantidade: null, folga_fixa: null }], semente: 3 },
      e,
      sims,
    );
    const o = JSON.parse(s.conteudo);
    expect(o.valida).toBe(true);
    const a = await executarFerramenta("aplicar_distribuicao", { id: o.id }, e, sims);
    expect(a.erro).toBeFalsy();
    expect(a.estado?.configs.every((c) => c.modelo === "5x2_rev")).toBe(true);
  });

  it("alterar_pessoa recusa mudança que cria erro (6x1 depois da emenda)", async () => {
    const r = await executarFerramenta("alterar_pessoa", { pessoa_id: "p1", modelo: "6x1" }, estado("2027-02"), new Map());
    expect(r.erro).toBe(true);
    expect(r.estado).toBeUndefined();
  });

  it("alterar_pessoa aceita mudança dentro da regra", async () => {
    const r = await executarFerramenta("alterar_pessoa", { pessoa_id: "p1", entrada: "09:00", saida: "18:00" }, estado("2027-02"), new Map());
    expect(r.erro).toBeFalsy();
    expect(r.estado?.configs[1].entrada).toBe("09:00");
  });

  it("definir_demanda valida 7 números", async () => {
    expect((await executarFerramenta("definir_demanda", { demanda: [1, 2] }, estado("2027-02"), new Map())).erro).toBe(true);
    const ok = await executarFerramenta("definir_demanda", { demanda: [2, 4, 4, 4, 4, 4, 3] }, estado("2027-02"), new Map());
    expect(ok.estado?.cfg.demanda).toEqual([2, 4, 4, 4, 4, 4, 3]);
  });

  it("salvar_escala recusa escala com erro e pede gravação quando ok", async () => {
    expect((await executarFerramenta("salvar_escala", {}, estado("2027-02", "6x1"), new Map())).erro).toBe(true);
    expect((await executarFerramenta("salvar_escala", {}, estado("2027-02"), new Map())).salvar).toBe(true);
  });
});

describe("servidor do assistente", () => {
  it("toda ferramenta declarada tem execução no navegador", async () => {
    for (const f of FERRAMENTAS) {
      const r = await executarFerramenta(f.name, {}, estado("2027-02"), new Map());
      expect(r.conteudo).not.toContain("Ferramenta desconhecida");
    }
  });
  it("valida a conversa", () => {
    expect(validarMensagens([])).toBeTruthy();
    expect(validarMensagens([{ role: "system", content: "x" }])).toBeTruthy();
    expect(validarMensagens([{ role: "assistant", content: "x" }])).toBeTruthy();
    expect(validarMensagens([{ role: "user", content: "oi" }])).toBeNull();
  });
});
