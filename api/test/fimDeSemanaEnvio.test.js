const test = require("node:test");
const assert = require("node:assert");
const { diasCobertosPeloAviso, ehFimDeSemana, ddmm } = require("../src/diasBancarios");
const { ehFimDeSemanaSP } = require("../src/janelaEnvio");
const { itensTributariosDoDia } = require("../src/alertasRegras");

test("sexta cobre sábado e domingo; demais dias só o próprio", () => {
  assert.deepStrictEqual(diasCobertosPeloAviso("2026-11-06"), ["2026-11-06", "2026-11-07", "2026-11-08"]);
  assert.deepStrictEqual(diasCobertosPeloAviso("2026-11-09"), ["2026-11-09"]);
  assert.deepStrictEqual(diasCobertosPeloAviso("2026-11-07"), ["2026-11-07"]);
  assert.deepStrictEqual(diasCobertosPeloAviso("2026-11-04"), ["2026-11-04"]);
});

test("ehFimDeSemana e ddmm (ddmm é usado pela projeção de férias)", () => {
  assert.ok(ehFimDeSemana("2026-11-07") && ehFimDeSemana("2026-11-08"));
  assert.ok(!ehFimDeSemana("2026-11-06") && !ehFimDeSemana("2026-11-09"));
  assert.strictEqual(ddmm("2026-11-09"), "09/11");
});

test("ehFimDeSemanaSP respeita o fuso de São Paulo", () => {
  assert.ok(ehFimDeSemanaSP(new Date("2026-11-07T15:00:00Z")));  // sábado
  assert.ok(ehFimDeSemanaSP(new Date("2026-11-08T12:00:00Z")));  // domingo
  assert.ok(!ehFimDeSemanaSP(new Date("2026-11-09T12:00:00Z"))); // segunda
  assert.ok(!ehFimDeSemanaSP(new Date("2026-11-06T22:00:00Z"))); // sexta 19h SP
  assert.ok(ehFimDeSemanaSP(new Date("2026-11-07T04:00:00Z")));  // sexta 01h SP? não: sábado 01h SP? 04Z = 01h SP sábado
});

test("DAS que vence na segunda (aviso cairia no domingo) sai na sexta, com a data do vencimento", () => {
  const proximaGuia = new Map([["DAS", "2026-11-09"]]);
  const itens = [];
  for (const d of diasCobertosPeloAviso("2026-11-06")) {
    itens.push(...itensTributariosDoDia({ codigos: ["DAS"], proximaGuia, hoje: d }));
  }
  assert.strictEqual(itens.length, 1);
  assert.strictEqual(itens[0].vencimento, "2026-11-09");
  // Em dia útil comum nada muda: só o próprio dia é varrido.
  const quarta = diasCobertosPeloAviso("2026-11-04").flatMap((d) => itensTributariosDoDia({ codigos: ["DAS"], proximaGuia, hoje: d }));
  assert.strictEqual(quarta.length, 0);
});
