import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle
} from "docx";
import { saveAs } from "file-saver";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface SuspensionData {
  employeeName: string;
  cpf: string;
  companyName: string;
  cnpj: string;
  startDate: Date;
  suspensionDays: number;
  previousWarnings: string[];
  previousSuspensions: string[];
  recentAbsenceDate: string;
  unjustifiedAbsences: string[];
  isThirdSuspension?: boolean;
  /** Motivo customizado (má conduta, atrasos, briga etc.). Se vazio, usa o texto de faltas injustificadas. */
  reason?: string;
}

function formatDateBR(date: Date): string {
  return format(date, "dd/MM/yyyy", { locale: ptBR });
}

function formatDateFull(date: Date): string {
  return format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
}

function lineSeparator(): Paragraph {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC", space: 2 } },
    children: [],
  });
}

const F = 20; // font size (10pt)
const FS = 18; // font size small (9pt)
const FT = 24; // font size title (12pt)

export function generateSuspensionDoc(data: SuspensionData) {
  const endDate = addDays(data.startDate, data.suspensionDays - 1);
  const returnDate = addDays(endDate, 1);

  const justificationRuns: TextRun[] = [];

  // A fundamentação continua na mesma frase (", e após já ter recebido...");
  // por isso o ponto final do motivo é removido.
  const customReason = (data.reason || "").trim().replace(/\.+$/, "");

  if (customReason) {
    justificationRuns.push(
      new TextRun({
        text: customReason,
        font: "Arial", size: F,
      })
    );
  } else if (data.unjustifiedAbsences.length > 0) {
    justificationRuns.push(
      new TextRun({
        text: `Devido às suas ausências não justificadas nos dias `,
        font: "Arial", size: F,
      })
    );
    justificationRuns.push(
      new TextRun({
        text: data.unjustifiedAbsences.join(", "),
        font: "Arial", size: F, bold: true,
      })
    );
  } else if (data.recentAbsenceDate) {
    // Só afirma "ausências" quando há PROVA disso (dias listados ou data da última
    // falta). Antes, o caso sem nenhum dado caía aqui e o termo acusava faltas mesmo
    // quando a suspensão era por briga, insubordinação ou uso de celular.
    justificationRuns.push(
      new TextRun({
        text: `Devido às suas repetidas ausências não justificadas, inclusive a mais recente em ${data.recentAbsenceDate}`,
        font: "Arial", size: F,
      })
    );
  } else {
    justificationRuns.push(
      new TextRun({
        text: "Devido a conduta incompatível com as obrigações assumidas no contrato de trabalho",
        font: "Arial", size: F,
      })
    );
  }

  if (data.previousSuspensions.length > 0) {
    justificationRuns.push(
      new TextRun({
        text: `, e após já ter recebido ${data.previousSuspensions.length === 1 ? "uma suspensão" : data.previousSuspensions.length + " suspensões"} `,
        font: "Arial", size: F,
      })
    );
    justificationRuns.push(
      new TextRun({
        text: data.previousSuspensions.join(" e "),
        font: "Arial", size: F, bold: true,
      })
    );
  }

  if (data.previousWarnings.length > 0) {
    justificationRuns.push(
      new TextRun({
        text: ` e advertências formais anteriormente aplicadas`,
        font: "Arial", size: F,
      })
    );
  }

  justificationRuns.push(
    new TextRun({
      text: `, estamos procedendo com uma suspensão disciplinar de ${data.suspensionDays.toString().padStart(2, "0")} (${data.suspensionDays > 1 ? extenso(data.suspensionDays) : "um"}) dia${data.suspensionDays > 1 ? "s" : ""}, `,
      font: "Arial", size: F,
    })
  );

  justificationRuns.push(
    new TextRun({
      text: "com fundamento no artigo 474 da Consolidação das Leis do Trabalho (CLT), que confere ao empregador o poder disciplinar de suspender o empregado por até 30 (trinta) dias consecutivos.",
      font: "Arial", size: F,
    })
  );

  justificationRuns.push(
    new TextRun({
      // "a conduta" no lugar de "suas faltas": a suspensão pode ser por briga,
      // insubordinação ou uso de celular — nem sempre por ausência.
      text: " Esta medida é necessária para enfatizar a seriedade do cumprimento das responsabilidades e o impacto negativo que a conduta gera na equipe e nos processos da empresa.",
      font: "Arial", size: F,
    })
  );

  justificationRuns.push(
    new TextRun({
      text: " Ressalta-se que, conforme o artigo 482 da CLT, a continuidade desse comportamento pode resultar em rescisão do contrato de trabalho por justa causa.",
      font: "Arial", size: F,
    })
  );

  if (data.isThirdSuspension) {
    justificationRuns.push(
      new TextRun({ text: "\n\n", font: "Arial", size: F })
    );
    // Com motivo customizado (briga, insubordinação…), a alínea "e" (desídia) não é o
    // enquadramento certo — o aviso vai sem alínea para não enquadrar errado.
    justificationRuns.push(
      new TextRun({
        text: customReason
          ? "ATENÇÃO: A reiteração desta conduta poderá ensejar a RESCISÃO DO CONTRATO DE TRABALHO POR JUSTA CAUSA, nos termos do artigo 482 da CLT."
          : "ATENÇÃO: A próxima falta injustificada poderá ensejar a RESCISÃO DO CONTRATO DE TRABALHO POR JUSTA CAUSA, nos termos do artigo 482, alínea \"e\" (desídia no desempenho das respectivas funções) da CLT.",
        font: "Arial", size: F, bold: true,
      })
    );
  }

  justificationRuns.push(
    new TextRun({
      text: " Esperamos que, ao retornar, demonstre compromisso renovado com suas obrigações profissionais.",
      font: "Arial", size: F,
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children: [
          // Company header
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 40 },
            children: [
              new TextRun({ text: data.companyName.toUpperCase(), font: "Arial", size: FT, bold: true }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
              new TextRun({ text: `CNPJ: ${data.cnpj}`, font: "Arial", size: FS, color: "666666" }),
            ],
          }),
          lineSeparator(),
          // Title
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
            children: [
              new TextRun({ text: "TERMO DE SUSPENSÃO DISCIPLINAR", font: "Arial", size: FT, bold: true }),
            ],
          }),
          // Date
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { after: 120 },
            children: [
              new TextRun({ text: formatDateFull(data.startDate), font: "Arial", size: FS, italics: true }),
            ],
          }),
          // Intro
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: "Pelo presente instrumento, fica o(a) empregado(a) abaixo identificado(a) suspenso(a) de suas atividades laborais:", font: "Arial", size: F }),
            ],
          }),
          // Employee data
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: "Empregado(a): ", font: "Arial", size: F, bold: true }),
              new TextRun({ text: data.employeeName, font: "Arial", size: F }),
            ],
          }),
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: "CPF: ", font: "Arial", size: F, bold: true }),
              new TextRun({ text: data.cpf, font: "Arial", size: F }),
            ],
          }),
          // Period
          new Paragraph({
            spacing: { before: 60, after: 40 },
            children: [
              new TextRun({ text: "Período de suspensão: ", font: "Arial", size: F, bold: true }),
              new TextRun({ text: `${formatDateBR(data.startDate)} a ${formatDateBR(endDate)}`, font: "Arial", size: F }),
            ],
          }),
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: "Total de dias: ", font: "Arial", size: F, bold: true }),
              new TextRun({ text: `${data.suspensionDays.toString().padStart(2, "0")} (${data.suspensionDays > 1 ? extenso(data.suspensionDays) : "um"}) dia${data.suspensionDays > 1 ? "s" : ""}`, font: "Arial", size: F }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: "Data de retorno: ", font: "Arial", size: F, bold: true }),
              new TextRun({ text: formatDateBR(returnDate), font: "Arial", size: F }),
            ],
          }),
          lineSeparator(),
          // Justification
          new Paragraph({
            spacing: { before: 80, after: 40 },
            children: [
              new TextRun({ text: "FUNDAMENTAÇÃO:", font: "Arial", size: F, bold: true }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            alignment: AlignmentType.JUSTIFIED,
            children: justificationRuns,
          }),
          // Legal basis
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: "Base Legal: ", font: "Arial", size: FS, bold: true, italics: true }),
              new TextRun({ text: "Art. 2º, Art. 474 e Art. 482 da CLT.", font: "Arial", size: FS, italics: true }),
            ],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({ text: "Para que produza os devidos efeitos legais, firmo o presente termo em 02 (duas) vias de igual teor e forma.", font: "Arial", size: F, italics: true }),
            ],
          }),
          lineSeparator(),
          // Signatures - side by side using tab stops
          new Paragraph({ spacing: { before: 200, after: 20 },
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "________________________________________", font: "Arial", size: F }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 10 },
            children: [
              new TextRun({ text: data.employeeName, font: "Arial", size: F, bold: true }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 10 },
            children: [
              new TextRun({ text: `CPF: ${data.cpf}`, font: "Arial", size: FS, color: "555555" }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
              new TextRun({ text: "Empregado(a)", font: "Arial", size: 16, italics: true, color: "888888" }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 20 },
            children: [
              new TextRun({ text: "________________________________________", font: "Arial", size: F }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 10 },
            children: [
              new TextRun({ text: data.companyName, font: "Arial", size: F, bold: true }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 10 },
            children: [
              new TextRun({ text: `CNPJ: ${data.cnpj}`, font: "Arial", size: FS, color: "555555" }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Empregador", font: "Arial", size: 16, italics: true, color: "888888" }),
            ],
          }),
        ],
      },
    ],
  });

  return doc;
}

function extenso(n: number): string {
  const nomes = [
    "", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
    "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete",
    "dezoito", "dezenove", "vinte", "vinte e um", "vinte e dois", "vinte e três",
    "vinte e quatro", "vinte e cinco", "vinte e seis", "vinte e sete", "vinte e oito",
    "vinte e nove", "trinta",
  ];
  return nomes[n] || n.toString();
}

export async function downloadSuspensionDoc(data: SuspensionData): Promise<{ blob: Blob; fileName: string }> {
  const doc = generateSuspensionDoc(data);
  const blob = await Packer.toBlob(doc);
  const fileName = `suspensao_${data.employeeName.replace(/\s+/g, "_").toLowerCase()}_${formatDateBR(data.startDate).replace(/\//g, "-")}.docx`;
  saveAs(blob, fileName);
  return { blob, fileName };
}
