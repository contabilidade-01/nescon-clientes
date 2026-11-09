const test = require("node:test");
const assert = require("node:assert/strict");

process.env.UPLOAD_DIR = require("node:os").tmpdir() + "/boleto-envio-teste";
const { diaDoEnvioBoleto, decidirEnvioBoleto, montarMensagemBoleto } = require("../src/boletoEnvio");
const { diaDoLembreteBoleto } = require("../src/alertas");

// 2026-11-06 sexta; 07 sábado; 08 domingo; 09 segunda; 10 terça; 20 sexta (Consciência Negra).
test("envio: 5 dias antes em dia útil não muda", () => {
  assert.equal(diaDoEnvioBoleto("2026-11-10", 5), "2026-11-05");
});

test("envio: cai no sábado, antecipa para a sexta", () => {
  assert.equal(diaDoEnvioBoleto("2026-11-12", 5), "2026-11-06");
});

test("envio: cai no domingo, antecipa para a sexta", () => {
  assert.equal(diaDoEnvioBoleto("2026-11-13", 5), "2026-11-06");
});

test("envio: cai em feriado nacional (20/11), antecipa para o dia útil anterior", () => {
  assert.equal(diaDoEnvioBoleto("2026-11-25", 5), "2026-11-19");
});

test("envio: 0 dias ou sem vencimento = desligado", () => {
  assert.equal(diaDoEnvioBoleto("2026-11-10", 0), null);
  assert.equal(diaDoEnvioBoleto(null, 5), null);
});

test("lembrete (1 dia antes) segue antecipando em fim de semana e feriado", () => {
  assert.equal(diaDoLembreteBoleto("2026-11-09", 1), "2026-11-06"); // véspera = domingo
  assert.equal(diaDoLembreteBoleto("2026-11-21", 1), "2026-11-19"); // véspera = feriado 20/11
});

const base = { diasEnvio: 5, diasLembrete: 1, lembreteAtivo: true };

test("decidir: antes do dia do envio não sai", () => {
  assert.equal(decidirEnvioBoleto({ ...base, dueDate: "2026-11-10", hoje: "2026-11-04" }), null);
});

test("decidir: no dia do envio sai", () => {
  assert.equal(decidirEnvioBoleto({ ...base, dueDate: "2026-11-10", hoje: "2026-11-05" }), "enviar");
});

test("decidir: boleto emitido tarde (dentro dos 5 dias) ainda sai", () => {
  assert.equal(decidirEnvioBoleto({ ...base, dueDate: "2026-11-12", hoje: "2026-11-10" }), "enviar");
});

test("decidir: no dia do lembrete só carimba (PDF já vai junto do lembrete)", () => {
  assert.equal(decidirEnvioBoleto({ ...base, dueDate: "2026-11-10", hoje: "2026-11-09" }), "carimbar");
});

test("decidir: lembrete desligado na empresa, o envio sai normalmente", () => {
  assert.equal(
    decidirEnvioBoleto({ ...base, lembreteAtivo: false, dueDate: "2026-11-10", hoje: "2026-11-09" }),
    "enviar"
  );
});

test("decidir: vencido não envia", () => {
  assert.equal(decidirEnvioBoleto({ ...base, dueDate: "2026-11-10", hoje: "2026-11-11" }), null);
});

test("mensagem: honorário com valor, vencimento e link do portal", () => {
  const t = montarMensagemBoleto({
    empresa: "ACME", competencia: "2026-11", valor: "R$ 350,00", venc: "10/11/2026",
    isHonorario: true, portal: "https://app.exemplo.com", contato: "",
  });
  assert.match(t, /Olá, \*ACME\*!/);
  assert.match(t, /Honorários 11\/2026/);
  assert.match(t, /\*R\$ 350,00\*/);
  assert.match(t, /\*10\/11\/2026\*/);
  assert.match(t, /app\.exemplo\.com\/boletos/);
});
