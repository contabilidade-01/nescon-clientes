const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const r = require("../src/envioAvulso");

/** ZIP mínimo (sem compressão) com os nomes dados — o bastante para o leitor do diretório central. */
function zipCom(nomes) {
  const locais = [];
  const centrais = [];
  let offset = 0;
  for (const nome of nomes) {
    const n = Buffer.from(nome, "utf8");
    const local = Buffer.alloc(30 + n.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(n.length, 26);
    n.copy(local, 30);
    const central = Buffer.alloc(46 + n.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    n.copy(central, 46);
    locais.push(local);
    centrais.push(central);
    offset += local.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(nomes.length, 8);
  fim.writeUInt16LE(nomes.length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, dir, fim]);
}

const arq = (originalname, buffer) => ({ originalname, size: buffer.length, buffer });

test("campos: CNPJ com máscara vira 14 dígitos; tipo precisa ser da lista", () => {
  const ok = r.validarCampos({ cnpj: "12.345.678/0001-90", tipo: "extrato", observacao: " oi ", remetente: "Ana" });
  assert.equal(ok.erro, undefined);
  assert.equal(ok.cnpj, "12345678000190");
  assert.equal(ok.observacao, "oi");
  assert.ok(r.validarCampos({ cnpj: "123", tipo: "extrato" }).erro);
  assert.ok(r.validarCampos({ cnpj: "12345678000190", tipo: "qualquer" }).erro);
  assert.ok(r.validarCampos({ cnpj: "12345678000190", tipo: "__proto__" }).erro);
});

test("campos: tira caracteres de controle e corta no tamanho", () => {
  const d = r.validarCampos({ cnpj: "12345678000190", tipo: "outros", remetente: "a\u0000b\u001bc", observacao: "x".repeat(5000) });
  assert.equal(d.remetente, "a b c");
  assert.equal(d.observacao.length, 1000);
});

test("aceita PDF, JPG, PNG e XML quando o conteúdo bate", () => {
  assert.deepEqual(r.conferirArquivo(arq("extrato.pdf", Buffer.from("%PDF-1.7\n..."))), { ext: "pdf", nome: "extrato.pdf" });
  assert.equal(r.conferirArquivo(arq("foto.JPG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]))).ext, "jpg");
  assert.equal(r.conferirArquivo(arq("a.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).ext, "png");
  assert.equal(r.conferirArquivo(arq("nfe.xml", Buffer.from('\uFEFF<?xml version="1.0"?><nfeProc/>'))).ext, "xml");
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(8)]);
  assert.equal(r.conferirArquivo(arq("IMG_0001.HEIC", heic)).ext, "heic");
});

test("recusa extensão perigosa ou fora da lista", () => {
  for (const nome of ["virus.exe", "a.html", "a.svg", "a.js", "planilha.xlsm", "antigo.xls", "doc.doc", "sem-extensao"]) {
    assert.ok(r.conferirArquivo(arq(nome, Buffer.from("%PDF-1.4"))).erro, nome);
  }
});

test("recusa conteúdo que não confere com a extensão (executável renomeado)", () => {
  const mz = Buffer.from("MZ\x90\x00 isto é um exe", "latin1");
  assert.ok(r.conferirArquivo(arq("nota.pdf", mz)).erro);
  assert.ok(r.conferirArquivo(arq("foto.jpg", mz)).erro);
  assert.ok(r.conferirArquivo(arq("lista.txt", mz)).erro);
  assert.ok(r.conferirArquivo(arq("lista.csv", Buffer.from([0x41, 0x00, 0x42]))).erro);
  assert.ok(r.conferirArquivo(arq("pagina.txt", Buffer.from("<html><script>alert(1)</script>"))).erro);
  assert.ok(r.conferirArquivo(arq("nfe.xml", Buffer.from("isto nao e xml"))).erro);
  assert.ok(r.conferirArquivo(arq("vazio.pdf", Buffer.alloc(0))).erro);
});

test("ZIP e Office: confere a lista interna", () => {
  assert.equal(r.conferirArquivo(arq("notas.zip", zipCom(["nf1.xml", "nf2.xml"]))).ext, "zip");
  assert.equal(r.conferirArquivo(arq("plan.xlsx", zipCom(["[Content_Types].xml", "xl/workbook.xml"]))).ext, "xlsx");
  assert.ok(r.conferirArquivo(arq("notas.zip", zipCom(["nf1.xml", "setup.exe"]))).erro);
  assert.ok(r.conferirArquivo(arq("notas.zip", zipCom(["dentro.zip"]))).erro);
  assert.ok(r.conferirArquivo(arq("notas.zip", zipCom(["../../etc/passwd"]))).erro);
  assert.ok(r.conferirArquivo(arq("plan.xlsx", zipCom(["xl/workbook.xml", "xl/vbaProject.bin"]))).erro);
  assert.ok(r.conferirArquivo(arq("quebrado.zip", Buffer.from("PK\x03\x04lixo", "latin1"))).erro);
});

test("tamanho: acima de 10 MB por arquivo é recusado", () => {
  const grande = Buffer.alloc(r.MAX_BYTES_ARQUIVO + 1);
  grande.write("%PDF-1.4");
  assert.ok(r.conferirArquivo(arq("grande.pdf", grande)).erro);
});

test("nome de exibição: sem caminho, sem caracteres estranhos, mantém acento", () => {
  assert.equal(r.nomeExibicao("../../etc/passwd"), "passwd");
  assert.equal(r.nomeExibicao("C:\\Users\\x\\Extrato Março.pdf"), "Extrato Março.pdf");
  assert.equal(r.nomeExibicao('a"<b>.pdf'), "a__b_.pdf");
  assert.equal(r.nomeExibicao(".htaccess"), "htaccess");
  assert.equal(r.nomeExibicao(""), "arquivo");
});

test("protocolo: EV- e 6 caracteres sem 0/O/1/I", () => {
  for (let i = 0; i < 50; i++) {
    assert.match(r.gerarProtocolo(crypto.randomBytes), /^EV-[2-9A-HJ-NP-Z]{6}$/);
  }
});
