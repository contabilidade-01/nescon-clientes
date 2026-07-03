import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { maskCNPJ } from "@/lib/masks";

/** Desconto agregado no recibo ad hoc (vale, adiantamento, farmácia, alimentação). */
export const ADHOC_VALE_COMPOSITE_LABEL = "Vale/Adiantamento/Farmacia/Alimentação";

export interface AdhocPayslipData {
  companyName: string;
  companyCnpjDigits: string;
  refMonthTitle: string;
  employeeName: string;
  employeeCode: string;
  salarioBase: number;
  diasBrutos: number;
  faltasCount: number;
  diasLiquidos: number;
  descontoFaltas: number;
  valorDia: number;
  bruto: number;
  vale: number;
  outros: number;
  liquido: number;
  faltaDatesText: string;
}

function moneyPt(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildFileName(data: AdhocPayslipData): string {
  const safe = data.employeeName
    .replace(/\s+/g, "_")
    .replace(/[^\w\-àáâãäåèéêëìíîïòóôõöùúûüçñÁÀÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑ]/gi, "");
  const monthSafe = data.refMonthTitle.replace(/\s+/g, "_").replace(/[^\w\-àáâã]/gi, "");
  return `holerite_avulso_${safe || "funcionario"}_${monthSafe || "ref"}.pdf`;
}

type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

/**
 * Recibo em PDF via jsPDF + jspdf-autotable (Helvetica integrada, sem .ttf nem VFS).
 * Evita erros do tipo "Roboto-Medium.ttf not found" do pdfmake em produção.
 */
export async function downloadAdhocPayslipPdf(data: AdhocPayslipData): Promise<void> {
  const digits = data.companyCnpjDigits.replace(/\D/g, "").slice(0, 14);
  const cnpjMask = digits.length ? maskCNPJ(digits) : "-";
  const totalDesc = data.descontoFaltas + data.vale + data.outros;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  // Documento entregue ao funcionário: sem notas internas de cálculo
  // (modo de escolha de dias, fórmulas, avisos de conferência).
  const bodyRows: string[][] = [
    [
      "8781",
      "SALARIO PROPORCIONAL",
      String(data.diasBrutos),
      moneyPt(data.bruto),
      "-",
    ],
  ];
  if (data.descontoFaltas > 0) {
    bodyRows.push([
      "",
      `Faltas (${data.faltasCount} dia(s))${data.faltaDatesText ? `: ${data.faltaDatesText}` : ""}`,
      String(data.faltasCount),
      "-",
      moneyPt(data.descontoFaltas),
    ]);
  }
  if (data.vale > 0) {
    bodyRows.push(["", ADHOC_VALE_COMPOSITE_LABEL, "-", "-", moneyPt(data.vale)]);
  }
  if (data.outros > 0) {
    bodyRows.push(["", "Outros descontos", "-", "-", moneyPt(data.outros)]);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("RECIBO DE PAGAMENTO DE SALARIO", pageW / 2, y, { align: "center" });
  y += 10;

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(data.companyName || "-", margin, y);
  doc.text("Folha mensal", pageW - margin, y, { align: "right" });
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`CNPJ: ${cnpjMask}`, margin, y);
  doc.text(data.refMonthTitle, pageW - margin, y, { align: "right" });
  y += 7;

  doc.setFontSize(9);
  doc.text(`Codigo: ${data.employeeCode}`, margin, y);
  doc.text(`Nome do funcionario: ${data.employeeName}`, margin + 32, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [["Cod.", "Descricao", "Referencia", "Vencimentos", "Descontos"]],
    body: bodyRows,
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 1.5, valign: "middle" },
    headStyles: { fillColor: [230, 230, 230], textColor: 0, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: "auto" },
      2: { halign: "right", cellWidth: 22 },
      3: { halign: "right", cellWidth: 26 },
      4: { halign: "right", cellWidth: 26 },
    },
    margin: { left: margin, right: margin },
  });

  const d = doc as DocWithAutoTable;
  y = (d.lastAutoTable?.finalY ?? y) + 4;

  autoTable(doc, {
    startY: y,
    body: [
      [
        `Salario base: R$ ${moneyPt(data.salarioBase)}\nDias considerados: ${data.diasBrutos} - Valor/dia: R$ ${moneyPt(data.valorDia)}`,
        `Total vencimentos\nR$ ${moneyPt(data.bruto)}`,
        `Total descontos\nR$ ${moneyPt(totalDesc)}`,
        `Valor liquido\nR$ ${moneyPt(data.liquido)}`,
      ],
    ],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2, valign: "middle" },
    columnStyles: {
      0: { fontStyle: "normal" },
      1: { fontStyle: "bold", halign: "right", cellWidth: 28 },
      2: { fontStyle: "bold", halign: "right", cellWidth: 28 },
      3: { fontStyle: "bold", halign: "right", fontSize: 9, cellWidth: 30 },
    },
    margin: { left: margin, right: margin },
  });

  y = (d.lastAutoTable?.finalY ?? y) + 10;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Declaro ter recebido a importancia liquida discriminada neste recibo.", pageW / 2, y, {
    align: "center",
  });
  y += 7;
  doc.text("Data: _____ / _____ / _________", pageW / 2, y, { align: "center" });
  y += 12;
  doc.text("____________________________________", pageW / 2, y, { align: "center" });
  y += 5;
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text("Assinatura do funcionario", pageW / 2, y, { align: "center" });

  doc.save(buildFileName(data));
}
