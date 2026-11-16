const test = require("node:test");
const assert = require("node:assert/strict");
const { validarEmissao, ferramentasDaEmpresa } = require("../src/dpAvulso");

const base = {
  tipo: "advertencia",
  cnpj: "12.345.678/0001-90",
  funcionario: "Maria da Silva",
  data: "2026-11-11",
  motivo: "Atrasos recorrentes.",
};

test("advertência válida: normaliza CNPJ e deixa CPF opcional", () => {
  const d = validarEmissao(base);
  assert.equal(d.erro, undefined);
  assert.equal(d.tipo, "warning");
  assert.equal(d.cnpj, "12345678000190");
  assert.equal(d.cpf, "");
  assert.equal(d.dias, null);
});

test("campos obrigatórios e CPF incompleto", () => {
  assert.match(validarEmissao({ ...base, funcionario: " " }).erro, /nome/);
  assert.match(validarEmissao({ ...base, data: "" }).erro, /data da advertência/);
  assert.match(validarEmissao({ ...base, cpf: "123" }).erro, /CPF/);
  assert.match(validarEmissao({ ...base, cnpj: "123" }).erro, /CNPJ/);
  assert.match(validarEmissao({ ...base, tipo: "admissao" }).erro, /Tipo/);
});

test("suspensão: dias de 1 a 30 e retorno depois do início, ambos digitados", () => {
  const s = { ...base, tipo: "suspensao", dias: 3, retorno: "2026-11-14" };
  const d = validarEmissao(s);
  assert.equal(d.tipo, "suspension");
  assert.equal(d.dias, 3);
  assert.equal(d.retorno, "2026-11-14");
  assert.match(validarEmissao({ ...s, dias: 31 }).erro, /1 a 30/);
  assert.match(validarEmissao({ ...s, retorno: "" }).erro, /retorno/);
  assert.match(validarEmissao({ ...s, retorno: "2026-11-11" }).erro, /depois/);
});

test("ferramentas: segue o liga/desliga da empresa (omitido = ligado)", () => {
  assert.deepEqual(ferramentasDaEmpresa(null), { advertencia: true, suspensao: true });
  assert.deepEqual(ferramentasDaEmpresa({ warning: false }), { advertencia: false, suspensao: true });
});
