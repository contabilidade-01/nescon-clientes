import { describe, it, expect } from "vitest";
import { tituloVigencia } from "@/components/hub/CertificadoVigenciaCard";
import type { CertificadoPortal } from "@/lib/api";

const base = (vence_em: string, status: CertificadoPortal["status"]): CertificadoPortal => ({
  dias_aviso: 30,
  status,
  certificado: {
    id: "1", tipo: "a1", titular: "e_cnpj", emissor: null, emitido_em: null, vence_em,
    origem: "escritorio", updated_at: "", status, dias_restantes: 10,
  },
});

describe("tituloVigencia", () => {
  it("mostra a validade quando está em dia ou a vencer", () => {
    expect(tituloVigencia(base("2027-06-03", "ativo"))).toBe("Certificado digital válido até 03/06/2027");
    expect(tituloVigencia(base("2026-12-02", "a_vencer"))).toBe("Certificado digital válido até 02/12/2026");
  });
  it("diz quando venceu", () => {
    expect(tituloVigencia(base("2026-01-10", "vencido"))).toBe("Certificado digital venceu em 10/01/2026");
  });
  it("sem cadastro", () => {
    expect(tituloVigencia({ dias_aviso: 30, status: "ausente", certificado: null })).toBe(
      "Certificado digital sem validade cadastrada"
    );
  });
});
