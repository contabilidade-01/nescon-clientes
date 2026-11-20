/**
 * Certidão de inteiro teor (JUCESP): leitura do PDF e regras de publicação.
 *
 * Fluxo pedido por Jeandson (2026-11-20): a certidão entra RETIDA (released_at nulo),
 * só o admin vê; depois de conferir, ele libera e ela aparece em "Documentos" do
 * cliente. Ao liberar uma certidão nova, as anteriores da mesma empresa saem da tela do
 * cliente (cancelado = true): o cliente vê sempre a versão mais recente.
 *
 * Fica guardada como uma entrega comum (tabela deliverables, categoria "outro"), para
 * reaproveitar download, isolamento por empresa e a tela de Documentos que já existem.
 */
const { validarDigitosCnpj, onlyDigits } = require("./pdfCnpj");

const DOC_TYPE = "certidao_inteiro_teor";
const CATEGORY = "outro";

const RE_CNPJ = /(?<!\d)(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/g;
const RE_DATA = /(\d{2})\/(\d{2})\/(\d{4})/;

function dataIso(br) {
  const m = RE_DATA.exec(br || "");
  if (!m) return null;
  const [, d, mes, a] = m;
  const iso = `${a}-${mes}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

function dataBr(iso) {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Primeira data que aparece nas `alcance` linhas seguintes ao rótulo. */
function dataApos(linhas, rotulo, alcance = 4) {
  for (let i = 0; i < linhas.length; i++) {
    if (!rotulo.test(linhas[i])) continue;
    const mesmaLinha = linhas[i].replace(rotulo, "");
    const naLinha = dataIso(mesmaLinha);
    if (naLinha) return naLinha;
    for (let j = i + 1; j <= i + alcance && j < linhas.length; j++) {
      const d = dataIso(linhas[j]);
      if (d) return d;
    }
  }
  return null;
}

function valorApos(linhas, rotulo) {
  for (let i = 0; i < linhas.length; i++) {
    if (!rotulo.test(linhas[i])) continue;
    for (let j = i + 1; j <= i + 3 && j < linhas.length; j++) {
      const v = linhas[j].trim();
      if (v) return v.split(/\s{2,}/)[0];
    }
  }
  return null;
}

/**
 * Lê o texto de uma certidão de inteiro teor da JUCESP.
 *
 * CNPJ: o que vem logo abaixo do rótulo "CNPJ" no quadro "DADOS DA EMPRESA"; se não
 * houver (certidão de constituição sai antes do CNPJ existir), os CNPJs válidos que
 * aparecem no corpo, do mais frequente para o menos — o da própria empresa se repete
 * no contrato, o de um sócio pessoa jurídica aparece menos.
 */
function lerCertidao(texto, nomeArquivo = "") {
  const t = String(texto || "");
  const linhas = t.split(/\r?\n/).map((l) => l.trim());
  const ehCertidao =
    /INTEIRO\s+TEOR/i.test(t) ||
    (/JUCESP/i.test(t) && /DADOS\s+DA\s+CERTID[ÃA]O/i.test(t)) ||
    /inteiro\s*teor/i.test(nomeArquivo);

  let cnpjQuadro = null;
  for (let i = 0; i < linhas.length; i++) {
    if (!/^CNPJ\b/i.test(linhas[i])) continue;
    for (let j = i; j <= i + 3 && j < linhas.length; j++) {
      const m = linhas[j].match(RE_CNPJ);
      const d = m && onlyDigits(m[0]);
      if (d && validarDigitosCnpj(d)) {
        cnpjQuadro = d;
        break;
      }
    }
    if (cnpjQuadro) break;
  }

  const contagem = new Map();
  for (const m of t.match(RE_CNPJ) || []) {
    const d = onlyDigits(m);
    if (d.length === 14 && validarDigitosCnpj(d)) contagem.set(d, (contagem.get(d) || 0) + 1);
  }
  const cnpjs = [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  if (cnpjQuadro) {
    cnpjs.splice(cnpjs.indexOf(cnpjQuadro), cnpjs.includes(cnpjQuadro) ? 1 : 0);
    cnpjs.unshift(cnpjQuadro);
  }

  // CNPJ no nome do arquivo ("12345678000190 - EMPRESA.pdf") vale como dica extra.
  const doNome = (String(nomeArquivo).match(/(?<!\d)\d{14}(?!\d)/) || [])[0];
  if (doNome && validarDigitosCnpj(doNome) && !cnpjs.includes(doNome)) cnpjs.push(doNome);

  const nire = valorApos(linhas, /^NIRE\b/i);
  return {
    ehCertidao,
    nome: valorApos(linhas, /^NOME EMPRESARIAL/i),
    nire: nire && /\d{8,}/.test(onlyDigits(nire)) ? onlyDigits(nire) : null,
    cnpjs,
    expedicao: dataApos(linhas, /DATA\s+D[AE]\s+EXPEDI[ÇC][ÃA]O/i) || dataApos(linhas, /ASSINADA EM/i, 0),
    arquivamento: dataApos(linhas, /DATA\s+DO\s+ARQUIVAMENTO/i),
  };
}

/** Título que o cliente vê em Documentos. */
function tituloCertidao(expedicao) {
  return expedicao
    ? `Certidão de inteiro teor (JUCESP) - expedida em ${dataBr(expedicao)}`
    : "Certidão de inteiro teor (JUCESP)";
}

module.exports = { DOC_TYPE, CATEGORY, lerCertidao, tituloCertidao, dataIso, dataBr };
