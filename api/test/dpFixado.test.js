const test = require("node:test");
const assert = require("node:assert/strict");
const { fixarDpParaQuemTemFuncionarios, DP_TOOLS_FIXADAS } = require("../src/dpFixado");

function dbFalso(rows = []) {
  const chamadas = [];
  return {
    chamadas,
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      return { rows };
    },
  };
}

test("liga advertência, suspensão, lista e histórico — uma vez só por empresa", async () => {
  const db = dbFalso([{ id: "a", name: "EMPRESA A" }]);
  const r = await fixarDpParaQuemTemFuncionarios(db);
  assert.equal(r.length, 1);
  const { sql, params } = db.chamadas[0];
  assert.deepEqual(JSON.parse(params[0]), { warning: true, suspension: true, employees: true, history: true });
  assert.deepEqual(DP_TOOLS_FIXADAS, ["warning", "suspension", "employees", "history"]);
  assert.match(sql, /dp_auto_ligado_em IS NULL/);
  assert.match(sql, /dp_auto_ligado_em = now\(\)/);
  // Pró-labore não conta como funcionário.
  assert.match(sql, /labore/);
  assert.equal(params.length, 1);
});

test("limita às empresas pedidas", async () => {
  const db = dbFalso();
  await fixarDpParaQuemTemFuncionarios(db, ["x", "y"]);
  const { sql, params } = db.chamadas[0];
  assert.match(sql, /c\.id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(params[1], ["x", "y"]);
});

test("falha no banco não derruba quem chamou", async () => {
  const db = { query: async () => { throw new Error("sem coluna"); } };
  assert.deepEqual(await fixarDpParaQuemTemFuncionarios(db), []);
});
