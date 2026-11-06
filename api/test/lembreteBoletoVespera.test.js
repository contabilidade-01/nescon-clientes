const test = require("node:test");
const assert = require("node:assert/strict");

process.env.UPLOAD_DIR = require("node:os").tmpdir() + "/lembrete-boleto-teste";
const { diaDoLembreteBoleto, itensBoletoDoDia } = require("../src/alertas");

// 2026-11-13 sexta; 14 sábado; 15 domingo; 16 segunda; 10/11 terça; 09/11 segunda.
test("vencimento no domingo: lembrete (1 dia antes) vai para a sexta", () => {
  assert.equal(diaDoLembreteBoleto("2026-11-15", 1), "2026-11-13");
});

test("vencimento no sábado: lembrete vai para a sexta", () => {
  assert.equal(diaDoLembreteBoleto("2026-11-14", 1), "2026-11-13");
});

test("vencimento na segunda: véspera é domingo, vai para a sexta", () => {
  assert.equal(diaDoLembreteBoleto("2026-11-16", 1), "2026-11-13");
});

test("vencimento na terça: véspera segunda, sem mudança", () => {
  assert.equal(diaDoLembreteBoleto("2026-11-10", 1), "2026-11-09");
});

test("sem vencimento devolve null", () => {
  assert.equal(diaDoLembreteBoleto(null, 1), null);
});

test("itensBoletoDoDia gera o lembrete na sexta para boleto que vence no domingo", () => {
  const boletos = [{ id: "b1", title: "Boleto", due_date: "2026-11-15", valor_centavos: 35000, is_honorario: true }];
  const base = { diasAntes: 1, cobrancaDias: [3, 10, 30], honorariosCobrancaDias: [], lembreteOn: true, cobrancaOn: true };
  assert.equal(itensBoletoDoDia(boletos, { ...base, hoje: "2026-11-13" }).length, 1);
  assert.equal(itensBoletoDoDia(boletos, { ...base, hoje: "2026-11-14" }).length, 0);
});
