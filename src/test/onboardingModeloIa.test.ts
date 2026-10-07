/**
 * Validação do que chega do construtor e do agente de IA, e os lembretes de prazo.
 * O agente é um modelo de linguagem: tudo o que ele devolve tem de passar pelo sanitizador
 * antes de virar roteiro que o cliente lê.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizarBloco,
  sanitizarBlocos,
  sanitizarRegras,
  lembretesDevidos,
  MARCOS_LEMBRETE,
  resolverItens,
} from "../../api/src/onboardingRegras.js";
import { interpretarResposta, promptSistema, CONHECIMENTO_PADRAO } from "../../api/src/onboardingIa.js";
import { situacaoDoPrazo } from "../../api/src/onboardingLembretes.js";

describe("sanitizarRegras", () => {
  it("mantém só critérios conhecidos com valores da lista", () => {
    expect(
      sanitizarRegras({ areas: ["fiscal", "xpto"], enquadramento: "simples", tipoEmpresa: ["servico", "bar"], comFuncionarios: true, lixo: 1 })
    ).toEqual({ areas: ["fiscal"], enquadramento: ["simples"], tipoEmpresa: ["servico"], comFuncionarios: true });
  });
  it("entrada inválida vira objeto vazio", () => {
    expect(sanitizarRegras(null)).toEqual({});
    expect(sanitizarRegras([1])).toEqual({});
    expect(sanitizarRegras({ areas: [] })).toEqual({});
  });
});

describe("sanitizarBloco", () => {
  it("descarta tipo desconhecido", () => {
    expect(sanitizarBloco({ tipo: "script", titulo: "x" })).toBeNull();
    expect(sanitizarBloco(null)).toBeNull();
  });

  it("documento: limita prazo, normaliza formatos e só aceita http(s) no exemplo", () => {
    const b = sanitizarBloco({
      tipo: "documento",
      titulo: "  Extrato  ",
      formatos: ["PDF", " .ofx ", "x-y-z!!"],
      prazo: { ref: "inicio", dias: 9999, uteis: 1 },
      exemploUrl: "javascript:alert(1)",
      regra: "não é de documento",
    });
    expect(b).toMatchObject({ tipo: "documento", titulo: "Extrato", obrigatorio: true, formatos: ["pdf", "ofx", "xyz"] });
    expect(b.prazo).toEqual({ ref: "inicio", dias: 365, uteis: true });
    expect(b.exemploUrl).toBeUndefined();
    expect(b.regra).toBeUndefined();
  });

  it("obrigatório só some quando false", () => {
    expect(sanitizarBloco({ tipo: "documento", titulo: "a", obrigatorio: false }).obrigatorio).toBe(false);
    expect(sanitizarBloco({ tipo: "documento", titulo: "a" }).obrigatorio).toBe(true);
  });

  it("guarda a condição já limpa, e omite quando vazia", () => {
    expect(sanitizarBloco({ tipo: "etapa", titulo: "a", condicao: { areas: ["pessoal"], x: 1 } }).condicao).toEqual({ areas: ["pessoal"] });
    expect(sanitizarBloco({ tipo: "etapa", titulo: "a", condicao: { areas: [] } }).condicao).toBeUndefined();
  });

  it("bloco sanitizado continua resolvendo em item com prazo", () => {
    const b = sanitizarBloco({ tipo: "documento", titulo: "Contrato social", prazo: { ref: "assinatura", dias: 3, uteis: true } });
    const itens = resolverItens({ blocos: [b] }, {}, "2026-10-05");
    expect(itens[0].prazoData).toBe("2026-10-08");
  });
});

describe("sanitizarBlocos", () => {
  it("conta os descartados e corta em 80", () => {
    const r = sanitizarBlocos([{ tipo: "etapa", titulo: "ok" }, { tipo: "nada" }, "texto"]);
    expect(r.blocos).toHaveLength(1);
    expect(r.descartados).toBe(2);
    expect(sanitizarBlocos(Array.from({ length: 100 }, () => ({ tipo: "etapa", titulo: "a" }))).blocos).toHaveLength(80);
    expect(sanitizarBlocos("x")).toEqual({ blocos: [], descartados: 0 });
  });
});

describe("resposta do agente", () => {
  it("sanitiza o modelo devolvido e ignora o que não é modelo", () => {
    const r = interpretarResposta({
      mensagem: "Montei.",
      modelo: { nome: "  Simples  ", regras: { enquadramento: ["simples", "ouro"] }, blocos: [{ tipo: "documento", titulo: "CNPJ" }, { tipo: "hack" }] },
      faltando: ["Tem funcionários?"],
      pronto: false,
    });
    expect(r.modelo).toMatchObject({ nome: "Simples", regras: { enquadramento: ["simples"] } });
    expect(r.modelo.blocos).toHaveLength(1);
    expect(r.faltando).toEqual(["Tem funcionários?"]);
    expect(interpretarResposta({ mensagem: "Qual o porte?" }).modelo).toBeNull();
    expect(interpretarResposta({ mensagem: "x", modelo: { nome: "sem blocos" } }).modelo).toBeNull();
  });

  it("o prompt carrega a base de conhecimento e o rascunho atual", () => {
    const p = promptSistema({ conhecimento: "Pedimos balancete anterior.", modelo: { nome: "Rascunho X", blocos: [] } });
    expect(p).toContain("Pedimos balancete anterior.");
    expect(p).toContain("Rascunho X");
    expect(CONHECIMENTO_PADRAO.length).toBeGreaterThan(100);
  });
});

describe("lembretes de prazo", () => {
  const doc = (id: string, prazoData: string, extra = {}) => ({ id, tipo: "documento", titulo: id, obrigatorio: true, prazoData, ...extra });

  it("marcos: 2 dias antes, no dia e 1, 3, 7 depois", () => {
    expect(MARCOS_LEMBRETE).toEqual([-2, 0, 1, 3, 7]);
  });

  it("não avisa antes da hora", () => {
    expect(lembretesDevidos([doc("a", "2026-10-20")], {}, "2026-10-10")).toEqual([]);
    expect(lembretesDevidos([doc("a", "2026-10-20")], {}, "2026-10-17")).toEqual([]);
  });

  it("avisa 2 dias antes, no dia e depois do prazo", () => {
    const it = [doc("a", "2026-10-20")];
    expect(lembretesDevidos(it, {}, "2026-10-18")[0]).toMatchObject({ marco: -2, dias: -2, chave: "a:-2" });
    expect(lembretesDevidos(it, {}, "2026-10-20")[0].marco).toBe(0);
    expect(lembretesDevidos(it, {}, "2026-10-21")[0].marco).toBe(1);
    expect(lembretesDevidos(it, {}, "2026-10-24")[0].marco).toBe(3);
    expect(lembretesDevidos(it, {}, "2026-10-27")[0].marco).toBe(7);
  });

  it("depois de um fim de semana manda UM lembrete, o do marco mais recente", () => {
    const r = lembretesDevidos([doc("a", "2026-10-16")], {}, "2026-10-20");
    expect(r).toHaveLength(1);
    expect(r[0].marco).toBe(3);
  });

  it("não repete o que já foi enviado, mas segue para o próximo marco", () => {
    const it = [doc("a", "2026-10-20")];
    expect(lembretesDevidos(it, {}, "2026-10-20", new Set(["a:0"]))).toEqual([]);
    expect(lembretesDevidos(it, {}, "2026-10-21", new Set(["a:0"]))[0].marco).toBe(1);
  });

  it("não cobra o que já foi enviado ou aprovado; cobra o reprovado", () => {
    const it = [doc("a", "2026-10-20"), doc("b", "2026-10-20"), doc("c", "2026-10-20")];
    const r = lembretesDevidos(it, { a: "enviado", b: "aprovado", c: "reprovado" }, "2026-10-21");
    expect(r.map((x: { item: { id: string } }) => x.item.id)).toEqual(["c"]);
  });

  it("ignora opcional, item sem prazo e o que não é documento", () => {
    const it = [doc("a", "2026-10-20", { obrigatorio: false }), { id: "b", tipo: "documento", obrigatorio: true, prazoData: null }, { id: "c", tipo: "etapa", titulo: "x" }];
    expect(lembretesDevidos(it, {}, "2026-10-25")).toEqual([]);
  });

  it("texto do prazo", () => {
    expect(situacaoDoPrazo(-2, "2026-10-20")).toBe("vence em 20/10/2026");
    expect(situacaoDoPrazo(0, "2026-10-20")).toBe("vence hoje");
    expect(situacaoDoPrazo(1, "2026-10-20")).toBe("venceu em 20/10/2026 (1 dia de atraso)");
    expect(situacaoDoPrazo(3, "2026-10-20")).toContain("3 dias de atraso");
  });
});
