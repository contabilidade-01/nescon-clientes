import { Paragraph, TextRun, AlignmentType } from "docx";

const F = 20;
const FS = 18;

/** Campos de testemunha no termo (recusa de assinatura do empregado). */
export function paragrafosTestemunhasTermo(): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 200, after: 80 },
      children: [
        new TextRun({
          text:
            "Havendo recusa do(a) empregado(a) em assinar o presente termo, as testemunhas abaixo atestam que " +
            "o documento lhe foi lido e apresentado, dando-lhe plena ciência do seu conteúdo, e que a assinatura foi recusada.",
          font: "Arial",
          size: FS,
          italics: true,
        }),
      ],
    }),
    ...[1, 2].flatMap((n) => [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: n === 1 ? 160 : 200, after: 20 },
        children: [new TextRun({ text: "________________________________________", font: "Arial", size: F })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 10 },
        children: [new TextRun({ text: `Testemunha ${n}`, font: "Arial", size: FS, bold: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 8 },
        children: [new TextRun({ text: "Nome: ________________________________", font: "Arial", size: 17, color: "555555" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [new TextRun({ text: "CPF: _________________________________", font: "Arial", size: 17, color: "555555" })],
      }),
    ]),
  ];
}
