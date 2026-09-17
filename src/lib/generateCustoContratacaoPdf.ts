import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type CustoContratacaoPdfPayload = {
  regimeLabel: string;
  salario: number;
  outrosFixos: number;
  encargosLabel: string;
  encargos: number;
  valeTransporte: number;
  valeRefeicao: number;
  honorario: number;
  custoDireto: number;
  incluiProvisoes: boolean;
  decimoTerceiro: number;
  ferias: number;
  encargosProvisoesLabel: string;
  encargosProvisoes: number;
  provisoes: number;
  totalMensal: number;
  projecaoAnual: number;
  pctSalario: number;
  nota: string;
};

const brl = (n: number) =>
  "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

/**
 * PDF da simulação da Calculadora de Custo de Contratação (jsPDF + autotable).
 */
export async function downloadCustoContratacaoPdf(p: CustoContratacaoPdfPayload): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("SIMULAÇÃO — CUSTO DE CONTRATAÇÃO", pageW / 2, y, { align: "center" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Nescon Contabilidade", pageW / 2, y, { align: "center" });
  y += 8;

  const paramRows: string[][] = [
    ["Regime tributário", p.regimeLabel],
    ["Salário bruto mensal", brl(p.salario)],
  ];
  if (p.outrosFixos > 0) paramRows.push(["Outros custos fixos", brl(p.outrosFixos)]);
  if (p.valeTransporte > 0) paramRows.push(["Vale-transporte / mês", brl(p.valeTransporte)]);
  if (p.valeRefeicao > 0) paramRows.push(["Vale-refeição / mês", brl(p.valeRefeicao)]);
  paramRows.push(["Honorário contábil adicional", brl(p.honorario)]);
  paramRows.push(["Provisões de 13º e férias", p.incluiProvisoes ? "Sim" : "Não"]);

  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 1.6 },
    columnStyles: {
      0: { cellWidth: 70, fontStyle: "bold" },
      1: { cellWidth: pageW - margin * 2 - 70 },
    },
    head: [
      [
        {
          content: "Parâmetros da simulação",
          colSpan: 2,
          styles: { fontStyle: "bold", fontSize: 10, fillColor: [240, 240, 240] },
        },
      ],
    ],
    body: paramRows,
    margin: { left: margin, right: margin },
  });

  const d2 = doc as DocWithAutoTable;
  y = (d2.lastAutoTable?.finalY || y) + 6;

  const calcRows: string[][] = [
    ["Salário bruto", brl(p.salario)],
  ];
  if (p.outrosFixos > 0) calcRows.push(["Outros custos fixos", brl(p.outrosFixos)]);
  calcRows.push([p.encargosLabel, brl(p.encargos)]);
  if (p.valeTransporte > 0) calcRows.push(["Vale-transporte", brl(p.valeTransporte)]);
  if (p.valeRefeicao > 0) calcRows.push(["Vale-refeição", brl(p.valeRefeicao)]);
  calcRows.push(["Honorário contábil", brl(p.honorario)]);
  calcRows.push(["Custo mensal direto", brl(p.custoDireto)]);

  if (p.incluiProvisoes) {
    calcRows.push(["13º salário (1/12)", brl(p.decimoTerceiro)]);
    calcRows.push(["Férias + 1/3 (1/12)", brl(p.ferias)]);
    calcRows.push([p.encargosProvisoesLabel, brl(p.encargosProvisoes)]);
    calcRows.push(["Provisões mensais", brl(p.provisoes)]);
  }

  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 1.6 },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: pageW - margin * 2 - 90, halign: "right", fontStyle: "bold" },
    },
    head: [
      [
        {
          content: "Memória de cálculo",
          colSpan: 2,
          styles: { fontStyle: "bold", fontSize: 10, fillColor: [240, 240, 240] },
        },
      ],
    ],
    body: calcRows,
    margin: { left: margin, right: margin },
  });

  y = (d2.lastAutoTable?.finalY || y) + 8;

  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(52, 211, 153);
  doc.roundedRect(margin, y, pageW - margin * 2, 22, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(5, 150, 105);
  doc.text("CUSTO MENSAL TOTAL", margin + 4, y + 7);
  doc.setFontSize(16);
  doc.text(brl(p.totalMensal), margin + 4, y + 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(
    `Projeção anual: ${brl(p.projecaoAnual)}  •  equivale a ${p.pctSalario}% do salário`,
    margin + 4,
    y + 20,
  );

  y += 28;
  doc.setTextColor(80);
  doc.setFontSize(8);
  const nota = `Observação. ${p.nota} Não inclui outros benefícios de convenção coletiva, adicionais, horas extras ou rescisão. Valores estimados para fins gerenciais.`;
  const lines = doc.splitTextToSize(nota, pageW - margin * 2);
  doc.text(lines, margin, y);

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Nescon Contabilidade • CNPJ 35.736.034/0001-23", pageW / 2, pageH - 10, {
    align: "center",
  });

  const salSafe = Math.round(p.salario).toString();
  doc.save(`custo_contratacao_${salSafe}.pdf`);
}
