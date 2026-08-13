/**
 * Aviso de "documento novo" é uma ALLOWLIST: só núcleo + folha + Programação de Férias
 * avisam; toda outra guia/DARF entra calada. Trava o incidente de 13/08/2026 (INSS GPS
 * antigo e DARF de IRRF código 0561 anunciados como novidade).
 */
import { describe, it, expect } from "vitest";
import {
  avisaDocumentoNovo,
  ehProgramacaoFerias,
  DOC_TYPE_QUE_AVISA,
} from "../../api/src/gclick/avisoDocumento.js";

describe("avisaDocumentoNovo — allowlist", () => {
  it("avisa o núcleo (FGTS, DAS, INSS via DCTF Web)", () => {
    expect(avisaDocumentoNovo("FGTS")).toBe(true);
    expect(avisaDocumentoNovo("DAS")).toBe(true);
    expect(avisaDocumentoNovo("DCTF_WEB")).toBe(true);
  });

  it("avisa folha (recibo e extrato)", () => {
    expect(avisaDocumentoNovo("RECIBO_PAGTO")).toBe(true);
    expect(avisaDocumentoNovo("EXTRATO_FOLHA")).toBe(true);
  });

  it("NÃO avisa INSS-GPS, ICMS, ISS", () => {
    expect(avisaDocumentoNovo("INSS")).toBe(false);
    expect(avisaDocumentoNovo("ICMS")).toBe(false);
    expect(avisaDocumentoNovo("ISS")).toBe(false);
  });

  it("NÃO avisa IRRF nem DARF avulso nem guia não classificada (doc_type nulo)", () => {
    // O caso do PDF: DARF de IRRF código 0561 chega sem doc_type conhecido.
    expect(avisaDocumentoNovo(null, "GuiaPagamento_53559972000187")).toBe(false);
    expect(avisaDocumentoNovo("IRRF")).toBe(false);
    expect(avisaDocumentoNovo(null, "Documento de Arrecadação de Receitas Federais")).toBe(false);
    expect(avisaDocumentoNovo(undefined, "")).toBe(false);
  });

  it("avisa Programação de Férias pelo título (sem doc_type)", () => {
    expect(avisaDocumentoNovo(null, "Programação de Férias 2026")).toBe(true);
    expect(avisaDocumentoNovo(null, "Anexar Programacao de Ferias")).toBe(true);
  });
});

describe("ehProgramacaoFerias — tolerante a ordem e encoding", () => {
  it("reconhece variações", () => {
    expect(ehProgramacaoFerias("Programação de Férias")).toBe(true);
    expect(ehProgramacaoFerias("Programacao de Ferias")).toBe(true);
    expect(ehProgramacaoFerias("Férias — Programação anual")).toBe(true);
  });
  it("não confunde outros documentos", () => {
    expect(ehProgramacaoFerias("Recibo de Férias")).toBe(false); // tem férias, não tem programa
    expect(ehProgramacaoFerias("GuiaPagamento IRRF")).toBe(false);
    expect(ehProgramacaoFerias("")).toBe(false);
  });

  it("a allowlist de doc_type é exatamente núcleo + folha", () => {
    expect([...DOC_TYPE_QUE_AVISA].sort()).toEqual([
      "DAS",
      "DCTF_WEB",
      "EXTRATO_FOLHA",
      "FGTS",
      "RECIBO_PAGTO",
    ]);
  });
});
