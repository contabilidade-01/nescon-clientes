const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizarPermissoes,
  acessoDoGerente,
  permissoesForaDaEmpresa,
  rotaLiberadaParaGerente,
} = require("../src/gerentes");

test("permissões: só advertência e suspensão, como booleano", () => {
  assert.deepEqual(normalizarPermissoes({ warning: true, boletos: true, suspension: "sim" }), {
    warning: true,
    suspension: false,
  });
  assert.deepEqual(normalizarPermissoes(null), { warning: false, suspension: false });
});

test("acesso do gerente: só o delegado e só se a empresa tiver", () => {
  const a = acessoDoGerente({ warning: true, suspension: false, boletos: true }, { warning: true, suspension: true });
  assert.equal(a.warning, true);
  assert.equal(a.suspension, false);
  assert.equal(a.boletos, false);
  assert.equal(a.fiscal_guides, false);
  assert.equal(a.history, false);
  assert.equal(a.employees, false);
});

test("não delega o que a empresa não tem", () => {
  assert.deepEqual(permissoesForaDaEmpresa({ suspension: false }, { warning: true, suspension: true }), ["suspension"]);
  assert.deepEqual(permissoesForaDaEmpresa({}, { warning: true }), []);
});

test("rotas liberadas ao gerente", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  assert.ok(rotaLiberadaParaGerente("GET", "/api/employees?company_id=x"));
  assert.ok(rotaLiberadaParaGerente("POST", "/api/documents"));
  assert.ok(rotaLiberadaParaGerente("GET", "/api/documents"));
  assert.ok(rotaLiberadaParaGerente("POST", `/api/documents/${id}/enviar-email`));
  assert.ok(rotaLiberadaParaGerente("POST", "/api/auth/change-password"));
  assert.ok(rotaLiberadaParaGerente("GET", "/api/auth/company-session"));

  assert.ok(!rotaLiberadaParaGerente("POST", "/api/employees"));
  assert.ok(!rotaLiberadaParaGerente("PUT", `/api/employees/${id}`));
  assert.ok(!rotaLiberadaParaGerente("DELETE", `/api/documents/${id}`));
  assert.ok(!rotaLiberadaParaGerente("GET", "/api/deliverables"));
  assert.ok(!rotaLiberadaParaGerente("GET", "/api/gerentes"));
  assert.ok(!rotaLiberadaParaGerente("POST", "/api/auth/trocar-empresa"));
  assert.ok(!rotaLiberadaParaGerente("GET", "/api/employees/../deliverables"));
});
