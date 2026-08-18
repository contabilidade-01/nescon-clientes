/**
 * Cobrança de honorários em 2 fases (motor próprio).
 *
 * Cobre a régua nova: 1ª cobrança só após carência de compensação (D+2 dias úteis),
 * 2ª cobrança +3 dias (fase 1, firme), depois a cada 10 dias (fase 2, empática) até pagar.
 * A metodologia só vale a partir de set/2026 (testado via a constante exposta).
 */
import { describe, it, expect } from "vitest";
import {
  decidirCobranca,
  montarMensagemHonorario,
  faseDe,
  competenciaBR,
  diasDesde,
  cadencia,
} from "../../api/src/honorariosCobranca.js";
import { diasUteisAposVencimento } from "../../api/src/alertas.js";

describe("faseDe (fase por contagem de mensagens)", () => {
  it("as 2 primeiras são fase 1; da 3ª em diante, fase 2", () => {
    expect(faseDe(0)).toBe(1);
    expect(faseDe(1)).toBe(1);
    expect(faseDe(2)).toBe(2);
    expect(faseDe(9)).toBe(2);
  });
});

describe("decidirCobranca — cadência", () => {
  it("1ª cobrança respeita a carência de compensação (D+2 dias úteis)", () => {
    expect(decidirCobranca({ count: 0, diasUteisAtraso: 1, diasDesdeUltimoEnvio: Infinity }).cobrar).toBe(false);
    const ok = decidirCobranca({ count: 0, diasUteisAtraso: 2, diasDesdeUltimoEnvio: Infinity });
    expect(ok.cobrar).toBe(true);
    expect(ok.fase).toBe(1);
  });

  it("2ª cobrança (fase 1) só depois de 3 dias da 1ª", () => {
    expect(decidirCobranca({ count: 1, diasUteisAtraso: 5, diasDesdeUltimoEnvio: 2 }).cobrar).toBe(false);
    const ok = decidirCobranca({ count: 1, diasUteisAtraso: 5, diasDesdeUltimoEnvio: 3 });
    expect(ok.cobrar).toBe(true);
    expect(ok.fase).toBe(1);
  });

  it("da 3ª em diante (fase 2) só a cada 10 dias", () => {
    expect(decidirCobranca({ count: 2, diasUteisAtraso: 20, diasDesdeUltimoEnvio: 9 }).cobrar).toBe(false);
    const ok = decidirCobranca({ count: 2, diasUteisAtraso: 20, diasDesdeUltimoEnvio: 10 });
    expect(ok.cobrar).toBe(true);
    expect(ok.fase).toBe(2);
  });

  it("continua na fase 2 indefinidamente (4ª, 5ª… a cada 10 dias)", () => {
    const ok = decidirCobranca({ count: 5, diasUteisAtraso: 60, diasDesdeUltimoEnvio: 10 });
    expect(ok.cobrar).toBe(true);
    expect(ok.fase).toBe(2);
  });
});

describe("montarMensagemHonorario — texto por fase", () => {
  const base = { empresa: "ACME", competencia: "2026-09", valor: "R$ 500,00", venc: "20/09/2026", diasAtraso: 3, portal: "https://portal" };

  it("fase 1: firme, cita 5 dias e bloqueio das entregas", () => {
    const t = montarMensagemHonorario({ ...base, fase: 1 });
    expect(t).toContain("ACME");
    expect(t).toContain("5 dias");
    expect(t.toLowerCase()).toContain("suspensão");
    expect(t).toContain("09/2026");
    expect(t).toContain("https://portal/boletos");
  });

  it("fase 2: empática, cita estrutura de custos e juros", () => {
    const t = montarMensagemHonorario({ ...base, fase: 2, diasAtraso: 25 });
    expect(t.toLowerCase()).toContain("estrutura de custos");
    expect(t.toLowerCase()).toContain("juros");
    expect(t.toLowerCase()).toContain("retomamos");
  });
});

describe("helpers", () => {
  it("competenciaBR: 2026-09 → 09/2026", () => {
    expect(competenciaBR("2026-09")).toBe("09/2026");
    expect(competenciaBR(null)).toBe("");
  });
  it("diasDesde: null é Infinity", () => {
    expect(diasDesde(null)).toBe(Infinity);
  });
});

describe("início da metodologia (set/2026)", () => {
  it("a constante de início está travada em setembro/2026", () => {
    expect(cadencia.INICIO_ISO).toBe("2026-09-01");
    expect(cadencia.COMPETENCIA_MIN).toBe("2026-09");
  });
});

describe("diasUteisAposVencimento (carência)", () => {
  it("vencimento sábado conta a partir da segunda (1º dia útil)", () => {
    // ago/2026: sáb 15, seg 17, ter 18, qua 19
    expect(diasUteisAposVencimento("2026-08-15", "2026-08-17")).toBe(0);
    expect(diasUteisAposVencimento("2026-08-15", "2026-08-18")).toBe(1);
    expect(diasUteisAposVencimento("2026-08-15", "2026-08-19")).toBe(2);
  });
});
