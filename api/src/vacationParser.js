/**
 * Leitor da "Programação de Férias" (G-Click), em PDF.
 *
 * O desafio é o mesmo do extrato: o texto sai do PDF em ordem diferente conforme o
 * extrator. Com `unpdf` (que remonta por coordenada) a linha começa pelo código; com o
 * nosso `pdf-parse`, começa pelo nome. Em vez de depender de posição fixa, o parser se
 * ancora num TRECHO INCONFUNDÍVEL da linha (ver CORE abaixo) e lê o resto ao redor dele.
 *
 * Uma linha de funcionário, como o pdf-parse entrega:
 *
 *   FLAVIA MORAES DE GOIS \t 8 01/05/2024 1 08/12 01/05/2025 \t 30/04/2026 .... 24 0 24
 *   07/04/2027 - 11 \t .... \t .... \t ..../..../...... \t 30/04/2026
 *
 * e a continuação (2º período aquisitivo do mesmo funcionário) vem sem nome nem código:
 *
 *   01/05/2026 .... 20 0 30 01/04/2028 - 1 \t .... \t .... \t ..../..../...... \t 30/04/2027
 */

const DATA = String.raw`\d{2}\/\d{2}\/\d{4}`;
const VAZIO = String.raw`\.{4,}`;
const NUM = String.raw`[\d.,]+`;

/**
 * Âncora: início de gozo (data ou vazio), três números, o limite para gozo (data) e
 * dois campos que podem ser traço. Nenhuma outra parte da linha se parece com isto.
 */
const CORE = new RegExp(
  `(${DATA}|${VAZIO})\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})\\s+(${DATA})\\s+(-|${NUM})\\s+(-|${NUM})`
);

const RE_DATA_G = new RegExp(DATA, "g");
const RE_COMPETENCIA_CURTA = /^\d{2}\/\d{2}$/;

/** "2,5" → 2.5; "-" e vazio → 0. */
function num(t) {
  if (t === undefined || t === null) return 0;
  const s = String(t).trim();
  if (!s || s === "-" || /^\.+$/.test(s)) return 0;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** "31/12/2026" → "2026-12-31". Vazio ou "...." → null. */
function dataBR(t) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(t || "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function digitos(t) {
  return String(t || "").replace(/\D/g, "");
}

/** Cabeçalho: empresa, CNPJ, data base e emissão vêm soltos nas primeiras linhas. */
function lerCabecalho(linhas) {
  const cab = { empresa: "", cnpj: "", dataBase: null, emissao: null };
  const topo = linhas.slice(0, 20);
  const datas = [];

  for (const l of topo) {
    const t = l.trim();
    if (!t) continue;
    const mC = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/.exec(t);
    if (!cab.cnpj && mC) cab.cnpj = digitos(mC[1]);
    // A razão social é a primeira linha "de texto" antes dos rótulos.
    if (!cab.empresa && /^[A-ZÀ-Ý][A-ZÀ-Ý0-9 .,&'\-/]{5,}$/.test(t) && !/PROGRAMA|CNPJ|EMISS/i.test(t)) {
      cab.empresa = t;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) datas.push(t);
  }
  // O leiaute imprime "Data base" antes de "Emissão"; os rótulos saem separados dos
  // valores, então a ordem de aparição é o que temos.
  cab.dataBase = dataBR(datas[0]);
  cab.emissao = dataBR(datas[1]);
  return cab;
}

/**
 * Lê uma linha de dados. Devolve `null` quando a linha não é de funcionário.
 *
 * `nome`/`codigo` vêm nulos nas linhas de continuação — quem chama associa ao
 * funcionário anterior.
 */
function lerLinha(linha) {
  const m = CORE.exec(linha);
  if (!m) return null;

  const antes = linha.slice(0, m.index).trim();
  const depois = linha.slice(m.index + m[0].length);

  // Os três números são, na ordem: acumulado no período, dias já gozados e dias de
  // direito. A ordem foi confirmada contra o próprio relatório: quem tem 0 faltas
  // aparece com 30 no TERCEIRO número mesmo quando o primeiro é 25 ou 2,5 — logo o
  // terceiro é o direito, e o primeiro é o proporcional acumulado.
  const periodo = {
    inicioGozo: dataBR(m[1]),
    diasAcumulados: num(m[2]),
    diasGozados: num(m[3]),
    diasDireito: num(m[4]),
    limiteGozo: dataBR(m[5]),
    diasAfastamento: num(m[6]),
    faltas: num(m[7]),
  };

  // Fim do período aquisitivo: é a última data da linha (vale para as duas formas).
  const datasDepois = depois.match(RE_DATA_G) || [];
  const datasAntes = antes.match(RE_DATA_G) || [];
  periodo.fimAquisitivo =
    dataBR(datasDepois[datasDepois.length - 1]) ||
    dataBR(datasAntes[datasAntes.length - 1]);

  const toks = antes.split(/\s+/).filter(Boolean);
  const temNome = /[A-Za-zÀ-ÿ]{2,}/.test(antes);

  if (!temNome) {
    // Continuação: só o início do período aquisitivo antes da âncora.
    periodo.inicioAquisitivo = dataBR(toks[0]);
    return { continuacao: true, periodo };
  }

  // Nome e código podem vir em qualquer ordem, conforme o extrator do PDF.
  let codigo = null;
  let nome = "";
  const idxCodigo = toks.findIndex((t) => /^\d+$/.test(t));
  if (idxCodigo === 0) {
    codigo = toks[0];
    nome = toks.slice(1, toks.findIndex((t) => new RegExp(`^${DATA}$`).test(t))).join(" ");
  } else if (idxCodigo > 0) {
    codigo = toks[idxCodigo];
    nome = toks.slice(0, idxCodigo).join(" ");
  } else {
    nome = antes;
  }

  // Depois do código: admissão, (férias vencidas), (férias proporcionais MM/AA),
  // início do aquisitivo e — na primeira linha — o fim do aquisitivo.
  const resto = idxCodigo >= 0 ? toks.slice(idxCodigo + 1) : [];
  const datasResto = resto.filter((t) => new RegExp(`^${DATA}$`).test(t));
  const admissao = dataBR(datasResto[0]);
  periodo.inicioAquisitivo = dataBR(datasResto[1]) || admissao;
  if (datasResto[2]) periodo.fimAquisitivo = dataBR(datasResto[2]) || periodo.fimAquisitivo;

  const feriasVencidas = resto.find((t, i) => /^\d+$/.test(t) && i > 0 && !RE_COMPETENCIA_CURTA.test(t));

  return {
    continuacao: false,
    codigo: codigo ? String(codigo) : null,
    nome: nome.replace(/\s+/g, " ").trim(),
    admissao,
    feriasVencidas: num(feriasVencidas),
    periodo,
  };
}

/**
 * Texto do PDF → funcionários com seus períodos. Não interpreta nem calcula nada:
 * as regras vivem em vacationRules.js.
 */
function extrairDoTexto(texto) {
  const linhas = String(texto || "").split(/\r?\n/);
  const cabecalho = lerCabecalho(linhas);
  const funcionarios = [];
  let atual = null;
  let ignoradas = 0;

  for (const linha of linhas) {
    if (!linha.trim()) continue;
    const lido = lerLinha(linha);
    if (!lido) continue;

    if (lido.continuacao) {
      // Continuação sem funcionário antes: linha solta, provavelmente quebra de página.
      if (!atual) {
        ignoradas += 1;
        continue;
      }
      atual.periodos.push(lido.periodo);
      continue;
    }

    atual = {
      codigo: lido.codigo,
      nome: lido.nome,
      admissao: lido.admissao,
      feriasVencidas: lido.feriasVencidas,
      periodos: [lido.periodo],
    };
    funcionarios.push(atual);
  }

  // O rodapé declara o total — serve de conferência contra o que conseguimos ler.
  const mTotal = /Total de empregados:\s*(\d+)/i.exec(texto || "");
  const totalDeclarado = mTotal ? Number(mTotal[1]) : null;

  return { ...cabecalho, funcionarios, totalDeclarado, ignoradas };
}

/** Lê o PDF (pdf-parse) e extrai a programação. */
async function parseVacationPdf(pdfBuffer) {
  let parser;
  try {
    const { PDFParse } = require("pdf-parse");
    parser = new PDFParse({ data: pdfBuffer });
    const { text } = await parser.getText();
    return extrairDoTexto(text || "");
  } catch (err) {
    console.error("[ferias] falha ao ler PDF:", err.message);
    return { empresa: "", cnpj: "", dataBase: null, emissao: null, funcionarios: [], totalDeclarado: null, ignoradas: 0 };
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch { /* já liberado */ }
    }
  }
}

module.exports = { parseVacationPdf, extrairDoTexto, lerLinha, dataBR, num };
