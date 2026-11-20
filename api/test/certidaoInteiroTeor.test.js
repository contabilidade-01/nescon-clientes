const test = require("node:test");
const assert = require("node:assert/strict");
const { lerCertidao, tituloCertidao } = require("../src/certidaoInteiroTeor");

const ALTERACAO = `DOCUMENTO EMITIDO PELA INTERNET
DADOS DA EMPRESA
NOME EMPRESARIAL
RESTAURANTE DO QUEIJEIRO 4 LTDA
TIPO JURÍDICO
SOCIEDADE LIMITADA (M.E.)
NIRE
35263719056
CNPJ
54.803.962/0001-08
NÚMERO DO ARQUIVAMENTO
1.265.428/24-4
DATA DO ARQUIVAMENTO
11/10/2024
DADOS DA CERTIDÃO
DATA DE EXPEDIÇÃO
14/10/2024
JUCESP
sócia: OUTRA EMPRESA LTDA, CNPJ 26.786.637/0001-49`;

const CONSTITUICAO = `CERTIDÃO DE INTEIRO TEOR
NOME EMPRESARIAL
BQRB OTICAS LTDA
NIRE
3528070238-7
DATA DO ARQUIVAMENTO
04/09/2026
DATA DA EXPEDIÇÃO
04/09/2026`;

test("lê empresa, CNPJ do quadro, NIRE e datas", () => {
  const r = lerCertidao(ALTERACAO, "Q4 - Certidão.pdf");
  assert.equal(r.ehCertidao, true);
  assert.equal(r.nome, "RESTAURANTE DO QUEIJEIRO 4 LTDA");
  assert.equal(r.cnpjs[0], "54803962000108");
  assert.ok(r.cnpjs.includes("26786637000149"));
  assert.equal(r.nire, "35263719056");
  assert.equal(r.arquivamento, "2024-10-11");
  assert.equal(r.expedicao, "2024-10-14");
});

test("certidão de constituição sem CNPJ usa o do nome do arquivo", () => {
  const r = lerCertidao(CONSTITUICAO, "12345678000195 - BQRB.pdf");
  assert.equal(r.ehCertidao, true);
  assert.equal(r.nire, "35280702387");
  assert.equal(r.expedicao, "2026-09-04");
  assert.deepEqual(r.cnpjs, ["12345678000195"]);
});

test("PDF que não é certidão é recusado", () => {
  const r = lerCertidao("CAPA DO REQUERIMENTO\nJUCESP\nDATA DE EXPEDIÇÃO 22/04/2024", "Certidao.pdf");
  assert.equal(r.ehCertidao, false);
});

test("título mostra a data de expedição", () => {
  assert.equal(tituloCertidao("2026-11-11"), "Certidão de inteiro teor (JUCESP) - expedida em 11/11/2026");
  assert.equal(tituloCertidao(null), "Certidão de inteiro teor (JUCESP)");
});
