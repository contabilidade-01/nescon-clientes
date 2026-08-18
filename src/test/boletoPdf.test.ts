/**
 * Anexo de boleto (PDF) nos alertas automáticos.
 *
 * Cobre o que o Jean pediu: lembrete E vencido saem com o boleto PDF, buscado FRESCO na
 * Cora, e sem que uma falha do anexo derrube o alerta de texto (best-effort).
 */
import { describe, it, expect } from "vitest";
import { idsDeBoleto, enviarBoletosPdf } from "../../api/src/boletoPdf.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("idsDeBoleto", () => {
  it("extrai UUIDs de códigos BOLETO: em array", () => {
    expect(idsDeBoleto([`BOLETO:${UUID_A}`, "DAS", `BOLETO:${UUID_B}`])).toEqual([UUID_A, UUID_B]);
  });

  it("extrai de CSV (formato da fila alert_outbox)", () => {
    expect(idsDeBoleto(`FGTS,BOLETO:${UUID_A}`)).toEqual([UUID_A]);
  });

  it("ignora não-boletos e uuid malformado (protege o cast ::uuid[])", () => {
    expect(idsDeBoleto(["DAS", "BOLETO:xyz", "FERIAS_LIMITE"])).toEqual([]);
  });
});

// db falso: devolve as linhas cravadas para qualquer query.
function fakeDb(rows: any[]) {
  return { query: async () => ({ rows }) };
}

const coraOk = {
  isConfigured: () => true,
  getInvoiceDetail: async (id: string) => ({
    payment_options: { bank_slip: { url: `https://cora/fresh/${id}.pdf` } },
  }),
};

describe("enviarBoletosPdf", () => {
  it("anexa o PDF com URL FRESCA da Cora (não a gravada)", async () => {
    const enviados: any[] = [];
    const uazapi = {
      configurado: () => true,
      enviarDocumento: async (p: any) => enviados.push(p),
    };
    const db = fakeDb([
      { id: UUID_A, external_ref: "cora_INV1", pdf_url: "https://cora/OLD.pdf",
        valor_centavos: 15000, is_honorario: false, venc: "20/08/2026", empresa: "ACME" },
    ]);

    const r = await enviarBoletosPdf(
      db as any,
      { companyId: "c1", obrigacoes: [`BOLETO:${UUID_A}`], numero: "5511999" },
      { cora: coraOk, uazapi }
    );

    expect(r.enviados).toBe(1);
    expect(enviados).toHaveLength(1);
    // Buscou a URL fresca (cora_INV1 -> INV1), não a gravada.
    expect(enviados[0].fileUrl).toBe("https://cora/fresh/INV1.pdf");
    expect(enviados[0].caption).toContain("ACME");
    expect(enviados[0].caption).toContain("20/08/2026");
  });

  it("rotula honorário como 'Honorários'", async () => {
    const enviados: any[] = [];
    const uazapi = { configurado: () => true, enviarDocumento: async (p: any) => enviados.push(p) };
    const db = fakeDb([
      { id: UUID_A, external_ref: "cora_INV1", pdf_url: null,
        valor_centavos: null, is_honorario: true, venc: "01/08/2026", empresa: "Cliente X" },
    ]);
    await enviarBoletosPdf(db as any, { companyId: "c1", obrigacoes: [`BOLETO:${UUID_A}`], numero: "5511" }, { cora: coraOk, uazapi });
    expect(enviados[0].caption).toContain("Honorários");
  });

  it("cai para o pdf_url gravado quando a Cora não devolve URL", async () => {
    const enviados: any[] = [];
    const uazapi = { configurado: () => true, enviarDocumento: async (p: any) => enviados.push(p) };
    const coraSemUrl = { isConfigured: () => true, getInvoiceDetail: async () => ({ payment_options: {} }) };
    const db = fakeDb([
      { id: UUID_A, external_ref: "cora_INV1", pdf_url: "https://cora/STORED.pdf",
        valor_centavos: 100, is_honorario: false, venc: "20/08/2026", empresa: "ACME" },
    ]);
    await enviarBoletosPdf(db as any, { companyId: "c1", obrigacoes: [`BOLETO:${UUID_A}`], numero: "5511" }, { cora: coraSemUrl, uazapi });
    expect(enviados[0].fileUrl).toBe("https://cora/STORED.pdf");
  });

  it("best-effort: falha do WhatsApp NÃO lança, só registra o erro", async () => {
    const uazapi = {
      configurado: () => true,
      enviarDocumento: async () => { throw new Error("uazapi 500"); },
    };
    const db = fakeDb([
      { id: UUID_A, external_ref: "cora_INV1", pdf_url: "https://cora/x.pdf",
        valor_centavos: 100, is_honorario: false, venc: "20/08/2026", empresa: "ACME" },
    ]);
    const r = await enviarBoletosPdf(db as any, { companyId: "c1", obrigacoes: [`BOLETO:${UUID_A}`], numero: "5511" }, { cora: coraOk, uazapi });
    expect(r.enviados).toBe(0);
    expect(r.erros).toHaveLength(1);
  });

  it("sem boletos na mensagem, não toca em cora/uazapi", async () => {
    let tocou = false;
    const uazapi = { configurado: () => { tocou = true; return true; }, enviarDocumento: async () => {} };
    const r = await enviarBoletosPdf(fakeDb([]) as any, { companyId: "c1", obrigacoes: ["DAS", "FGTS"], numero: "5511" }, { cora: coraOk, uazapi });
    expect(r.enviados).toBe(0);
    expect(tocou).toBe(false);
  });

  it("marca cada anexo no teto/hora via callback", async () => {
    let marcas = 0;
    const uazapi = { configurado: () => true, enviarDocumento: async () => {} };
    const db = fakeDb([
      { id: UUID_A, external_ref: "cora_INV1", pdf_url: "u", valor_centavos: 1, is_honorario: false, venc: "20/08/2026", empresa: "A" },
      { id: UUID_B, external_ref: "cora_INV2", pdf_url: "u", valor_centavos: 1, is_honorario: false, venc: "20/08/2026", empresa: "A" },
    ]);
    await enviarBoletosPdf(
      db as any,
      { companyId: "c1", obrigacoes: [`BOLETO:${UUID_A}`, `BOLETO:${UUID_B}`], numero: "5511", marcar: () => { marcas += 1; } },
      { cora: coraOk, uazapi }
    );
    expect(marcas).toBe(2);
  });
});
