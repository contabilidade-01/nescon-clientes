const test = require("node:test");
const assert = require("node:assert/strict");

process.env.UPLOAD_DIR = require("node:os").tmpdir() + "/boleto-pdf-anexo-teste";
const { enviarBoletosPdf } = require("../src/boletoPdf");

const ID = "11111111-1111-4111-8111-111111111111";
const linha = { id: ID, external_ref: "cora_abc", pdf_url: null, valor_centavos: 35000, is_honorario: true, venc: "10/11/2026", empresa: "ACME" };
const dbFalso = (rows) => ({ query: async () => ({ rows }) });

test("PDF falha na 1ª tentativa (Cora fora), repete e anexa", async () => {
  let chamadas = 0;
  const enviados = [];
  const cora = {
    isConfigured: () => true,
    getInvoiceDetail: async () => {
      chamadas += 1;
      if (chamadas === 1) throw new Error("HTTP 503");
      return { payment_options: { bank_slip: { url: "https://cora/pdf" } } };
    },
  };
  const uazapi = { configurado: () => true, enviarDocumento: async (a) => enviados.push(a) };
  const r = await enviarBoletosPdf(dbFalso([linha]), { companyId: "c1", obrigacoes: [`BOLETO:${ID}`], numero: "5511999999999", delayMs: 0 }, { cora, uazapi });
  assert.equal(r.enviados, 1);
  assert.equal(r.erros.length, 0);
  assert.equal(enviados[0].fileUrl, "https://cora/pdf");
});

test("sem PDF mesmo após repetir: devolve erro para o escritório ser avisado", async () => {
  const cora = { isConfigured: () => true, getInvoiceDetail: async () => ({}) };
  const uazapi = { configurado: () => true, enviarDocumento: async () => { throw new Error("não deveria enviar"); } };
  const r = await enviarBoletosPdf(dbFalso([linha]), { companyId: "c1", obrigacoes: [`BOLETO:${ID}`], numero: "5511999999999", delayMs: 0 }, { cora, uazapi });
  assert.equal(r.enviados, 0);
  assert.equal(r.erros.length, 1);
  assert.match(r.erros[0].motivo, /sem PDF/);
});

test("boleto citado no alerta mas não encontrado também conta como falha de anexo", async () => {
  const cora = { isConfigured: () => true, getInvoiceDetail: async () => ({}) };
  const uazapi = { configurado: () => true, enviarDocumento: async () => {} };
  const r = await enviarBoletosPdf(dbFalso([]), { companyId: "c1", obrigacoes: [`BOLETO:${ID}`], numero: "5511999999999", delayMs: 0 }, { cora, uazapi });
  assert.equal(r.erros.length, 1);
});
