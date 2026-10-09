const test = require("node:test");
const assert = require("node:assert/strict");
const regras = require("../src/ecacRegras");
const envio = require("../src/ecacEnvio");

const debito = (extra = {}) => ({
  tipo: "SN", receita: "Simples Nacional", periodo_apuracao: "08/2026", data_vencimento: "2026-09-20",
  valor_original: 300, saldo_devedor_total: 320.5, em_atraso: true, valido: true, ...extra,
});
const maed = debito({ tipo: "MAED", receita: "MAED - multa por atraso", saldo_devedor_total: 200 });
const cobranca = (extra = {}) => ({
  estado: "notificado", estado_desde: "2026-09-28", relatorio_id: 10, regeracoes: 0, emails: 1, whatsapps: 1, ...extra,
});

test("débito com saldo zerado no relatório não é cobrável", () => {
  assert.equal(regras.debitosCobraveis([debito({ saldo_devedor_total: 0 })]).length, 0);
  assert.equal(regras.debitosCobraveis([debito({ saldo_devedor_total: null })]).length, 0);
  assert.equal(regras.debitosCobraveis([debito()]).length, 1);
});

test("espelho só com MAED ou saldo zero não abre cobrança", () => {
  const rel = { relatorio: { id: 11, data_hora: "2026-10-01T10:00:00" }, relatorio_recente: true, cnpj: "11222333000181" };
  assert.equal(regras.deveAbrirCobranca(regras.espelhoDaEmpresa({ ...rel, debitos: [maed] })), false);
  assert.equal(regras.deveAbrirCobranca(regras.espelhoDaEmpresa({ ...rel, debitos: [debito({ saldo_devedor_total: 0 })] })), false);
  assert.equal(regras.deveAbrirCobranca(regras.espelhoDaEmpresa({ ...rel, debitos: [debito()] })), true);
});

test("cobrança cujo relatório não tem débito cobrável encerra sem mensagem (não manda lembrete)", () => {
  const d = regras.decidir({
    cobranca: cobranca(), qtdCobravelCobranca: regras.qtdCobravel({ debitos: [maed] }), hoje: "2026-10-09",
  });
  assert.equal(d.acao, "encerrar");
  assert.equal(d.estado, "encerrado");
  assert.equal(d.canais, undefined);
});

test("sem débito cobrável também não manda o 'tudo certo' quando chega relatório novo", () => {
  const d = regras.decidir({
    cobranca: cobranca({ estado: "lembrete" }),
    pendenciaAtual: { relatorio_id: 12, qtd_atraso: 0 },
    qtdCobravelCobranca: 0,
    hoje: "2026-10-09",
  });
  assert.equal(d.acao, "encerrar");
});

test("com débito cobrável o lembrete segue normal, e quem pagou ainda recebe o 'quitado'", () => {
  const lembrete = regras.decidir({ cobranca: cobranca(), qtdCobravelCobranca: 1, hoje: "2026-10-09" });
  assert.equal(lembrete.acao, "enviar");
  assert.equal(lembrete.etapa, "lembrete");
  const quitado = regras.decidir({
    cobranca: cobranca(), pendenciaAtual: { relatorio_id: 12, qtd_atraso: 0 }, qtdCobravelCobranca: 1, hoje: "2026-10-09",
  });
  assert.equal(quitado.etapa, "quitado");
});

test("registrarEEnviar não envia aviso/lembrete/cobrança sem débito, por canal nenhum", async () => {
  const db = { query: async () => { throw new Error("não devia tocar no banco"); } };
  for (const etapa of ["notificado", "lembrete", "cobranca_1", "cobranca_2"]) {
    const r = await envio.registrarEEnviar({
      db, cobranca: { id: 1 }, empresa: { id: 1, name: "RESTAURANTE DO QUEIJEIRO 4 LTDA" },
      pendencia: { debitos: [maed, debito({ saldo_devedor_total: 0 })] }, etapa, canais: ["email", "whatsapp"], cfg: {},
    });
    assert.deepEqual(r.map((x) => [x.canal, x.status]), [["email", "ignorado"], ["whatsapp", "ignorado"]]);
  }
});
