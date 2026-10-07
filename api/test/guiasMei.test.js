process.env.UPLOAD_DIR = require("node:os").tmpdir() + "/guias-mei-teste";
const test = require("node:test");
const assert = require("node:assert/strict");
const { competenciaBr, dataIso, montarCaption, validarPedido } = require("../src/guiasMei");

const PDF = Buffer.from("%PDF-1.4 teste").toString("base64");
const base = {
  cnpj: "11.222.333/0001-81", tipo: "DAS_MEI", competencia: "202609",
  external_ref: "mei:1", pdf_base64: PDF,
};

test("competenciaBr e dataIso", () => {
  assert.equal(competenciaBr("202609"), "09/2026");
  assert.equal(dataIso("20261020"), "2026-10-20");
  assert.equal(dataIso("20261340"), null);
  assert.equal(dataIso("abc"), null);
});

test("caption traz tipo, competência, vencimento e valor", () => {
  const t = montarCaption({ nomeEmpresa: "ALFA", tipo: "DAS_MEI", competencia: "202609", vencimento: "2026-10-20", valor: 71.6 });
  assert.match(t, /DAS MEI de ALFA/);
  assert.match(t, /Competência: 09\/2026/);
  assert.match(t, /Vencimento: 20\/10\/2026/);
  assert.match(t, /R\$\s?71,60/);
});

test("validarPedido aceita pedido correto e normaliza o CNPJ", () => {
  const r = validarPedido({ ...base, vencimento: "20261020", valor: "71.6" });
  assert.equal(r.erro, undefined);
  assert.equal(r.dados.cnpj, "11222333000181");
  assert.equal(r.dados.vencimento, "2026-10-20");
  assert.equal(r.dados.valor, 71.6);
});

test("validarPedido recusa o que não é PDF, tipo, competência e ref", () => {
  assert.ok(validarPedido({ ...base, pdf_base64: Buffer.from("nao e pdf").toString("base64") }).erro);
  assert.ok(validarPedido({ ...base, tipo: "DAS_SN" }).erro);
  assert.ok(validarPedido({ ...base, competencia: "202613" }).erro);
  assert.ok(validarPedido({ ...base, external_ref: "" }).erro);
  assert.ok(validarPedido({ ...base, cnpj: "123" }).erro);
  assert.ok(validarPedido({ ...base, vencimento: "20261399" }).erro);
});
