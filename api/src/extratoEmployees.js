/**
 * Extrai nome + CPF dos funcionários de um Extrato Mensal de folha (PDF).
 *
 * A linha do empregado tem sempre código, nome e CPF, mas a ORDEM dos campos muda
 * conforme quem extrai o texto:
 *  - pdfplumber (Python): "Empr.: 15DAYLA APARECIDA BUENO Situação: ... CPF:510.512.768-45"
 *  - pdf-parse (Node):    "15 DAYLA APARECIDA BUENO<TAB>Empr.: 18/09/2025<TAB>...510.512.768-45..."
 *
 * Por isso o parser é por linha e tolerante às duas ordens: acha um CPF válido (com dígito
 * verificador) e o nome, seja pelo padrão "Empr.: {cód}{nome} Situação", seja pelo início
 * "{cód} {nome}". Validar o DV evita cadastrar CPF quebrado por OCR.
 */

/** Nome no padrão pdfplumber: "Empr.: {código}{NOME} ... Situação" */
const RE_NOME_EMPR = /Empr\.:\s*(\d+)\s*([A-Za-zÀ-ÿ][^\t]*?)\s*Situa[çc][ãa]o/i;
/** Nome no padrão pdf-parse: linha começa com "{código} {NOME}" até tab/rótulo */
const RE_NOME_INICIO = /^\s*(\d+)\s+([A-Za-zÀ-ÿ][^\t]*?)(?:\t|\s{2,}|Empr\.|Situa[çc][ãa]o|Adm:|CPF:)/i;
/** CPF mascarado ou só dígitos */
const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
/** Marca que a linha é de um empregado (e não de proventos/descontos). */
const RE_MARKER = /Situa[çc][ãa]o|Empr\.:|Adm:/i;
/** Salário base: aparece no bloco do empregado, às vezes na própria linha dele. */
const RE_SALARIO = /Sal[áa]rio:\s*([\d.]*\d(?:,\d+)?)/i;
/** Cargo: distingue funcionário de pró-labore (ver payrollRoles.js). */
const RE_CARGO = /Cargo:\s*(?:\d+\s+)?([^\t\n]+?)\s*(?:C\.?B\.?O|$)/i;
/** Vínculo: Celetista, Diretor, Estagiário — mais confiável que cargo para distinguir CLT. */
const RE_VINCULO = /V[ií]nculo:\s*([^\s]+)/i;
/** Competência da folha, no cabeçalho do extrato. */
const RE_COMPETENCIA = /Compet[êe]ncia:\s*(\d{2}\/\d{4})/i;

/** Dígito verificador do CPF — rejeita 111.111.111-11 e afins. */
function cpfValido(cpf) {
  const d = String(cpf).replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (fatorInicial) => {
    let soma = 0;
    let fator = fatorInicial;
    for (let i = 0; i < fatorInicial - 1; i++) soma += Number(d[i]) * (fator--);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(10) === Number(d[9]) && calc(11) === Number(d[10]);
}

/** "1.412,00" → 1412. Devolve null para o que não é número. */
function numeroBR(bruto) {
  const n = Number(String(bruto || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function limparNome(bruto) {
  return String(bruto)
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Extrai {codigo, name, cpf} de uma linha, ou null se não for linha de empregado. */
function extrairLinha(linha) {
  if (!RE_MARKER.test(linha)) return null;

  // CPF: o primeiro da linha que passa no dígito verificador.
  let cpf = null;
  for (const m of linha.matchAll(RE_CPF)) {
    const d = m[0].replace(/\D/g, "");
    if (cpfValido(d)) {
      cpf = d;
      break;
    }
  }
  if (!cpf) return null;

  // Nome: tenta o padrão pdfplumber, depois o pdf-parse.
  let codigo = "";
  let nome = "";
  const mEmpr = linha.match(RE_NOME_EMPR);
  if (mEmpr) {
    codigo = mEmpr[1];
    nome = mEmpr[2];
  } else {
    const mIni = linha.match(RE_NOME_INICIO);
    if (mIni) {
      codigo = mIni[1];
      nome = mIni[2];
    }
  }
  nome = limparNome(nome);
  if (nome.length < 2) return null;
  return { codigo, name: nome, cpf };
}

/**
 * Recebe o texto já extraído do PDF e devolve os funcionários encontrados.
 * `invalidos` conta linhas com marca de empregado mas sem CPF válido (sinal de OCR ruim).
 */
function extrairDoTexto(texto) {
  const vistos = new Set();
  const funcionarios = [];
  let invalidos = 0;
  let competencia = null;
  // O salário NÃO está na linha do empregado: vem no bloco abaixo dela, até começar o
  // próximo empregado. Por isso a varredura acompanha o bloco corrente.
  let atual = null;

  const capturarSalario = (linha) => {
    if (!atual || atual.salarioBase !== null) return;
    const m = linha.match(RE_SALARIO);
    if (!m) return;
    const v = numeroBR(m[1]);
    // Salário zero não existe: melhor deixar em branco do que afirmar R$ 0,00.
    atual.salarioBase = v && v > 0 ? v : null;
  };

  const capturarCargo = (linha) => {
    if (!atual || atual.cargo) return;
    const m = linha.match(RE_CARGO);
    if (!m) return;
    const c = m[1].replace(/\s+/g, " ").trim();
    if (c) atual.cargo = c;
  };

  const capturarVinculo = (linha) => {
    if (!atual || atual.vinculo) return;
    const m = linha.match(RE_VINCULO);
    if (!m) return;
    const v = m[1].replace(/\s+/g, " ").trim();
    if (v) atual.vinculo = v;
  };

  for (const linha of String(texto || "").split(/\r?\n/)) {
    if (!competencia) {
      const mc = linha.match(RE_COMPETENCIA);
      if (mc) competencia = mc[1];
    }

    if (RE_MARKER.test(linha)) {
      const emp = extrairLinha(linha);
      if (emp) {
        if (vistos.has(emp.cpf)) {
          // Duplicado (extrato repetido): não abre bloco novo, para não sobrescrever.
          atual = null;
        } else {
          vistos.add(emp.cpf);
          atual = { ...emp, salarioBase: null, cargo: null, vinculo: null };
          funcionarios.push(atual);
          capturarSalario(linha);
          capturarCargo(linha);
          capturarVinculo(linha);
        }
        continue;
      }
      // Linha parece de empregado mas não deu CPF válido — conta como ilegível,
      // desde que tenha ALGUM número com cara de CPF (evita contar cabeçalhos).
      if (/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(linha)) invalidos += 1;
      continue;
    }

    capturarSalario(linha);
    capturarCargo(linha);
    capturarVinculo(linha);
  }
  return { funcionarios, invalidos, competencia };
}

/** Lê o PDF (via pdf-parse) e extrai os funcionários. */
async function parseExtratoEmployees(pdfBuffer) {
  let parser;
  try {
    const { PDFParse } = require("pdf-parse");
    parser = new PDFParse({ data: pdfBuffer });
    const { text } = await parser.getText();
    return extrairDoTexto(text || "");
  } catch (err) {
    console.error("[extrato] falha ao ler PDF:", err.message);
    return { funcionarios: [], invalidos: 0 };
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch { /* já liberado */ }
    }
  }
}

module.exports = { parseExtratoEmployees, extrairDoTexto, cpfValido };
