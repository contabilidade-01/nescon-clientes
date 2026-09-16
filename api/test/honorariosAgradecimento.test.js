const test = require("node:test");
const assert = require("node:assert/strict");

const {
  montarMensagemAgradecimento,
  competenciasTexto,
  calcularCorte,
  agruparPorEmpresa,
} = require("../src/honorariosAgradecimento");

test("competenciasTexto ordena, deduplica e formata BR", () => {
  assert.equal(competenciasTexto(["2026-09", "2026-08"]), "08/2026 e 09/2026");
  assert.equal(competenciasTexto(["2026-09", "2026-09"]), "09/2026");
  assert.equal(competenciasTexto(["2026-07", "2026-08", "2026-09"]), "07/2026, 08/2026 e 09/2026");
  assert.equal(competenciasTexto([]), "");
  assert.equal(competenciasTexto(null), "");
});

test("montarMensagemAgradecimento: caloroso, com competência, sem tom de cobrança", () => {
  const txt = montarMensagemAgradecimento({
    empresa: "RESTAURANTE ACME LTDA",
    competencias: ["2026-09"],
    portal: "https://portal.test",
    contato: "(11) 99999-8888",
  });
  assert.match(txt, /RESTAURANTE ACME LTDA/);
  assert.match(txt, /Muito obrigado pela confiança/);
  assert.match(txt, /referente a \*09\/2026\*/);
  assert.match(txt, /_Nescon Contabilidade_/);
  assert.match(txt, /portal\.test\/boletos/);
  // NÃO pode soar como cobrança:
  assert.doesNotMatch(txt, /atraso|suspens|bloqueio|multa|vencid/i);
});

test("montarMensagemAgradecimento sem competência não quebra a frase", () => {
  const txt = montarMensagemAgradecimento({ empresa: "ACME", competencias: [], portal: "", contato: "" });
  assert.match(txt, /Recebemos o pagamento dos seus honorários\. Muito obrigado/);
  assert.doesNotMatch(txt, /referente a/);
});

test("calcularCorte: quando agora está bem depois do início, usa a janela recente", () => {
  const agora = new Date("2026-09-14T12:00:00-03:00");
  const corte = calcularCorte({ inicioISO: "2026-09-01", janelaDias: 7, agora });
  assert.equal(corte.getTime(), agora.getTime() - 7 * 86400000);
});

test("calcularCorte: logo após o início, o piso de início vence a janela", () => {
  const agora = new Date("2026-09-03T12:00:00-03:00");
  const corte = calcularCorte({ inicioISO: "2026-09-01", janelaDias: 7, agora });
  assert.equal(corte.getTime(), new Date("2026-09-01T00:00:00-03:00").getTime());
});

test("agruparPorEmpresa: 1 grupo por empresa, junta ids e competências", () => {
  const rows = [
    { id: "a1", company_id: "C1", empresa_nome: "ACME", whatsapp: "5511999998888", competencia: "2026-08", valor_centavos: 10000 },
    { id: "a2", company_id: "C1", empresa_nome: "ACME", whatsapp: "5511999998888", competencia: "2026-09", valor_centavos: 10000 },
    { id: "b1", company_id: "C2", empresa_nome: "BETA", whatsapp: "5511977776666", competencia: "2026-09", valor_centavos: 5000 },
  ];
  const grupos = agruparPorEmpresa(rows);
  assert.equal(grupos.length, 2);
  const acme = grupos.find((g) => g.company_id === "C1");
  assert.deepEqual(acme.ids, ["a1", "a2"]);
  assert.deepEqual(acme.competencias, ["2026-08", "2026-09"]);
  assert.equal(acme.valorCentavos, 20000);
  const beta = grupos.find((g) => g.company_id === "C2");
  assert.deepEqual(beta.ids, ["b1"]);
});
