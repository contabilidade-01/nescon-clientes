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

import { casarCertificado } from "@/lib/certificadoDigital";

describe("casarCertificado", () => {
  const empresas = [
    { company_id: "1", cnpj: "35.736.034/0001-23", name: "NESCON SERVICOS EMPRESARIAIS LTDA" },
    { company_id: "2", cnpj: "08431324856", name: "PAULO CÉLIA" },
    { company_id: "3", cnpj: "39492114000131", name: "MARIA NATALIA ARAUJO MATIAS 37019713823" },
    { company_id: "4", cnpj: "47742894000159", name: "47.742.894 MARCO ANTONIO FERENSI FILHO" },
  ];
  it("e-CNPJ pelo CNPJ", () => {
    expect(casarCertificado(empresas, { doc: "35736034000123", titular: "e_cnpj", nome: "X" })?.company_id).toBe("1");
    expect(casarCertificado(empresas, { doc: "11111111000111", titular: "e_cnpj", nome: "X" })).toBeNull();
  });
  it("e-CPF pelo CPF no cadastro, no nome ou pelo nome igual", () => {
    expect(casarCertificado(empresas, { doc: "08431324856", titular: "e_cpf", nome: "PAULO" })?.company_id).toBe("2");
    expect(casarCertificado(empresas, { doc: "37019713823", titular: "e_cpf", nome: "M" })?.company_id).toBe("3");
    expect(
      casarCertificado(empresas, { doc: "46623343814", titular: "e_cpf", nome: "MARCO ANTONIO FERENSI FILHO" })?.company_id
    ).toBe("4");
    expect(casarCertificado(empresas, { doc: "99999999999", titular: "e_cpf", nome: "FULANO" })).toBeNull();
  });
});
