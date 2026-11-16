/**
 * Baixa automática de guias pelo relatório do e-CAC — regras puras.
 *
 * Caso real que motivou (16/11/2026): RESTAURANTE DO QUEIJEIRO 3 com DAS, DCTF Web e
 * FGTS de agosto e setembro "Em atraso" no portal, já pagos. O que precisa ser provado:
 *  - competência ausente do relatório bom → baixa (DAS e INSS);
 *  - FGTS nunca baixa pelo relatório da Receita (não aparece lá);
 *  - relatório ruim (sem leitura, velho, anterior ao vencimento, parcelamento/PGFN) não
 *    baixa nada;
 *  - débito do mesmo período, ou declaração omissa, segura a guia;
 *  - a competência do G-Click é o mês de pagamento: o PA é o mês anterior ao vencimento.
 */
import { describe, it, expect } from "vitest";
import {
  avaliarGuia,
  periodoDaGuia,
  debitoEhDoTipo,
  omissoesQueBloqueiam,
} from "../../api/src/ecacBaixaAuto.js";

const HOJE = "2026-11-16";

const guia = (extra: Record<string, unknown> = {}) => ({
  id: "g1", company_id: "c1", doc_type: "DAS", status: "pending", competencia: "2026-08",
  due_date: "2026-08-20", baixa_auto_bloqueada: false, ...extra,
});

const relatorio = (extra: Record<string, unknown> = {}) => ({
  id: 7, relatorio_id: 900, relatorio_data: "2026-11-05T09:00:00-03:00", relatorio_situacao: "ATIVA",
  debitos: [] as unknown[], omissoes: [] as unknown[], parcelamento: null, pgfn: null, ...extra,
});

const sn = (pa: string) => ({ tipo: "SN", receita: "SIMPLES NAC.", periodo_apuracao: pa, saldo_devedor_total: 500, situacao: "DEVEDOR" });
const cp = (pa: string) => ({ tipo: "INSS", receita: "1138-01 - CP-SEGURADOS", periodo_apuracao: pa, saldo_devedor_total: 300, situacao: "DEVEDOR" });

describe("período de apuração da guia", () => {
  it("é o mês anterior ao vencimento (competência do G-Click é o mês de pagamento)", () => {
    expect(periodoDaGuia(guia()).periodo).toBe("202607");
    expect(periodoDaGuia(guia({ competencia: "2026-01", due_date: "2026-01-20" })).periodo).toBe("202512");
  });
  it("competência que não bate com o vencimento deixa a guia de fora", () => {
    const r = periodoDaGuia(guia({ competencia: "2026-07" }));
    expect(r.periodo).toBeNull();
  });
});

describe("caso do Queijeiro: relatório limpo e recente", () => {
  it("DAS e INSS de agosto e setembro são baixados", () => {
    for (const g of [
      guia(),
      guia({ doc_type: "DCTF_WEB" }),
      guia({ competencia: "2026-09", due_date: "2026-09-18", doc_type: "DCTF_WEB" }),
    ]) {
      const r = avaliarGuia(g, relatorio(), { hoje: HOJE });
      expect(r.baixar).toBe(true);
    }
  });
  it("FGTS fica em aberto: não consta no relatório da Receita", () => {
    const r = avaliarGuia(guia({ doc_type: "FGTS" }), relatorio(), { hoje: HOJE });
    expect(r.baixar).toBe(false);
    expect(r.motivo).toMatch(/FGTS/);
  });
});

describe("débito ou omissão do mesmo período segura a guia", () => {
  it("DAS com SIMPLES NAC. 07/2026 no relatório não baixa; outro mês não segura", () => {
    expect(avaliarGuia(guia(), relatorio({ debitos: [sn("07/2026")] }), { hoje: HOJE }).baixar).toBe(false);
    expect(avaliarGuia(guia(), relatorio({ debitos: [sn("06/2026")] }), { hoje: HOJE }).baixar).toBe(true);
  });
  it("INSS do período segura a DCTF Web, mas não o DAS", () => {
    const rel = relatorio({ debitos: [cp("07/2026")] });
    expect(avaliarGuia(guia({ doc_type: "DCTF_WEB" }), rel, { hoje: HOJE }).baixar).toBe(false);
    expect(avaliarGuia(guia(), rel, { hoje: HOJE }).baixar).toBe(true);
  });
  it("IRRF com data longa do mesmo mês também segura a DCTF Web", () => {
    const irrf = { tipo: "IRRF", receita: "0561-07 - IRRF", periodo_apuracao: "31/07/2026" };
    expect(avaliarGuia(guia({ doc_type: "DCTF_WEB" }), relatorio({ debitos: [irrf] }), { hoje: HOJE }).baixar).toBe(false);
  });
  it("MAED não é a guia: não segura nada", () => {
    expect(debitoEhDoTipo("DCTF_WEB", { tipo: "MAED", receita: "MAED" })).toBe(false);
  });
  it("omissão de PGDAS-D/DCTFWeb no mês (ou no ano todo) segura", () => {
    expect(avaliarGuia(guia(), relatorio({ omissoes: [{ tipo: "PGDAS-D", ano: "2026", meses: ["JUL"] }] }), { hoje: HOJE }).baixar).toBe(false);
    expect(avaliarGuia(guia({ doc_type: "DCTF_WEB" }), relatorio({ omissoes: [{ tipo: "DCTFWeb", ano: "2026", meses: [] }] }), { hoje: HOJE }).baixar).toBe(false);
    expect(omissoesQueBloqueiam("DAS", "202607", [{ tipo: "PGDAS-D", ano: "2026", meses: ["AGO"] }])).toHaveLength(0);
  });
});

describe("relatório ruim não baixa nada", () => {
  const casos: Array<[string, unknown]> = [
    ["sem relatório", null],
    ["PDF não lido (sem situação)", relatorio({ relatorio_situacao: "" })],
    ["relatório velho", relatorio({ relatorio_data: "2026-09-01T09:00:00-03:00" })],
    ["relatório anterior ao vencimento", relatorio({ relatorio_data: "2026-08-19T09:00:00-03:00" })],
    ["parcelamento", relatorio({ parcelamento: "SIMPLES NACIONAL - EM PARCELAMENTO" })],
    ["PGFN", relatorio({ pgfn: "Inscrição 80 1 26 000123-45" })],
  ];
  for (const [nome, rel] of casos) {
    it(nome, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(avaliarGuia(guia(), rel as any, { hoje: HOJE }).baixar).toBe(false);
    });
  }
  it("idade máxima é configurável", () => {
    const rel = relatorio({ relatorio_data: "2026-09-20T09:00:00-03:00" });
    expect(avaliarGuia(guia(), rel, { hoje: HOJE, maxIdadeDias: 40 }).baixar).toBe(false);
    expect(avaliarGuia(guia(), rel, { hoje: HOJE, maxIdadeDias: 60 }).baixar).toBe(true);
  });
});

describe("guia fora do alcance", () => {
  it("não vencida, já paga ou reaberta depois de baixa automática ficam como estão", () => {
    expect(avaliarGuia(guia({ due_date: "2026-11-20", competencia: "2026-11" }), relatorio(), { hoje: HOJE }).baixar).toBe(false);
    expect(avaliarGuia(guia({ status: "paid" }), relatorio(), { hoje: HOJE }).baixar).toBe(false);
    expect(avaliarGuia(guia({ baixa_auto_bloqueada: true }), relatorio(), { hoje: HOJE }).baixar).toBe(false);
    expect(avaliarGuia(guia({ doc_type: "PARCELAMENTO" }), relatorio(), { hoje: HOJE }).baixar).toBe(false);
  });
});
