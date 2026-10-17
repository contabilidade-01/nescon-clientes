/**
 * Regras de ouro antes de cobrar (cobrancaRegras.js):
 *  1. início de cobrança — vencimento em fim de semana/feriado rola para o próximo dia
 *     bancário, espera 1 dia bancário de compensação, cobra no dia bancário seguinte;
 *  2. consulta ativa na Cora — só cobra o que a Cora confirma em aberto (falha fechada).
 */
import { describe, it, expect, vi } from "vitest";
import {
  calendarioCobranca,
  liberadoParaCobrar,
  situacaoNaCora,
  consultaAtivaCora,
  COMPENSACAO_DIAS_BANCARIOS,
} from "../../api/src/cobrancaRegras.js";
import * as cora from "../../api/src/cora.js";

describe("calendarioCobranca — início de cobrança", () => {
  it("padrão: 1 dia bancário de compensação", () => {
    expect(COMPENSACAO_DIAS_BANCARIOS).toBe(1);
  });

  it("caso real: venc. sáb 10/10/2026, seg 12/10 é feriado → paga até ter 13, compensa qua 14, cobra qui 15", () => {
    expect(calendarioCobranca("2026-10-10")).toEqual({
      vencimento: "2026-10-10",
      ultimoDiaPagamento: "2026-10-13",
      fimCompensacao: "2026-10-14",
      inicioCobranca: "2026-10-15",
      vencimentoRolou: true,
    });
  });

  it("sábado sem feriado na segunda: paga seg, compensa ter, cobra qua", () => {
    // sáb 03/10/2026 → seg 05, ter 06, qua 07
    const c = calendarioCobranca("2026-10-03");
    expect(c.ultimoDiaPagamento).toBe("2026-10-05");
    expect(c.fimCompensacao).toBe("2026-10-06");
    expect(c.inicioCobranca).toBe("2026-10-07");
  });

  it("domingo: mesma sistemática do sábado", () => {
    const c = calendarioCobranca("2026-10-04");
    expect(c.ultimoDiaPagamento).toBe("2026-10-05");
    expect(c.inicioCobranca).toBe("2026-10-07");
  });

  it("sexta-feira útil: paga sex, compensa seg, cobra ter", () => {
    const c = calendarioCobranca("2026-10-02");
    expect(c.vencimentoRolou).toBe(false);
    expect(c.ultimoDiaPagamento).toBe("2026-10-02");
    expect(c.fimCompensacao).toBe("2026-10-05");
    expect(c.inicioCobranca).toBe("2026-10-06");
  });

  it("feriado no meio da semana: Finados seg 02/11/2026 rola para ter 03, cobra qui 05", () => {
    const c = calendarioCobranca("2026-11-02");
    expect(c.ultimoDiaPagamento).toBe("2026-11-03");
    expect(c.fimCompensacao).toBe("2026-11-04");
    expect(c.inicioCobranca).toBe("2026-11-05");
  });

  it("feriado na compensação também empurra: venc. qui 19/11/2026, sex 20/11 é Consciência Negra", () => {
    const c = calendarioCobranca("2026-11-19");
    expect(c.ultimoDiaPagamento).toBe("2026-11-19");
    expect(c.fimCompensacao).toBe("2026-11-23");
    expect(c.inicioCobranca).toBe("2026-11-24");
  });

  it("data inválida → null", () => {
    expect(calendarioCobranca("")).toBeNull();
    expect(calendarioCobranca("2026-02-31")).toBeNull();
  });
});

describe("liberadoParaCobrar", () => {
  it("explica o motivo enquanto ainda não pode cobrar", () => {
    expect(liberadoParaCobrar("2026-10-10", "2026-10-13").motivo).toContain("prazo de pagamento");
    expect(liberadoParaCobrar("2026-10-10", "2026-10-14").motivo).toContain("compensação");
    expect(liberadoParaCobrar("2026-10-10", "2026-10-12").motivo).toContain("feriado");
    expect(liberadoParaCobrar("2026-10-10", "2026-10-15").liberado).toBe(true);
  });
});

describe("situacaoNaCora", () => {
  it("lê os status da Cora", () => {
    expect(situacaoNaCora({ status: "OPEN" }, cora)).toBe("aberto");
    expect(situacaoNaCora({ status: "LATE" }, cora)).toBe("aberto");
    expect(situacaoNaCora({ status: "PAID" }, cora)).toBe("pago");
    expect(situacaoNaCora({ status: "IN_PAYMENT" }, cora)).toBe("em_processamento");
    expect(situacaoNaCora({ status: "CANCELLED" }, cora)).toBe("cancelado");
  });

  it("qualquer sinal de pagamento vence o status em aberto", () => {
    expect(situacaoNaCora({ status: "LATE", total_paid: 50000 }, cora)).toBe("pago");
    expect(situacaoNaCora({ status: "OPEN", payments: [{ id: "p1" }] }, cora)).toBe("pago");
  });

  it("sem resposta ou status desconhecido → indeterminado", () => {
    expect(situacaoNaCora(null, cora)).toBe("indeterminado");
    expect(situacaoNaCora({}, cora)).toBe("indeterminado");
    expect(situacaoNaCora({ status: "ALGO_NOVO" }, cora)).toBe("indeterminado");
  });
});

describe("consultaAtivaCora — falha fechada", () => {
  const dep = (detalhe: unknown) => ({ ...cora, getInvoiceDetail: vi.fn(async () => detalhe) });

  it("só cobra o que a Cora confirma em aberto, consultando pelo id do boleto", async () => {
    const d = dep({ status: "LATE" });
    const r = await consultaAtivaCora("cora_inv_123", d);
    expect(r.cobrar).toBe(true);
    expect(d.getInvoiceDetail).toHaveBeenCalledWith("inv_123");
  });

  it("pago, em processamento, sem resposta, erro ou sem vínculo → não cobra", async () => {
    expect((await consultaAtivaCora("cora_x", dep({ status: "PAID" }))).cobrar).toBe(false);
    expect((await consultaAtivaCora("cora_x", dep({ status: "IN_PAYMENT" }))).cobrar).toBe(false);
    expect((await consultaAtivaCora("cora_x", dep(null))).cobrar).toBe(false);
    const quebrada = { ...cora, getInvoiceDetail: vi.fn(async () => { throw new Error("timeout"); }) };
    expect((await consultaAtivaCora("cora_x", quebrada)).cobrar).toBe(false);
    const semVinculo = dep({ status: "OPEN" });
    const r = await consultaAtivaCora(null, semVinculo);
    expect(r.cobrar).toBe(false);
    expect(semVinculo.getInvoiceDetail).not.toHaveBeenCalled();
  });
});
