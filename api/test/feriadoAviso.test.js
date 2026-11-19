const test = require("node:test");
const assert = require("node:assert");
const { diasCobertosPeloAviso } = require("../src/diasBancarios");
const { itensTributariosDoDia, itensVenceHoje, montarMensagemAlerta } = require("../src/alertasRegras");

// Novembro/2026: sexta 20/11 é feriado nacional (Consciência Negra).
// INSS/FGTS antecipam para quinta 19/11; DAS adia para segunda 23/11.
const guias = new Map([
  ["FGTS", "2026-11-19"],
  ["DCTF_WEB", "2026-11-19"],
  ["DAS", "2026-11-23"],
]);
const codigos = ["FGTS", "INSS_DCTFWEB", "DAS"];
const doDia = (hoje) =>
  diasCobertosPeloAviso(hoje).flatMap((d) => itensTributariosDoDia({ codigos, proximaGuia: guias, hoje: d }));

test("véspera de feriado cobre o feriado e o fim de semana", () => {
  assert.deepStrictEqual(diasCobertosPeloAviso("2026-11-19"), ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  assert.deepStrictEqual(diasCobertosPeloAviso("2026-11-20"), []);
});

test("INSS e FGTS de 19/11 são avisados na quarta 18/11", () => {
  assert.deepStrictEqual(doDia("2026-11-18").map((i) => i.codigo).sort(), ["FGTS", "INSS_DCTFWEB"]);
});

test("DAS de segunda 23/11 é avisado na quinta 19/11, não no feriado", () => {
  const quinta = doDia("2026-11-19");
  assert.deepStrictEqual(quinta.map((i) => [i.codigo, i.vencimento]), [["DAS", "2026-11-23"]]);
  assert.strictEqual(doDia("2026-11-20").length, 0);
  const texto = montarMensagemAlerta({ empresaNome: "X", hoje: "2026-11-19", itens: quinta });
  assert.match(texto, /Vence na segunda-feira \(23\/11\)/);
  assert.doesNotMatch(texto, /amanhã/);
});

test("no dia do vencimento sai 'vence hoje' (além da véspera)", () => {
  const itens = itensVenceHoje({ codigos, proximaGuia: guias, hoje: "2026-11-19" });
  assert.deepStrictEqual(itens.map((i) => i.codigo).sort(), ["FGTS", "INSS_DCTFWEB"]);
  const texto = montarMensagemAlerta({ empresaNome: "X", hoje: "2026-11-19", itens });
  assert.match(texto, /Vence hoje \(19\/11\)/);
});

test("DAS de segunda 23/11 também tem o aviso no dia", () => {
  const itens = itensVenceHoje({ codigos, proximaGuia: guias, hoje: "2026-11-23" });
  assert.deepStrictEqual(itens.map((i) => i.codigo), ["DAS"]);
});

test("feriado e fim de semana não geram 'vence hoje'", () => {
  const g = new Map([["DAS", "2026-11-20"]]);
  assert.strictEqual(itensVenceHoje({ codigos: ["DAS"], proximaGuia: g, hoje: "2026-11-20" }).length, 0);
});

test("véspera comum continua dizendo 'vence amanhã'", () => {
  const g = new Map([["FGTS", "2026-10-20"]]);
  const itens = diasCobertosPeloAviso("2026-10-19").flatMap((d) =>
    itensTributariosDoDia({ codigos: ["FGTS"], proximaGuia: g, hoje: d })
  );
  const texto = montarMensagemAlerta({ empresaNome: "X", hoje: "2026-10-19", itens });
  assert.match(texto, /Vence amanhã \(20\/10\)/);
});

test("aviso com guia leva o link sem senha, não anexo", () => {
  const itens = [{ codigo: "FGTS", nome: "FGTS", vencimento: "2026-11-19", temGuiaNoPortal: true }];
  const comLink = montarMensagemAlerta({
    empresaNome: "X", hoje: "2026-11-19", itens, portalUrl: "https://p.ex", linkGuias: "https://p.ex/g/abc",
  });
  assert.match(comLink, /Baixe a guia sem senha: https:\/\/p\.ex\/g\/abc/);
  assert.doesNotMatch(comLink, /PDF logo abaixo/);
  const semLink = montarMensagemAlerta({ empresaNome: "X", hoje: "2026-11-19", itens, portalUrl: "https://p.ex" });
  assert.match(semLink, /A guia está no portal: https:\/\/p\.ex\/guias/);
});
