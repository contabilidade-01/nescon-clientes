import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle
} from "docx";
import { saveAs } from "file-saver";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { paragrafosTestemunhasTermo } from "@/lib/testemunhasTermo";

export interface WarningData {
  employeeName: string;
  cpf: string;
  companyName: string;
  cnpj: string;
  warningDate: Date;
  reason: string;
  previousWarnings: string[];
  unjustifiedAbsences: string[];
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

export function generateWarningDoc(data: WarningData) {
  const reasonRuns: TextRun[] = [];

  // Garante ponto final — o texto seguinte continua no mesmo parágrafo.
  const reasonText = data.reason.trim();
  reasonRuns.push(
    new TextRun({
      text: /[.!?]$/.test(reasonText) ? reasonText : `${reasonText}.`,
      font: "Arial", size: F,
    })
  );

  if (data.previousWarnings.length > 0) {
    reasonRuns.push(
      new TextRun({
        text: ` Registra-se que V.S. já recebeu advertências anteriores: ${data.previousWarnings.join(", ")}.`,
        font: "Arial", size: F,
      })
    );
  }

  if (data.unjustifiedAbsences.length > 0) {
    reasonRuns.push(
      new TextRun({
        text: ` Constam ainda faltas sem justificativa nos dias: ${data.unjustifiedAbsences.join(", ")}.`,
        font: "Arial", size: F,
      })
    );
  }

  reasonRuns.push(
    new TextRun({
      text: " A presente advertência é aplicada com fundamento no artigo 2º da Consolidação das Leis do Trabalho (CLT), que confere ao empregador o poder diretivo e disciplinar sobre seus empregados.",
      font: "Arial", size: F,
    })
  );

  reasonRuns.push(
    new TextRun({
      text: " Ressalta-se que, nos termos do artigo 482 da CLT, a reiteração deste tipo de conduta poderá acarretar penalidades mais severas, incluindo suspensão disciplinar e, em última instância, a rescisão do contrato de trabalho por justa causa.",
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
              new TextRun({ text: "TERMO DE ADVERTÊNCIA DISCIPLINAR", font: "Arial", size: FT, bold: true }),
            ],
          }),
          // Date
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { after: 120 },
            children: [
              new TextRun({ text: formatDateFull(data.warningDate), font: "Arial", size: FS, italics: true }),
            ],
          }),
          // Intro
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: "Pelo presente instrumento, fica o(a) empregado(a) abaixo identificado(a) formalmente advertido(a):", font: "Arial", size: F }),
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
          lineSeparator(),
          // Reason
          new Paragraph({
            spacing: { before: 80, after: 40 },
            children: [
              new TextRun({ text: "MOTIVO DA ADVERTÊNCIA:", font: "Arial", size: F, bold: true }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            alignment: AlignmentType.JUSTIFIED,
            children: reasonRuns,
          }),
          // Legal basis
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: "Base Legal: ", font: "Arial", size: FS, bold: true, italics: true }),
              new TextRun({ text: "Art. 2º e Art. 482 da CLT.", font: "Arial", size: FS, italics: true }),
            ],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({ text: "Para que produza os devidos efeitos legais, firmo o presente termo em 02 (duas) vias de igual teor e forma.", font: "Arial", size: F, italics: true }),
            ],
          }),
          lineSeparator(),
          // Signatures
          new Paragraph({
            spacing: { before: 200, after: 20 },
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
          ...paragrafosTestemunhasTermo(),
        ],
      },
    ],
  });

  return doc;
}

export async function downloadWarningDoc(data: WarningData): Promise<{ blob: Blob; fileName: string }> {
  const doc = generateWarningDoc(data);
  const blob = await Packer.toBlob(doc);
  const fileName = `advertencia_${data.employeeName.replace(/\s+/g, "_").toLowerCase()}_${formatDateBR(data.warningDate).replace(/\//g, "-")}.docx`;
  saveAs(blob, fileName);
  return { blob, fileName };
}
