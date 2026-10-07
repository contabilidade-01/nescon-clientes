/**
 * PDF de amostra da proposta para conferência visual (PROPOSTA_PDF_AMOSTRA=caminho).
 * Sem a variável, só confere que o gerador roda e que a proposta cabe em 1–3 páginas.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { gerarContratoPdf } from "../lib/generateContratoPdf";
import { CATALOGO_PADRAO, aplicarPacote, aplicarPatch, metaPropostaPdf, montarProposta, propostaNova } from "../lib/propostaModelo";

const cat = CATALOGO_PADRAO;

function amostra() {
  let d = propostaNova(cat);
  d.cliente = { ...d.cliente, nome: "João da Silva 12345678900", cnpj: "12.345.678/0001-90", tratamento: "Sr.", contato: "João da Silva", enquadramento: "mei", situacao: "MEI com DASN de 2022 a 2024 em atraso e R$ 8.000,00 em guias DAS vencidas." };
  d.cabecalho.data = "2026-10-07";
  d = aplicarPacote(d, cat, "mei_regularizacao");
  d = aplicarPatch(d, { alterar: [{ codigo: "dasn_atraso", quantidade: 3 }, { codigo: "recalculo_das_mei", quantidade: 18 }, { codigo: "parc_mei", modo: "percentual", base: 8000, percentual: 5, minimo: 150 }] }, cat).dados;
  d = aplicarPatch(d, { adicionar: [{ codigo: "certificado_ecpf" }, { codigo: "abertura_empresa" }], condicoes: { reajuste: "Reajuste anual pelo IPCA a partir de janeiro de 2028." } }, cat).dados;
  return d;
}

describe("PDF da proposta", () => {
  it("gera e cabe em poucas páginas", () => {
    const d = amostra();
    const pdf = gerarContratoPdf(montarProposta(d, cat.padroes), metaPropostaPdf(d, cat.padroes));
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(pdf.getNumberOfPages()).toBeLessThanOrEqual(4);
    const out = process.env.PROPOSTA_PDF_AMOSTRA;
    if (out) writeFileSync(out, Buffer.from(pdf.output("arraybuffer")));
  });
});
