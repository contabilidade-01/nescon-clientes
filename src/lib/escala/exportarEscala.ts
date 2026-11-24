import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { diaDaSemana } from "./datas";
import { minutosTrabalhados, type DiaEscala } from "./modelos";

/**
 * Baixar a escala do mês que está na tela (salva ou só simulada): PDF para imprimir e
 * afixar no mural, e planilha Excel para quem quer mexer. Gerado no navegador a partir do
 * que o planejador já calculou, então o arquivo é exatamente o que o cliente está vendo.
 */

export interface PessoaExportada {
  nome: string;
  /** "Trabalha 5 dias e folga sábado e domingo, das 08:00 às 17:00." */
  descricao: string;
  /** Dias do mês planejado (folga = turno null). */
  dias: DiaEscala[];
}

export interface EscalaExportada {
  /** 'YYYY-MM'. */
  mes: string;
  empresa?: string;
  /** Regra do mês em uma frase. */
  regra: string;
  pessoas: PessoaExportada[];
  /** Feriados do mês: data -> nome. */
  feriados: Map<string, string>;
  /** Quantos pontos fora da regra: o arquivo sai marcado como rascunho. */
  erros: number;
}

const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const nomeMes = (mes: string) => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;
const horas = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
};

/** Texto da célula: "08:00–17:00" ou "Folga" (com o feriado, se houver). */
export function textoDoDia(d: DiaEscala | undefined, feriado?: string): string {
  if (!d) return "";
  if (!d.turno) return feriado ? `Folga (${feriado})` : "Folga";
  const t = `${d.turno.entrada}–${d.turno.saida}`;
  return feriado ? `${t} (feriado)` : t;
}

/** Semanas de domingo a sábado que tocam o mês; dias fora do mês ficam null. */
export function semanasDoMes(datas: string[]): Array<Array<string | null>> {
  const semanas: Array<Array<string | null>> = [];
  let atual: Array<string | null> = Array(diaDaSemana(datas[0])).fill(null);
  for (const d of datas) {
    atual.push(d);
    if (atual.length === 7) {
      semanas.push(atual);
      atual = [];
    }
  }
  if (atual.length) semanas.push([...atual, ...Array(7 - atual.length).fill(null)]);
  return semanas;
}

function minutosNos(dias: DiaEscala[], datas: Array<string | null>): number {
  return dias.filter((d) => datas.includes(d.data) && d.turno).reduce((a, d) => a + minutosTrabalhados(d.turno!), 0);
}

/** Linhas da planilha: cabeçalho com os dias, uma linha por pessoa e as horas do mês. */
export function linhasDaPlanilha(e: EscalaExportada): string[][] {
  const datas = e.pessoas[0]?.dias.map((d) => d.data) ?? [];
  const cabecalho = ["Funcionário", ...datas.map((d) => `${DIAS_CURTOS[diaDaSemana(d)]} ${ddmm(d)}`), "Horas no mês"];
  const linhas = e.pessoas.map((p) => [
    p.nome,
    ...datas.map((d) => textoDoDia(p.dias.find((x) => x.data === d), e.feriados.get(d))),
    horas(minutosNos(p.dias, datas)),
  ]);
  return [cabecalho, ...linhas];
}

function nomeArquivo(e: EscalaExportada, ext: string) {
  const empresa = (e.empresa || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `escala-${e.mes}${empresa ? `-${empresa}` : ""}.${ext}`;
}

export function baixarEscalaXlsx(e: EscalaExportada): void {
  const grade = linhasDaPlanilha(e);
  const sheet = XLSX.utils.aoa_to_sheet(grade);
  sheet["!cols"] = [{ wch: 28 }, ...grade[0].slice(1, -1).map(() => ({ wch: 13 })), { wch: 12 }];
  sheet["!freeze"] = { xSplit: 1, ySplit: 1 };
  const resumo = XLSX.utils.aoa_to_sheet([
    [`Escala de ${nomeMes(e.mes)}${e.empresa ? ` · ${e.empresa}` : ""}`],
    [e.regra],
    ...(e.erros ? [["Rascunho: a escala ainda tem pontos fora da regra."]] : []),
    [],
    ["Funcionário", "Como trabalha"],
    ...e.pessoas.map((p) => [p.nome, p.descricao]),
  ]);
  resumo["!cols"] = [{ wch: 28 }, { wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Escala do mês");
  XLSX.utils.book_append_sheet(wb, resumo, "Resumo");
  XLSX.writeFile(wb, nomeArquivo(e, "xlsx"));
}

type DocComTabela = jsPDF & { lastAutoTable?: { finalY: number } };

/** Monta o PDF (paisagem, uma tabela por semana, para afixar no mural). */
export function pdfDaEscala(e: EscalaExportada): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as DocComTabela;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(`Escala de trabalho · ${nomeMes(e.mes)}`, margin, margin + 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let y = margin + 7;
  if (e.empresa) {
    doc.text(e.empresa, margin, y);
    y += 4.5;
  }
  doc.text(e.regra, margin, y);
  y += 4.5;
  if (e.erros) {
    doc.setTextColor(200, 30, 30);
    doc.setFont("helvetica", "bold");
    doc.text("RASCUNHO: esta escala ainda tem pontos fora da regra. Corrija antes de usar.", margin, y);
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
    y += 4.5;
  }

  const datas = e.pessoas[0]?.dias.map((d) => d.data) ?? [];
  const larguraDia = (pageW - 2 * margin - 52 - 18) / 7;
  for (const semana of semanasDoMes(datas)) {
    const dentro = semana.filter((d): d is string => Boolean(d));
    autoTable(doc, {
      startY: y + 2,
      margin: { left: margin, right: margin },
      theme: "grid",
      rowPageBreak: "avoid",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 1.5, halign: "center", valign: "middle" },
      headStyles: { fillColor: [30, 64, 120], textColor: 255, fontStyle: "bold" },
      // Colunas dos dias com a mesma largura em todas as semanas, para o mural ficar alinhado.
      columnStyles: {
        0: { halign: "left", cellWidth: 52, fontStyle: "bold" },
        ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [i, { cellWidth: larguraDia }])),
        8: { cellWidth: 18 },
      },
      head: [
        [
          `Semana de ${ddmm(dentro[0])} a ${ddmm(dentro.at(-1)!)}`,
          ...semana.map((d, i) => (d ? `${DIAS_CURTOS[i]} ${ddmm(d)}${e.feriados.has(d) ? " *" : ""}` : DIAS_CURTOS[i])),
          "Horas",
        ],
      ],
      body: e.pessoas.map((p) => [
        p.nome,
        ...semana.map((d) => (d ? textoDoDia(p.dias.find((x) => x.data === d)) : "")),
        horas(minutosNos(p.dias, semana)),
      ]),
      didParseCell: (c) => {
        if (c.section === "body" && c.cell.raw === "Folga") {
          c.cell.styles.fillColor = [232, 236, 242];
          c.cell.styles.textColor = 90;
        }
      },
    });
    y = doc.lastAutoTable?.finalY ?? y;
  }

  const feriadosDoMes = [...e.feriados].filter(([d]) => d.startsWith(e.mes)).sort();
  if (feriadosDoMes.length) {
    if (y > pageH - 24) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(8);
    doc.text(`* Feriados: ${feriadosDoMes.map(([d, n]) => `${ddmm(d)} ${n}`).join(" · ")}`, margin, y + 5);
  }

  const paginas = doc.getNumberOfPages();
  const emissao = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(`Gerado em ${emissao} · Nescon Contabilidade`, margin, pageH - 6);
    doc.text(`${i}/${paginas}`, pageW - margin, pageH - 6, { align: "right" });
    doc.setTextColor(0);
  }
  return doc;
}

export function baixarEscalaPdf(e: EscalaExportada): void {
  pdfDaEscala(e).save(nomeArquivo(e, "pdf"));
}
