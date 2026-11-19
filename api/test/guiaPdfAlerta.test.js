const test = require("node:test");
const assert = require("node:assert");
process.env.PUBLIC_APP_URL = "https://portal.exemplo";
const { enviarGuiasPdf, docTypesDaMensagem, nomeArquivo } = require("../src/guiaPdfAlerta");
const { montarMensagemAlerta } = require("../src/alertasRegras");

test("códigos da mensagem viram doc_types de guia (array ou CSV da fila)", () => {
  assert.deepStrictEqual(docTypesDaMensagem(["FGTS", "INSS_DCTFWEB", "BOLETO:abc"]).sort(), ["DCTF_WEB", "FGTS"]);
  assert.deepStrictEqual(docTypesDaMensagem("DAS,FERIAS_LIMITE:12"), ["DAS"]);
  assert.deepStrictEqual(docTypesDaMensagem([]), []);
});

test("nome do arquivo leva o vencimento", () => {
  assert.strictEqual(nomeArquivo("FGTS", "2026-11-19"), "FGTS - vence 19-11.pdf");
});

test("envia cada guia pelo link público, sem login", async () => {
  const chamadas = [];
  const db = {
    query: async (_sql, params) => {
      assert.deepStrictEqual(params[1].sort(), ["DCTF_WEB", "FGTS"]);
      assert.strictEqual(params[2], "2026-11-19");
      return {
        rows: [
          { id: "1", doc_type: "FGTS", title: "FGTS", access_token: "tok1", venc: "2026-11-19" },
          { id: "2", doc_type: "DCTF_WEB", title: "INSS (DCTF Web)", access_token: "tok2", venc: "2026-11-19" },
        ],
      };
    },
  };
  const uazapi = { configurado: () => true, enviarDocumento: async (a) => chamadas.push(a) };
  const r = await enviarGuiasPdf(
    db,
    { companyId: "c", obrigacoes: ["FGTS", "INSS_DCTFWEB"], diaAlerta: "2026-11-19", numero: "5511999999999", delayMs: 0 },
    { uazapi }
  );
  assert.strictEqual(r.enviados, 2);
  assert.strictEqual(chamadas[0].fileUrl, "https://portal.exemplo/api/deliverables/public/tok1/file");
  assert.match(chamadas[1].caption, /INSS \(DCTF Web\) — vence 19\/11/);
});

test("mensagem sem tributo não consulta nem envia guia", async () => {
  const db = { query: async () => assert.fail("não devia consultar") };
  const r = await enviarGuiasPdf(db, { companyId: "c", obrigacoes: ["BOLETO:x"], diaAlerta: "2026-11-19", numero: "5511" }, { uazapi: { configurado: () => true } });
  assert.strictEqual(r.enviados, 0);
});

test("texto do aviso anuncia o PDF da guia", () => {
  const texto = montarMensagemAlerta({
    empresaNome: "X",
    hoje: "2026-11-19",
    itens: [{ codigo: "FGTS", nome: "FGTS", vencimento: "2026-11-19", temGuiaNoPortal: true }],
    portalUrl: "https://portal.exemplo",
  });
  assert.match(texto, /A guia segue em PDF logo abaixo/);
  assert.match(texto, /Também está no portal: https:\/\/portal.exemplo\/guias/);
});
