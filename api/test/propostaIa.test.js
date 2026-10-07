const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizarMensagens, promptSistema, conversarProposta, FERRAMENTA } = require("../src/propostaIa");

test("histórico começa por user, alterna e junta mensagens seguidas", () => {
  const out = normalizarMensagens([
    { role: "assistant", content: "Oi!" },
    { role: "user", content: "MEI com DASN atrasada" },
    { role: "user", content: "3 anos" },
    { role: "assistant", content: "Quantas guias?" },
    { role: "user", content: "   " },
    { role: "user", content: "10" },
  ]);
  assert.deepEqual(out, [
    { role: "user", content: "MEI com DASN atrasada\n3 anos" },
    { role: "assistant", content: "Quantas guias?" },
    { role: "user", content: "10" },
  ]);
});

test("o prompt carrega catálogo, estado e a regra de não inventar preço", () => {
  const p = promptSistema({ catalogo: { itens: [{ codigo: "dasn_atraso" }] }, estado: { cliente: { nome: "X" } } });
  assert.match(p, /dasn_atraso/);
  assert.match(p, /"nome":"X"/);
  assert.match(p, /NÃO inventa preço/);
});

test("a ferramenta obriga mensagem e patch", () => {
  assert.deepEqual(FERRAMENTA.input_schema.required, ["mensagem", "patch"]);
});

test("sem chave da Claude o assistente responde 409 (a tela segue funcionando sem ele)", async () => {
  const antes = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const db = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    conversarProposta(db, { mensagens: [{ role: "user", content: "oi" }], catalogo: {}, estado: {} }),
    (e) => e.status === 409 && /chave da Claude/.test(e.message)
  );
  if (antes) process.env.ANTHROPIC_API_KEY = antes;
});

test("devolve mensagem e patch da ferramenta e manda tool_choice forçado", async () => {
  const antes = process.env.ANTHROPIC_API_KEY;
  const fetchAntes = global.fetch;
  process.env.ANTHROPIC_API_KEY = "sk-teste";
  let corpo = null;
  global.fetch = async (_url, init) => {
    corpo = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        content: [
          { type: "text", text: "ignorado" },
          {
            type: "tool_use",
            name: "responder",
            input: { mensagem: "Pronto", patch: { pacotes: ["mei_regularizacao"] }, faltando: ["anos"], pronta: false },
          },
        ],
      }),
    };
  };
  try {
    const db = { query: async () => ({ rows: [] }) };
    const r = await conversarProposta(db, {
      mensagens: [{ role: "user", content: "MEI atrasado" }],
      catalogo: { itens: [] },
      estado: {},
    });
    assert.equal(r.mensagem, "Pronto");
    assert.deepEqual(r.patch, { pacotes: ["mei_regularizacao"] });
    assert.deepEqual(r.faltando, ["anos"]);
    assert.deepEqual(corpo.tool_choice, { type: "tool", name: "responder" });
    assert.equal(corpo.messages[0].role, "user");
  } finally {
    global.fetch = fetchAntes;
    if (antes) process.env.ANTHROPIC_API_KEY = antes;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});
