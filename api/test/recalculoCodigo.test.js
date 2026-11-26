const test = require("node:test");
const assert = require("node:assert/strict");
const rc = require("../src/recalculoCodigo");

/** Banco de mentira: guarda os códigos em memória e responde às consultas do módulo. */
function bancoFalso({ empresa }) {
  const codigos = [];
  let agora = Date.now();
  const db = {
    codigos,
    avancar(ms) { agora += ms; },
    async query(sql, p = []) {
      if (sql.includes("FROM companies")) return { rows: empresa && p[0] === empresa.cnpj.replace(/\D/g, "") ? [empresa] : [] };
      if (sql.includes("count(*)::int AS n")) {
        const daHora = codigos.filter((c) => c.company_id === p[0] && agora - c.criado < 3600e3);
        const ultimo = daHora.length ? Math.max(...daHora.map((c) => c.criado)) : null;
        return { rows: [{ n: daHora.length, seg: ultimo === null ? 999999 : Math.floor((agora - ultimo) / 1000) }] };
      }
      if (sql.startsWith("UPDATE recalculo_codigos SET cancelado_em = now()\n      WHERE company_id")) {
        codigos.filter((c) => c.company_id === p[0] && !c.usado && !c.cancelado).forEach((c) => (c.cancelado = true));
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO recalculo_codigos")) {
        const c = { id: codigos.length + 1, company_id: p[0], codigo_hash: p[1], email: p[2], expira: agora + p[3] * 60e3, criado: agora, tentativas: 0 };
        codigos.push(c);
        return { rows: [{ id: c.id, expira_em: new Date(c.expira) }] };
      }
      if (sql.includes("SELECT id, codigo_hash, tentativas")) {
        const vivos = codigos.filter((c) => c.company_id === p[0] && !c.usado && !c.cancelado && c.expira > agora);
        return { rows: vivos.slice(-1) };
      }
      if (sql.includes("SET tentativas = $2")) {
        const c = codigos.find((x) => x.id === p[0]);
        c.tentativas = p[1];
        if (p[1] >= p[2]) c.cancelado = true;
        return { rows: [] };
      }
      if (sql.includes("SET usado_em = now()")) {
        const c = codigos.find((x) => x.id === p[0]);
        if (c.usado || c.cancelado) return { rowCount: 0 };
        c.usado = true;
        return { rowCount: 1 };
      }
      if (sql.includes("SET cancelado_em = now() WHERE id")) { codigos.find((x) => x.id === p[0]).cancelado = true; return { rows: [] }; }
      if (sql.includes("acesso_link_id")) return { rows: [] };
      throw new Error("SQL não previsto: " + sql);
    },
  };
  return db;
}

const EMPRESA = { id: "e1", name: "JL METAL LTDA", cnpj: "12.345.678/0001-90", contact_email: "financeiro@jlmetal.com.br; outro@x.com" };

async function pedir(db) {
  let enviado = null;
  const r = await rc.pedirCodigo(db, { cnpj: "12345678000190", ip: "1.1.1.1", enviar: async (m) => { enviado = m; } });
  const codigo = enviado ? /(\d{6})/.exec(enviado.text)[1] : null;
  return { r, codigo, enviado };
}

const criarAcesso = async () => ({ id: 9, token: "a".repeat(64) });

test("primeiro e-mail válido da lista; código de 6 dígitos; hash confere", () => {
  assert.equal(rc.primeiroEmail("x; Fin@Emp.com.br, y@z.com"), "fin@emp.com.br");
  assert.equal(rc.primeiroEmail("sem email"), null);
  const c = rc.gerarCodigo();
  assert.match(c, /^\d{6}$/);
  const h = rc.hashCodigo("123456");
  assert.ok(rc.confere("123456", h));
  assert.ok(!rc.confere("123457", h));
  assert.ok(!h.includes("123456"));
});

test("pede código: e-mail vai para o cadastro e a tela vê só o e-mail mascarado", async () => {
  const db = bancoFalso({ empresa: EMPRESA });
  const { r, enviado } = await pedir(db);
  assert.equal(r.status, 200);
  assert.equal(enviado.to, "financeiro@jlmetal.com.br");
  assert.equal(r.body.email, "fi•••••@jl•••.com.br");
  assert.ok(!JSON.stringify(r.body).includes("financeiro@"));
  assert.equal(r.body.minutos, 10);
});

test("CNPJ desconhecido ou sem e-mail não envia nada", async () => {
  const db = bancoFalso({ empresa: { ...EMPRESA, contact_email: "" } });
  assert.equal((await pedir(db)).r.status, 404);
  assert.equal((await rc.pedirCodigo(bancoFalso({ empresa: null }), { cnpj: "12345678000190", enviar: async () => assert.fail() })).status, 404);
  assert.equal((await rc.pedirCodigo(db, { cnpj: "123", enviar: async () => assert.fail() })).status, 400);
});

test("código certo abre o acesso uma vez só", async () => {
  const db = bancoFalso({ empresa: EMPRESA });
  const { codigo } = await pedir(db);
  const ok = await rc.verificarCodigo(db, { cnpj: "12.345.678/0001-90", codigo, criarAcesso });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.token.length, 64);
  const de_novo = await rc.verificarCodigo(db, { cnpj: "12345678000190", codigo, criarAcesso });
  assert.equal(de_novo.status, 400);
});

test("5 erros cancelam o código, mesmo que depois venha o certo", async () => {
  const db = bancoFalso({ empresa: EMPRESA });
  const { codigo } = await pedir(db);
  const errado = codigo === "000000" ? "111111" : "000000";
  for (let i = 1; i <= 4; i++) {
    const r = await rc.verificarCodigo(db, { cnpj: "12345678000190", codigo: errado, criarAcesso });
    assert.equal(r.body.restam, 5 - i);
  }
  assert.equal((await rc.verificarCodigo(db, { cnpj: "12345678000190", codigo: errado, criarAcesso })).body.restam, 0);
  assert.equal((await rc.verificarCodigo(db, { cnpj: "12345678000190", codigo, criarAcesso })).status, 400);
});

test("código vence em 10 minutos", async () => {
  const db = bancoFalso({ empresa: EMPRESA });
  const { codigo } = await pedir(db);
  db.avancar(10 * 60e3 + 1000);
  assert.equal((await rc.verificarCodigo(db, { cnpj: "12345678000190", codigo, criarAcesso })).status, 400);
});

test("reenvio: espera 1 minuto, cancela o código anterior e limita 5 por hora", async () => {
  const db = bancoFalso({ empresa: EMPRESA });
  const a = await pedir(db);
  assert.equal((await pedir(db)).r.status, 429);
  db.avancar(61e3);
  const b = await pedir(db);
  assert.equal(b.r.status, 200);
  if (a.codigo !== b.codigo) {
    assert.equal((await rc.verificarCodigo(db, { cnpj: "12345678000190", codigo: a.codigo, criarAcesso })).status, 400);
  }
  for (let i = 0; i < 3; i++) { db.avancar(61e3); assert.equal((await pedir(db)).r.status, 200); }
  db.avancar(61e3);
  assert.equal((await pedir(db)).r.status, 429);
});

test("falha no e-mail cancela o código", async () => {
  const db = bancoFalso({ empresa: EMPRESA });
  const r = await rc.pedirCodigo(db, { cnpj: "12345678000190", enviar: async () => { throw new Error("smtp"); } });
  assert.equal(r.status, 502);
  assert.ok(db.codigos[0].cancelado);
});
