/**
 * Termos de ADVERTÊNCIA e SUSPENSÃO gerados no SERVIDOR (PDF + DOCX).
 *
 * Por que existir, se o portal já gera: o gerador do portal
 * (`src/lib/generate{Warning,Suspension}Doc.ts`) roda no NAVEGADOR (docx + file-saver).
 * O fluxo do WhatsApp não tem navegador — precisa produzir o arquivo no servidor para
 * anexar na conversa. O texto jurídico aqui é o MESMO do portal; ao mudar a redação,
 * mexer nos dois lados.
 *
 * Um único conteúdo (`montarBlocos`) alimenta os dois formatos:
 *  - PDF  (pdfkit): o que o cliente abre no celular e assina.
 *  - DOCX (docx):   a via editável, para o escritório ajustar o texto se precisar.
 */
const PDFDocument = require("pdfkit");
const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } = require("docx");

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * Natureza da conduta → alínea do art. 482 da CLT.
 *
 * Citar a alínea certa dá força ao termo numa reclamação trabalhista; citar a ERRADA
 * é pior do que não citar. Por isso quem escolhe é o cliente (uma pergunta no fluxo),
 * nunca a IA por conta própria — e existe a saída "outro", que mantém a menção ao
 * art. 482 genérica, como era antes.
 */
const CONDUTAS = {
  faltas: { rotulo: "Faltas, atrasos ou saídas antecipadas", alinea: "e", termo: "desídia no desempenho das respectivas funções" },
  ordem: { rotulo: "Descumprimento de ordem ou norma interna", alinea: "h", termo: "ato de indisciplina ou de insubordinação" },
  conduta: { rotulo: "Mau procedimento ou conduta inadequada", alinea: "b", termo: "mau procedimento" },
  desempenho: { rotulo: "Desleixo ou negligência no serviço", alinea: "e", termo: "desídia no desempenho das respectivas funções" },
  outro: { rotulo: "Outro motivo", alinea: null, termo: null },
};

const CONDUTA_ORDEM = ["faltas", "ordem", "conduta", "desempenho", "outro"];

function condutaDe(chave) {
  return CONDUTAS[chave] || CONDUTAS.outro;
}

/** Trecho "artigo 482, alínea 'e' (desídia...), da CLT" — ou genérico quando não enquadrado. */
function refArt482(cond) {
  return cond.alinea
    ? `artigo 482, alínea "${cond.alinea}" (${cond.termo}), da CLT`
    : "artigo 482 da CLT";
}

const UNIDADES = [
  "", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
  "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove",
];
const DEZENAS = { 20: "vinte", 30: "trinta" };

/** Número por extenso de 1 a 30 — é o teto do art. 474 da CLT, não precisa mais. */
function extenso(n) {
  const v = Number(n) || 0;
  if (v <= 19) return UNIDADES[v] || String(v);
  if (DEZENAS[v]) return DEZENAS[v];
  if (v < 30) return `vinte e ${UNIDADES[v - 20]}`;
  return String(v);
}

function formatBR(d) {
  const dt = new Date(d);
  const p = (x) => String(x).padStart(2, "0");
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

function formatFull(d) {
  const dt = new Date(d);
  return `${dt.getDate()} de ${MESES[dt.getMonth()]} de ${dt.getFullYear()}`;
}

function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

/**
 * Normaliza o motivo digitado/ditado pelo cliente: maiúscula inicial e ponto final —
 * o texto legal continua na mesma frase, então sem isso o parágrafo abre minúsculo.
 */
function comPonto(txt) {
  const t = String(txt || "").trim();
  if (!t) return "";
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

/**
 * Estrutura neutra do documento. Cada bloco é renderizado por PDF e DOCX do mesmo jeito,
 * então a redação vive num lugar só.
 */
function montarBlocos(dados) {
  const ehSuspensao = dados.tipo === "suspensao";
  const nome = String(dados.employeeName || "").trim();
  const cpf = String(dados.cpf || "").trim() || "não informado";
  const empresa = String(dados.companyName || "").trim();
  const cnpj = String(dados.cnpj || "").trim();
  const data = dados.data instanceof Date ? dados.data : new Date(dados.data);

  const blocos = [
    { t: "titulo", txt: empresa.toUpperCase() },
    { t: "sub", txt: `CNPJ: ${cnpj}` },
    { t: "hr" },
    { t: "titulo", txt: ehSuspensao ? "TERMO DE SUSPENSÃO DISCIPLINAR" : "TERMO DE ADVERTÊNCIA DISCIPLINAR" },
    { t: "dir", txt: formatFull(data) },
    {
      t: "p",
      runs: [{
        txt: ehSuspensao
          ? "Pelo presente instrumento, fica o(a) empregado(a) abaixo identificado(a) suspenso(a) de suas atividades laborais:"
          : "Pelo presente instrumento, fica o(a) empregado(a) abaixo identificado(a) formalmente advertido(a):",
      }],
    },
    { t: "campo", rot: "Empregado(a): ", val: nome },
    { t: "campo", rot: "CPF: ", val: cpf },
  ];

  const cond = condutaDe(dados.conduta);
  let corpo;
  if (ehSuspensao) {
    const cal = dados.calendario12x36;
    const dias = Math.min(30, Math.max(1, Number(dados.suspensionDays) || 1));
    let fim;
    let retorno;
    let diasTxt;
    let periodo;
    if (cal && cal.inicio) {
      fim = cal.fim instanceof Date ? cal.fim : new Date(cal.fim);
      retorno = cal.retorno instanceof Date ? cal.retorno : new Date(cal.retorno);
      diasTxt = `${String(cal.diasPlantao || dias).padStart(2, "0")} (${extenso(cal.diasPlantao || dias)}) plantão(ões) em escala 12x36`;
      periodo = `${formatBR(cal.inicio)} a ${formatBR(fim)}`;
      if (cal.anuncio) {
        blocos.push({ t: "campo", rot: "Data do anúncio: ", val: formatBR(cal.anuncio) });
      }
    } else {
      fim = addDays(data, dias - 1);
      retorno = addDays(fim, 1);
      diasTxt = `${String(dias).padStart(2, "0")} (${extenso(dias)}) dia${dias > 1 ? "s" : ""}`;
      periodo = `${formatBR(data)} a ${formatBR(fim)}`;
    }

    blocos.push({ t: "campo", rot: "Período de suspensão: ", val: periodo });
    blocos.push({ t: "campo", rot: "Total de dias: ", val: diasTxt });
    blocos.push({ t: "campo", rot: "Data de retorno: ", val: formatBR(retorno) });

    corpo =
      `${comPonto(dados.motivo)} Diante do exposto, estamos procedendo com uma suspensão disciplinar de ${diasTxt}, ` +
      (cal && cal.inicio
        ? "observada a escala 12x36 (o dia do anúncio é trabalhado; o dia seguinte é folga; a suspensão incide no(s) plantão(ões) seguinte(s), e o retorno ocorre após a folga subsequente). "
        : "") +
      "com fundamento no artigo 474 da Consolidação das Leis do Trabalho (CLT), que confere ao empregador o poder " +
      "disciplinar de suspender o empregado por até 30 (trinta) dias." +
      " Esta medida é necessária para enfatizar a seriedade do cumprimento das responsabilidades e o impacto negativo " +
      "que a conduta gera na equipe e nos processos da empresa." +
      ` Ressalta-se que, conforme o ${refArt482(cond)}, a continuidade desse comportamento pode resultar em rescisão ` +
      "do contrato de trabalho por justa causa." +
      " Esperamos que, ao retornar, demonstre compromisso renovado com suas obrigações profissionais.";
  } else {
    corpo =
      `${comPonto(dados.motivo)}` +
      " A presente advertência é aplicada com fundamento no artigo 2º da Consolidação das Leis do Trabalho (CLT), " +
      "que confere ao empregador o poder diretivo e disciplinar sobre seus empregados." +
      ` Ressalta-se que, nos termos do ${refArt482(cond)}, a reiteração deste tipo de conduta poderá acarretar ` +
      "penalidades mais severas, incluindo suspensão disciplinar e, em última instância, a rescisão do contrato " +
      "de trabalho por justa causa.";
  }

  blocos.push({ t: "hr" });
  blocos.push({ t: "rotulo", txt: ehSuspensao ? "FUNDAMENTAÇÃO:" : "MOTIVO DA ADVERTÊNCIA:" });
  blocos.push({ t: "p", align: "just", runs: [{ txt: corpo }] });
  blocos.push({
    t: "p",
    pequeno: true,
    runs: [
      { txt: "Base Legal: ", b: true, i: true },
      {
        txt: (ehSuspensao ? "Art. 2º, Art. 474 e Art. 482" : "Art. 2º e Art. 482")
          + (cond.alinea ? `, alínea "${cond.alinea}",` : "") + " da CLT.",
        i: true,
      },
    ],
  });
  blocos.push({
    t: "p",
    runs: [{ txt: "Para que produza os devidos efeitos legais, firmo o presente termo em 02 (duas) vias de igual teor e forma.", i: true }],
  });
  blocos.push({ t: "hr" });
  blocos.push({ t: "assin", nome, sub: `CPF: ${cpf}`, papel: "Empregado(a)" });
  blocos.push({ t: "assin", nome: empresa, sub: `CNPJ: ${cnpj}`, papel: "Empregador" });

  // Testemunhas: é o que dá validade ao termo quando o empregado SE RECUSA a assinar.
  // Sem elas, a recusa não tem prova e o documento perde força numa reclamação
  // trabalhista. Vão sempre no termo — se o empregado assinar, apenas não são usadas.
  blocos.push({
    t: "p",
    pequeno: true,
    runs: [{
      txt: "Havendo recusa do(a) empregado(a) em assinar o presente termo, as testemunhas abaixo atestam que "
        + "o documento lhe foi lido e apresentado, dando-lhe plena ciência do seu conteúdo, e que a assinatura foi recusada.",
      i: true,
    }],
  });
  blocos.push({ t: "testemunhas" });

  const slug = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
  const base = `${ehSuspensao ? "suspensao" : "advertencia"}_${slug}_${formatBR(data).replace(/\//g, "-")}`;

  return { blocos, nomeBase: base };
}

// ---------------------------------------------------------------------------
// PDF (pdfkit) — fontes padrão Helvetica cobrem os acentos do português.
// ---------------------------------------------------------------------------
function gerarPdf(blocos) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } });
      const pedacos = [];
      doc.on("data", (c) => pedacos.push(c));
      doc.on("end", () => resolve(Buffer.concat(pedacos)));
      doc.on("error", reject);

      const larg = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      for (const b of blocos) {
        if (b.t === "titulo") {
          doc.font("Helvetica-Bold").fontSize(12).fillColor("#000")
            .text(b.txt, { align: "center" });
          doc.moveDown(0.3);
        } else if (b.t === "sub") {
          doc.font("Helvetica").fontSize(9).fillColor("#666")
            .text(b.txt, { align: "center" });
          doc.moveDown(0.4);
        } else if (b.t === "dir") {
          doc.font("Helvetica-Oblique").fontSize(9).fillColor("#000")
            .text(b.txt, { align: "right" });
          doc.moveDown(0.6);
        } else if (b.t === "hr") {
          doc.moveDown(0.3);
          const y = doc.y;
          doc.strokeColor("#CCCCCC").lineWidth(1)
            .moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + larg, y).stroke();
          doc.moveDown(0.6);
        } else if (b.t === "rotulo") {
          doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(b.txt);
          doc.moveDown(0.2);
        } else if (b.t === "campo") {
          doc.fontSize(10).fillColor("#000");
          doc.font("Helvetica-Bold").text(b.rot, { continued: true });
          doc.font("Helvetica").text(b.val);
          doc.moveDown(0.2);
        } else if (b.t === "p") {
          const tam = b.pequeno ? 9 : 10;
          doc.fontSize(tam).fillColor("#000");
          b.runs.forEach((r, i) => {
            const fonte = r.b && r.i ? "Helvetica-BoldOblique" : r.b ? "Helvetica-Bold" : r.i ? "Helvetica-Oblique" : "Helvetica";
            doc.font(fonte).text(r.txt, {
              continued: i < b.runs.length - 1,
              align: b.align === "just" ? "justify" : "left",
            });
          });
          doc.moveDown(0.5);
        } else if (b.t === "assin") {
          doc.moveDown(1.4);
          doc.font("Helvetica").fontSize(10).fillColor("#000")
            .text("________________________________________", { align: "center" });
          doc.font("Helvetica-Bold").fontSize(10).text(b.nome, { align: "center" });
          doc.font("Helvetica").fontSize(9).fillColor("#555").text(b.sub, { align: "center" });
          doc.font("Helvetica-Oblique").fontSize(8).fillColor("#888").text(b.papel, { align: "center" });
          doc.fillColor("#000");
        } else if (b.t === "testemunhas") {
          // Duas colunas lado a lado: cabe na mesma página e fica igual ao termo em papel.
          doc.moveDown(1.2);
          const colL = (larg - 24) / 2;
          const x1 = doc.page.margins.left;
          const x2 = doc.page.margins.left + colL + 24;
          const y0 = doc.y;
          for (const [i, x] of [x1, x2].entries()) {
            doc.y = y0;
            doc.font("Helvetica").fontSize(9).fillColor("#000")
              .text("____________________________________", x, doc.y, { width: colL, align: "center" });
            doc.font("Helvetica-Bold").fontSize(9)
              .text(`Testemunha ${i + 1}`, x, doc.y, { width: colL, align: "center" });
            doc.font("Helvetica").fontSize(8.5).fillColor("#555")
              .text("Nome: ______________________", x, doc.y + 4, { width: colL, align: "center" });
            doc.text("CPF: _______________________", x, doc.y + 2, { width: colL, align: "center" });
          }
          doc.x = doc.page.margins.left;
          doc.fillColor("#000");
        }
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// DOCX (mesma lib do portal) — a via editável.
// ---------------------------------------------------------------------------
const F = 20, FS = 18, FT = 24; // 10pt, 9pt, 12pt (docx usa meio-ponto)

function hrDocx() {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC", space: 2 } },
    children: [],
  });
}

async function gerarDocx(blocos) {
  const filhos = [];
  for (const b of blocos) {
    if (b.t === "titulo") {
      filhos.push(new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { after: 60 },
        children: [new TextRun({ text: b.txt, font: "Arial", size: FT, bold: true })],
      }));
    } else if (b.t === "sub") {
      filhos.push(new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { after: 120 },
        children: [new TextRun({ text: b.txt, font: "Arial", size: FS, color: "666666" })],
      }));
    } else if (b.t === "dir") {
      filhos.push(new Paragraph({
        alignment: AlignmentType.RIGHT, spacing: { after: 120 },
        children: [new TextRun({ text: b.txt, font: "Arial", size: FS, italics: true })],
      }));
    } else if (b.t === "hr") {
      filhos.push(hrDocx());
    } else if (b.t === "rotulo") {
      filhos.push(new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [new TextRun({ text: b.txt, font: "Arial", size: F, bold: true })],
      }));
    } else if (b.t === "campo") {
      filhos.push(new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: b.rot, font: "Arial", size: F, bold: true }),
          new TextRun({ text: b.val, font: "Arial", size: F }),
        ],
      }));
    } else if (b.t === "p") {
      filhos.push(new Paragraph({
        spacing: { after: 80 },
        alignment: b.align === "just" ? AlignmentType.JUSTIFIED : undefined,
        children: b.runs.map((r) => new TextRun({
          text: r.txt, font: "Arial", size: b.pequeno ? FS : F, bold: !!r.b, italics: !!r.i,
        })),
      }));
    } else if (b.t === "assin") {
      filhos.push(new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { before: 200, after: 20 },
        children: [new TextRun({ text: "________________________________________", font: "Arial", size: F })],
      }));
      filhos.push(new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { after: 10 },
        children: [new TextRun({ text: b.nome, font: "Arial", size: F, bold: true })],
      }));
      filhos.push(new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { after: 10 },
        children: [new TextRun({ text: b.sub, font: "Arial", size: FS, color: "555555" })],
      }));
      filhos.push(new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { after: 120 },
        children: [new TextRun({ text: b.papel, font: "Arial", size: 16, italics: true, color: "888888" })],
      }));
    } else if (b.t === "testemunhas") {
      for (const n of [1, 2]) {
        filhos.push(new Paragraph({
          spacing: { before: n === 1 ? 200 : 140, after: 20 },
          children: [new TextRun({ text: "____________________________________", font: "Arial", size: FS })],
        }));
        filhos.push(new Paragraph({
          spacing: { after: 10 },
          children: [new TextRun({ text: `Testemunha ${n}`, font: "Arial", size: FS, bold: true })],
        }));
        filhos.push(new Paragraph({
          spacing: { after: 10 },
          children: [new TextRun({ text: "Nome: ______________________________   CPF: ____________________", font: "Arial", size: 17, color: "555555" })],
        }));
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      children: filhos,
    }],
  });
  return Packer.toBuffer(doc);
}

/** Gera os dois arquivos de uma vez. */
async function gerarArquivos(dados) {
  const { blocos, nomeBase } = montarBlocos(dados);
  const [pdf, docx] = await Promise.all([gerarPdf(blocos), gerarDocx(blocos)]);
  return { pdf, docx, nomeBase };
}

module.exports = {
  montarBlocos, gerarPdf, gerarDocx, gerarArquivos, extenso, formatBR, addDays,
  CONDUTAS, CONDUTA_ORDEM, condutaDe, refArt482,
};
