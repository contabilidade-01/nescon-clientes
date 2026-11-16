const test = require("node:test");
const assert = require("node:assert/strict");

// docNotify puxa uazapi/alertas; só as funções puras interessam aqui.
const { diaDoAvisoAdiado, ehFimDeSemana } = require("../src/docNotify");

// 2026-11-06 é sexta; 07 sábado; 08 domingo; 09 segunda.
test("ehFimDeSemana reconhece sábado e domingo", () => {
  assert.equal(ehFimDeSemana("2026-11-07"), true);
  assert.equal(ehFimDeSemana("2026-11-08"), true);
  assert.equal(ehFimDeSemana("2026-11-06"), false);
  assert.equal(ehFimDeSemana("2026-11-09"), false);
});

test("madrugada de dia útil agenda para HOJE", () => {
  assert.equal(diaDoAvisoAdiado(2 * 60 + 39, "2026-11-06"), "2026-11-06");
  assert.equal(diaDoAvisoAdiado(7 * 60 + 59, "2026-11-10"), "2026-11-10");
});

test("depois das 19h agenda para o próximo dia útil", () => {
  assert.equal(diaDoAvisoAdiado(19 * 60, "2026-11-05"), "2026-11-06");
  assert.equal(diaDoAvisoAdiado(23 * 60 + 30, "2026-11-30"), "2026-12-01");
});

test("sexta à noite pula o fim de semana e vai para segunda", () => {
  assert.equal(diaDoAvisoAdiado(20 * 60, "2026-11-06"), "2026-11-09");
});

test("sábado e domingo, a qualquer hora, vão para segunda", () => {
  assert.equal(diaDoAvisoAdiado(2 * 60, "2026-11-07"), "2026-11-09");
  assert.equal(diaDoAvisoAdiado(10 * 60, "2026-11-07"), "2026-11-09");
  assert.equal(diaDoAvisoAdiado(10 * 60, "2026-11-08"), "2026-11-09");
});
