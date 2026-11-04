/**
 * Certificado digital: o estado vem da validade (nunca é gravado) e o aviso diz ao
 * cliente o que fazer. Fronteiras: hoje, último dia da janela, primeiro dia fora dela.
 */
import { describe, it, expect } from "vitest";
import {
  certStatusOf,
  diasAte,
  montarAvisoCertificado,
  lerCamposCertificado,
} from "../../api/src/certificadoDigital.js";
import { validateDate, validateString } from "../../api/src/middleware/validate.js";

const hoje = new Date(2026, 10, 4); // 04/11/2026
const JANELA = 30;

describe("certStatusOf", () => {
  it("sem validade é 'ausente'", () => {
    expect(certStatusOf(null, hoje, JANELA)).toBe("ausente");
    expect(certStatusOf("xx", hoje, JANELA)).toBe("ausente");
  });
  it("ontem é 'vencido'; hoje ainda vale e está 'a vencer'", () => {
    expect(certStatusOf("2026-11-03", hoje, JANELA)).toBe("vencido");
    expect(certStatusOf("2026-11-04", hoje, JANELA)).toBe("a_vencer");
  });
  it("último dia da janela é 'a vencer'; o seguinte é 'ativo'", () => {
    expect(certStatusOf("2026-12-04", hoje, JANELA)).toBe("a_vencer");
    expect(certStatusOf("2026-12-05", hoje, JANELA)).toBe("ativo");
  });
});

describe("aviso", () => {
  it("fala dos dias que faltam", () => {
    const t = montarAvisoCertificado({ empresa: "JL METAL LTDA", venceEm: "2026-11-20", hoje });
    expect(diasAte("2026-11-20", hoje)).toBe(16);
    expect(t).toContain("JL METAL LTDA vence em 20/11/2026 (daqui a 16 dias)");
    expect(t).toContain("informe a nova validade no portal");
  });
  it("diz quando já venceu", () => {
    const t = montarAvisoCertificado({ empresa: "X", venceEm: "2026-10-01", hoje });
    expect(t).toContain("venceu em 01/10/2026");
  });
});

describe("lerCamposCertificado", () => {
  const v = { validateDate, validateString };
  it("exige a validade", () => {
    expect(lerCamposCertificado({}, v)).toEqual({ erro: expect.stringContaining("validade") });
  });
  it("recusa emissão depois da validade", () => {
    expect(lerCamposCertificado({ vence_em: "2026-01-01", emitido_em: "2026-02-01" }, v).erro).toBeTruthy();
  });
  it("usa A1 e e-CNPJ por padrão", () => {
    const r = lerCamposCertificado({ vence_em: "2027-05-10" }, v);
    expect(r).toMatchObject({ tipo: "a1", titular: "e_cnpj", vence: "2027-05-10" });
  });
});
