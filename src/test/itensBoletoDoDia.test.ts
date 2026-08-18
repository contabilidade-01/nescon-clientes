/**
 * Gating dos boletos no dia — vencimento (lembrete) vs vencido (cobrança).
 *
 * É a peça que atende ao pedido "não recebe o aviso de vencimento, mas recebe o de
 * vencido" (e o inverso). Como é decisão de régua, é função pura e testada sem banco.
 */
import { describe, it, expect } from "vitest";
import { itensBoletoDoDia } from "../../api/src/alertas.js";

// hoje fixo; boleto que vence amanhã (lembrete a 1 dia) e outro vencido há 3 dias.
const HOJE = "2026-08-14";
const boletoAmanha = { id: "a1", title: "Boleto vence amanhã", valor_centavos: 10000, due_date: "2026-08-15" };
const boletoVencido3 = { id: "b2", title: "Boleto vencido há 3", valor_centavos: 20000, due_date: "2026-08-11" };

const opts = (over = {}) => ({
  hoje: HOJE,
  diasAntes: 1,
  cobrancaDias: [3, 10, 30],
  honorariosCobrancaDias: [1, 3, 5, 10, 15, 30],
  lembreteOn: true,
  cobrancaOn: true,
  ...over,
});

describe("itensBoletoDoDia — os dois canais ligados", () => {
  it("emite lembrete para o que vence amanhã", () => {
    const r = itensBoletoDoDia([boletoAmanha], opts());
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe("BOLETO:a1");
    expect(r[0].diasEmAtraso).toBeNull();
  });

  it("emite cobrança para o vencido que casa com um marco (3 dias)", () => {
    const r = itensBoletoDoDia([boletoVencido3], opts());
    expect(r).toHaveLength(1);
    expect(r[0].diasEmAtraso).toBe(3);
  });

  it("vencido fora dos marcos não gera nada (nunca todo dia)", () => {
    const boletoVencido5 = { ...boletoVencido3, id: "c3", due_date: "2026-08-09" }; // 5 dias
    expect(itensBoletoDoDia([boletoVencido5], opts())).toHaveLength(0);
  });
});

describe("itensBoletoDoDia — canais independentes (o pedido do Jean)", () => {
  it("só vencido: lembrete desligado NÃO avisa o que vence amanhã, mas cobra o vencido", () => {
    const r = itensBoletoDoDia([boletoAmanha, boletoVencido3], opts({ lembreteOn: false }));
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe("BOLETO:b2");
    expect(r[0].diasEmAtraso).toBe(3);
  });

  it("só vencimento: cobrança desligada avisa o que vence amanhã, mas NÃO cobra o vencido", () => {
    const r = itensBoletoDoDia([boletoAmanha, boletoVencido3], opts({ cobrancaOn: false }));
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe("BOLETO:a1");
  });

  it("os dois desligados: nada sai", () => {
    const r = itensBoletoDoDia([boletoAmanha, boletoVencido3], opts({ lembreteOn: false, cobrancaOn: false }));
    expect(r).toHaveLength(0);
  });
});
