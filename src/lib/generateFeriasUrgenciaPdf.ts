import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Relatório em PDF da tela Férias — Urgência: quem está prestes a perder dias de férias,
 * empresa por empresa.
 *
 * Gerado no navegador (jsPDF + autotable, como os outros PDFs do painel) a partir dos
 * dados JÁ carregados na tela — o que está no papel é exatamente o que o escritório
 * está vendo, inclusive o filtro de busca aplicado.
 *
 * Paisagem de propósito: são oito colunas por funcionário, e em retrato o nome fica
 * cortado — justamente o dado que o escritório usa para cobrar o cliente.
 */

export type FeriasUrgenciaFuncionario = {
  nome: string;
  admissao?: string | null;
  inicio_aquisitivo?: string | null;
  fim_aquisitivo?: string | null;
  limite_gozo?: string | null;
  dias_direito?: number | null;
  dias_restantes?: number | null;
  faltas?: number | null;
  situacao?: string | null;
  origem_salario?: string | null;
  custo?: { total?: number | null } | null;
  alerta_faltas?: { faltasAtuais: number; faltasRestantes: number; diasAtuais: number; diasDepois: number } | null;
};

export type FeriasUrgenciaEmpresa = {
  empresa_nome: string;
  empresa_cnpj: string;
  custo_total?: number | null;
  funcionarios: FeriasUrgenciaFuncionario[];
};

export type FeriasUrgenciaPdfPayload = {
  empresas: FeriasUrgenciaEmpresa[];
  total_empresas?: number | null;
  total_funcionarios?: number | null;
  total_vencidos?: number | null;
  total_em_risco_faltas?: number | null;
  custo_carteira?: number | null;
  /** Texto do filtro aplicado na tela, para o PDF não parecer a carteira inteira. */
  filtro?: string;
};

const SITUACAO: Record<string, string> = {
  vencida: "Vencida",
  a_vencer: "Vence em breve",
  ok: "No prazo",
  sem_limite: "Sem data",
};

const brl = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dataBR = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

type DocComTabela = jsPDF & { lastAutoTable?: { finalY: number } };

export function downloadFeriasUrgenciaPdf(p: FeriasUrgenciaPdfPayload): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as DocComTabela;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const emissao = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("FÉRIAS — URGÊNCIA", pageW / 2, margin + 2, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Nescon Contabilidade · funcionários prestes a perder dias de férias", pageW / 2, margin + 7, {
    align: "center",
  });

  const resumo = [
    ["Empresas", String(p.total_empresas ?? p.empresas.length)],
    ["Funcionários em risco", String(p.total_funcionarios ?? "—")],
    ["Férias vencidas", String(p.total_vencidos ?? "—")],
    ["A ≤3 faltas de perder dias", String(p.total_em_risco_faltas ?? "—")],
    ["Custo da carteira", brl(p.custo_carteira)],
  ];

  autoTable(doc, {
    startY: margin + 11,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.4 },
    body: [resumo.map(([r]) => r), resumo.map(([, v]) => v)],
    didParseCell: (d) => {
      if (d.row.index === 0) d.cell.styles.textColor = 110;
      else d.cell.styles.fontStyle = "bold";
    },
  });

  let y = (doc.lastAutoTable?.finalY ?? margin + 20) + 3;
  if (p.filtro?.trim()) {
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(`Filtro aplicado: "${p.filtro.trim()}" — o relatório traz apenas o que está em tela.`, margin, y);
    doc.setTextColor(0);
    y += 4;
  }

  for (const emp of p.empresas) {
    const emRiscoFaltas = emp.funcionarios.filter(
      (f) => f.alerta_faltas && f.alerta_faltas.faltasRestantes <= 3
    ).length;

    const corpo = emp.funcionarios.map((f) => [
      f.nome,
      dataBR(f.admissao),
      `${dataBR(f.inicio_aquisitivo)} a ${dataBR(f.fim_aquisitivo)}`,
      dataBR(f.limite_gozo),
      String(f.dias_direito ?? "—"),
      f.faltas === null || f.faltas === undefined ? "—" : String(f.faltas),
      SITUACAO[String(f.situacao)] || "—",
      `${f.origem_salario === "media_folha" ? "~" : ""}${brl(f.custo?.total)}`,
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: "striped",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 1.6, overflow: "linebreak" },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 62 },
        4: { halign: "center" },
        5: { halign: "center" },
        7: { halign: "right" },
      },
      head: [
        [
          {
            content:
              `${emp.empresa_nome}  (${emp.empresa_cnpj})  ·  ${emp.funcionarios.length} funcionário(s)  ·  ${brl(emp.custo_total)}` +
              (emRiscoFaltas ? `  ·  ${emRiscoFaltas} a 3 faltas ou menos de perder dias` : ""),
            colSpan: 8,
            styles: { halign: "left", fillColor: [15, 23, 42] as [number, number, number], fontSize: 9 },
          },
        ],
        ["Funcionário", "Admissão", "Período aquisitivo", "Tirar até", "Dias", "Faltas", "Situação", "Custo estimado"],
      ],
      body: corpo,
      didParseCell: (d) => {
        // Vencida em vermelho: é a linha que o escritório precisa achar de relance.
        if (d.section === "body" && d.column.index === 6 && d.cell.raw === "Vencida") {
          d.cell.styles.textColor = [185, 28, 28];
          d.cell.styles.fontStyle = "bold";
        }
      },
    });

    y = (doc.lastAutoTable?.finalY ?? y) + 6;
    // Espaço mínimo para o cabeçalho da próxima empresa não ficar sozinho no pé.
    if (y > pageH - 30) {
      doc.addPage();
      y = margin;
    }
  }

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(`Emitido em ${emissao}`, margin, pageH - 6);
    doc.text(
      "Custo estimado: férias + 1/3 + FGTS. O “~” marca salário estimado pela média da folha.",
      pageW / 2,
      pageH - 6,
      { align: "center" }
    );
    doc.text(`${i}/${paginas}`, pageW - margin, pageH - 6, { align: "right" });
    doc.setTextColor(0);
  }

  const hoje = new Date().toISOString().slice(0, 10);
  doc.save(`ferias_urgencia_${hoje}.pdf`);
}
