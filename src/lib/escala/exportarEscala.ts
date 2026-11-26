import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { diaDaSemana } from "./datas";
import { minutosTrabalhados, type DiaEscala } from "./modelos";
import { coberturaPorCargo } from "./cargos";
import type { Demanda } from "./contingente";

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
  /** 12x36: a lei mede a semana pela média de duas, então o arquivo mostra a média. */
  doze36?: boolean;
  /**
   * Semanas inteiras (domingo a sábado) como a lei conta, inclusive a cortada pelo mês,
   * com os dias do mês vizinho. Sem elas, a semana cortada sai "(parcial)".
   */
  semanas?: SemanaExportada[];
  /** Cargo (cozinheiro, garçom…): sai embaixo do nome e conta na cobertura por cargo. */
  cargo?: string;
  /** Unidade (loja/filial): com mais de uma, o PDF sai separado, uma unidade por página. */
  unidade?: string;
}

export interface SemanaExportada {
  /** Domingo que abre a semana. */
  inicio: string;
  horas: number;
  folgas: number;
  limiteHoras: number;
  repousosExigidos: number;
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
  /** Mínimo de cada cargo por dia da semana: o PDF mostra quantos de cada cargo trabalham. */
  minimoPorCargo?: Record<string, Demanda>;
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

/** Domingo que abre a semana da tabela (a semana pode começar no mês anterior). */
function inicioDa(semana: Array<string | null>): string {
  const i = semana.findIndex(Boolean);
  const d = new Date(`${semana[i]}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - i);
  return d.toISOString().slice(0, 10);
}

/** A semana inteira da pessoa (pela lei) que corresponde à semana da tabela. */
export function semanaDaLei(p: PessoaExportada, semana: Array<string | null>): SemanaExportada | undefined {
  const inicio = inicioDa(semana);
  return p.semanas?.find((s) => s.inicio === inicio);
}

/** "40h de 42h · 2 folgas" (+ "(ACIMA)" / "(FALTA FOLGA)" quando sai da regra). */
export function textoDaSemanaDaLei(s: SemanaExportada): string {
  const base = `${horas(s.horas * 60)} de ${s.limiteHoras}h · ${s.folgas} folga${s.folgas === 1 ? "" : "s"}`;
  const fora = [s.horas > s.limiteHoras + 1e-9 && "ACIMA", s.folgas < s.repousosExigidos && "FALTA FOLGA"].filter(Boolean);
  return fora.length ? `${base} (${fora.join(", ")})` : base;
}

function minutosNos(dias: DiaEscala[], datas: Array<string | null>): number {
  return dias.filter((d) => datas.includes(d.data) && d.turno).reduce((a, d) => a + minutosTrabalhados(d.turno!), 0);
}

/** Média de horas por semana nas semanas inteiras (domingo a sábado) do mês. */
export function mediaSemanal(dias: DiaEscala[], datas: string[]): number | null {
  const cheias = semanasDoMes(datas).filter((w) => w.every(Boolean));
  if (!cheias.length) return null;
  return cheias.reduce((a, w) => a + minutosNos(dias, w), 0) / cheias.length;
}

/**
 * 12x36: a mesma régua da tela ("Maior semana"), a maior média de duas semanas inteiras
 * seguidas. Na 12x36 as semanas alternam 44h e 33h, então a média de cada par é 38h30.
 */
export function mediaDe2Semanas(dias: DiaEscala[], datas: string[]): number | null {
  const cheias = semanasDoMes(datas).filter((w) => w.every(Boolean));
  if (cheias.length < 2) return null;
  let maior = 0;
  for (let i = 1; i < cheias.length; i++) maior = Math.max(maior, (minutosNos(dias, cheias[i - 1]) + minutosNos(dias, cheias[i])) / 2);
  return maior;
}

/** Linhas da planilha: cabeçalho com os dias, uma linha por pessoa e as horas do mês. */
export function linhasDaPlanilha(e: EscalaExportada): string[][] {
  const datas = e.pessoas[0]?.dias.map((d) => d.data) ?? [];
  const comCargo = e.pessoas.some((p) => p.cargo);
  const cabecalho = [
    "Funcionário",
    ...(comCargo ? ["Cargo"] : []),
    ...datas.map((d) => `${DIAS_CURTOS[diaDaSemana(d)]} ${ddmm(d)}`),
    "Horas no mês",
    "Média por semana",
  ];
  const linhas = e.pessoas.map((p) => {
    const media = p.doze36 ? mediaDe2Semanas(p.dias, datas) : mediaSemanal(p.dias, datas);
    return [
      p.nome,
      ...(comCargo ? [p.cargo ?? ""] : []),
      ...datas.map((d) => textoDoDia(p.dias.find((x) => x.data === d), e.feriados.get(d))),
      horas(minutosNos(p.dias, datas)),
      media === null ? "" : horas(media),
    ];
  });
  return [cabecalho, ...linhas];
}

/**
 * Uma linha por pessoa e semana inteira (domingo a sábado), contando os dias do mês
 * vizinho, que é como a lei mede: horas x limite e folgas x exigidas.
 */
export function linhasDasSemanas(e: EscalaExportada): string[][] {
  const cab = ["Funcionário", "Semana", "Horas", "Limite", "Folgas", "Exigidas", "Situação"];
  const linhas: string[][] = [];
  for (const p of e.pessoas) {
    if (p.doze36) continue;
    for (const s of p.semanas ?? []) {
      const fim = new Date(`${s.inicio}T12:00:00Z`);
      fim.setUTCDate(fim.getUTCDate() + 6);
      const problemas = [s.horas > s.limiteHoras + 1e-9 && "acima do limite", s.folgas < s.repousosExigidos && "falta folga"].filter(Boolean);
      linhas.push([
        p.nome,
        `${ddmm(s.inicio)} a ${ddmm(fim.toISOString().slice(0, 10))}`,
        horas(s.horas * 60),
        `${s.limiteHoras}h`,
        String(s.folgas),
        String(s.repousosExigidos),
        problemas.length ? problemas.join(", ") : "dentro da regra",
      ]);
    }
  }
  return [cab, ...linhas];
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
  sheet["!cols"] = [{ wch: 28 }, ...grade[0].slice(1, -2).map(() => ({ wch: 13 })), { wch: 12 }, { wch: 16 }];
  sheet["!freeze"] = { xSplit: 1, ySplit: 1 };
  const resumo = XLSX.utils.aoa_to_sheet([
    [`Escala de ${nomeMes(e.mes)}${e.empresa ? ` · ${e.empresa}` : ""}`],
    [e.regra],
    ...(e.erros ? [["Rascunho: a escala ainda tem pontos fora da regra."]] : []),
    [],
    ["Funcionário", "Como trabalha"],
    ...e.pessoas.map((p) => [p.nome, p.descricao]),
    [],
    ["Média por semana: conta só as semanas inteiras (domingo a sábado) do mês. Na 12x36, é a maior média de duas semanas seguidas, como na tela."],
  ]);
  resumo["!cols"] = [{ wch: 28 }, { wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Escala do mês");
  const semanasLei = linhasDasSemanas(e);
  if (semanasLei.length > 1) {
    const aba = XLSX.utils.aoa_to_sheet(semanasLei);
    aba["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, aba, "Semanas (lei)");
  }
  XLSX.utils.book_append_sheet(wb, resumo, "Resumo");
  XLSX.writeFile(wb, nomeArquivo(e, "xlsx"));
}

type DocComTabela = jsPDF & { lastAutoTable?: { finalY: number } };

/**
 * Pessoas agrupadas por unidade, na ordem em que aparecem; quem não tem unidade fica em
 * "Sem unidade", no fim. Com uma unidade só (ou nenhuma), volta um grupo sem título.
 */
export function gruposPorUnidade(pessoas: PessoaExportada[]): Array<{ titulo?: string; pessoas: PessoaExportada[] }> {
  const ordem: string[] = [];
  const porUnidade = new Map<string, PessoaExportada[]>();
  for (const p of pessoas) {
    const u = p.unidade?.trim() || "";
    if (!porUnidade.has(u)) {
      porUnidade.set(u, []);
      ordem.push(u);
    }
    porUnidade.get(u)!.push(p);
  }
  if (porUnidade.size <= 1) return [{ pessoas }];
  const chaves = [...ordem.filter((u) => u), ...(porUnidade.has("") ? [""] : [])];
  return chaves.map((u) => ({ titulo: u ? `Unidade ${u}` : "Sem unidade", pessoas: porUnidade.get(u)! }));
}

/** Monta o PDF (paisagem, uma tabela por semana, para afixar no mural). */
export function pdfDaEscala(e: EscalaExportada): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as DocComTabela;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  const datas = e.pessoas[0]?.dias.map((d) => d.data) ?? [];
  // Nome e horas largos o bastante para caber em uma linha ("44h (média 38h30)"): com linhas de
  // altura única, uma semana de até ~20 pessoas cabe inteira na página, sem sobrar uma linha órfã.
  const comLei = e.pessoas.some((p) => p.semanas?.length);
  const larguraNome = comLei ? 54 : 62;
  const larguraHoras = comLei ? 48 : 34;
  const larguraDia = (pageW - 2 * margin - larguraNome - larguraHoras) / 7;
  let y = margin;

  // Com mais de uma unidade, cada unidade começa em página nova, com o próprio cabeçalho.
  gruposPorUnidade(e.pessoas).forEach((grupo, gi) => {
    if (gi > 0) doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(`Escala de trabalho · ${nomeMes(e.mes)}${grupo.titulo ? ` · ${grupo.titulo}` : ""}`, margin, margin + 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    y = margin + 7;
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
    y = tabelasDasSemanas(doc, e, grupo.pessoas, datas, y, { margin, comLei, larguraNome, larguraHoras, larguraDia });
  });

  // Notas das horas: semana cortada pelo mês e média da 12x36.
  const notas: string[] = [];
  if (comLei)
    notas.push("Horas na semana (lei): semana inteira de domingo a sábado, como a lei conta; na semana cortada pelo mês, entram os dias do mês vizinho.");
  else if (semanasDoMes(datas).some((w) => w.some((d) => !d))) notas.push("(parcial) = semana cortada pelo início ou fim do mês: soma só os dias deste mês.");
  if (e.pessoas.some((p) => p.doze36)) notas.push("12x36: a lei mede pela média de duas semanas seguidas (a mesma “Maior semana” da tela), que aparece ao lado.");
  if (notas.length) {
    if (y > pageH - 30) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(8);
    for (const n of notas) {
      y += 4.5;
      doc.text(n, margin, y);
    }
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

interface MedidasPdf {
  margin: number;
  comLei: boolean;
  larguraNome: number;
  larguraHoras: number;
  larguraDia: number;
}

/** Uma tabela por semana (domingo a sábado) com as pessoas dadas; devolve onde parou. */
function tabelasDasSemanas(doc: DocComTabela, e: EscalaExportada, pessoas: PessoaExportada[], datas: string[], yInicial: number, m: MedidasPdf): number {
  const { margin, comLei, larguraNome, larguraHoras, larguraDia } = m;
  let y = yInicial;
  const fonte = pessoas.length > 16 ? 7.5 : 8;
  for (const semana of semanasDoMes(datas)) {
    const dentro = semana.filter((d): d is string => Boolean(d));
    autoTable(doc, {
      startY: y + 2,
      margin: { left: margin, right: margin },
      theme: "grid",
      rowPageBreak: "avoid",
      // Cada semana inteira na mesma página.
      pageBreak: "avoid",
      styles: { font: "helvetica", fontSize: fonte, cellPadding: 1.2, halign: "center", valign: "middle" },
      headStyles: { fillColor: [30, 64, 120], textColor: 255, fontStyle: "bold" },
      // Colunas dos dias com a mesma largura em todas as semanas, para o mural ficar alinhado.
      columnStyles: {
        0: { halign: "left", cellWidth: larguraNome, fontStyle: "bold" },
        ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [i, { cellWidth: larguraDia }])),
        8: { cellWidth: larguraHoras },
      },
      head: [
        [
          `Semana de ${ddmm(dentro[0])} a ${ddmm(dentro.at(-1)!)}`,
          ...semana.map((d, i) => (d ? `${DIAS_CURTOS[i]} ${ddmm(d)}${e.feriados.has(d) ? " *" : ""}` : DIAS_CURTOS[i])),
          comLei ? "Horas na semana (lei)" : "Horas",
        ],
      ],
      body: [
        ...pessoas.map((p) => [
          p.cargo ? `${p.nome}\n${p.cargo}` : p.nome,
          ...semana.map((d) => (d ? textoDoDia(p.dias.find((x) => x.data === d)) : "")),
          textoHorasSemana(p, semana, datas),
        ]),
        // Quantos de cada cargo trabalham no dia ("1/2" = 1 de 2 necessários).
        ...coberturaPorCargo(
          pessoas.map((p) => ({ config: { cargo: p.cargo }, dias: p.dias })),
          dentro,
          e.minimoPorCargo,
        ).map((cc) => [
          `${cc.cargo} trabalhando`,
          ...semana.map((d) => {
            if (!d) return "";
            const n = cc.porDia.get(d) ?? 0;
            const min = cc.minimo[diaDaSemana(d)];
            return min ? `${n}/${min}${n < min ? " FALTA" : ""}` : String(n);
          }),
          "",
        ]),
      ],
      didParseCell: (c) => {
        if (c.section === "body" && c.cell.raw === "Folga") {
          c.cell.styles.fillColor = [232, 236, 242];
          c.cell.styles.textColor = 90;
        }
        if (c.section === "body" && c.column.index === 0 && typeof c.cell.raw === "string" && c.cell.raw.endsWith(" trabalhando")) {
          c.cell.styles.fontStyle = "italic";
          c.cell.styles.textColor = 90;
        }
        if (c.section === "body" && typeof c.cell.raw === "string" && /(\((ACIMA|FALTA FOLGA)| FALTA$)/.test(c.cell.raw)) {
          c.cell.styles.textColor = [200, 30, 30];
          c.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = doc.lastAutoTable?.finalY ?? y;
  }
  return y;
}

function textoHorasSemana(p: PessoaExportada, semana: Array<string | null>, datas: string[]): string {
  const h = horas(minutosNos(p.dias, semana));
  const lei = !p.doze36 ? semanaDaLei(p, semana) : undefined;
  if (lei) return textoDaSemanaDaLei(lei);
  if (semana.some((d) => !d)) return `${h} (parcial)`;
  if (p.doze36) {
    const m = mediaDe2Semanas(p.dias, datas);
    return m === null ? h : `${h} (média ${horas(m)})`;
  }
  return h;
}

export function baixarEscalaPdf(e: EscalaExportada): void {
  pdfDaEscala(e).save(nomeArquivo(e, "pdf"));
}
