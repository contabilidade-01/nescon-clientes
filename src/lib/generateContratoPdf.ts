/**
 * PDF A4 do contrato a partir dos blocos de `contratoModelo`.
 *
 * Mesmo visual da prévia (faixa azul-marinho, dourado, caixas bege). Helvetica integrada
 * do jsPDF: não dá para embutir Segoe UI sem carregar fonte, e Helvetica imprime igual em
 * qualquer leitor. Símbolos fora do WinAnsi (✓ ►) viram desenho (quadradinho / seta).
 */
import { jsPDF } from "jspdf";
import type { Bloco } from "@/lib/contratoModelo";

type RGB = [number, number, number];
const NAVY: RGB = [31, 42, 68];
const GOLD: RGB = [205, 159, 63];
const GOLD_D: RGB = [138, 106, 34];
const BEIGE: RGB = [245, 236, 217];
const LIGHT: RGB = [251, 247, 238];
const LGREY: RGB = [247, 247, 247];
const GREY: RGB = [90, 90, 90];
const BEIGE_B: RGB = [227, 211, 174];
const YELLOW: RGB = [255, 241, 118];
const BLACK: RGB = [20, 20, 20];
const WHITE: RGB = [255, 255, 255];

const PAGE_W = 210;
const PAGE_H = 297;
const ML = 18;
const MR = 18;
const MT = 20;
const MB = 22;
const W = PAGE_W - ML - MR;

const PT = 0.3528; // pt → mm

// Larguras reais da Helvetica / Helvetica-Bold (AFM da Adobe, via pdfkit), em 1/1000 em.
// O jsPDF mede as maiúsculas uns 3-4% a menos do que o leitor de PDF desenha, e as
// palavras colavam depois de CONTRATANTE/CONTRATADA. Medindo por aqui, bate ao ponto.
const AFM_CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ ¡¢£§¨©ª«¬®¯°±²³´¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿŒœŸ–—‘’“”•…€™";
const AFM_N = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,278,333,556,556,556,333,737,370,556,584,737,333,400,584,333,333,333,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500,1000,944,667,556,1000,222,222,333,333,350,1000,556,1000];
const AFM_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,278,333,556,556,556,333,737,370,556,584,737,333,400,584,333,333,333,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556,1000,944,667,556,1000,278,278,500,500,350,1000,556,1000];
const AFM_IDX = new Map<string, number>();
for (let i = 0; i < AFM_CHARS.length; i++) AFM_IDX.set(AFM_CHARS[i], i);

const LINE = 1.4; // entrelinha

type Tok = { text: string; bold: boolean; hl: boolean; spaceBefore: boolean; x: number; width: number };
type Linha = { toks: Tok[]; w: number };
type Align = "left" | "center" | "right" | "justify";

export type ContratoPdfMeta = {
  titulo: string;
  /** Faixa do topo e assunto do arquivo; o padrão é o de contrato. */
  faixa?: { titulo: string; subtitulo: string; assunto?: string };
  rodapeEsquerda: string[];
  rodapeDireita: string[];
};

function segmentos(texto: string): Array<{ text: string; bold: boolean; hl: boolean }> {
  const partes = texto.split(/(\*\*.+?\*\*|\[[^\]]+\])/g);
  const out: Array<{ text: string; bold: boolean; hl: boolean }> = [];
  for (const p of partes) {
    if (!p) continue;
    if (p.startsWith("**") && p.endsWith("**")) out.push({ text: p.slice(2, -2), bold: true, hl: false });
    else if (p.startsWith("[") && p.endsWith("]")) out.push({ text: p, bold: true, hl: true });
    else out.push({ text: p, bold: false, hl: false });
  }
  return out;
}

class Pdf {
  doc: jsPDF;
  y = MT;
  primeiraPagina = true;

  constructor() {
    this.doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  }

  // ---------- utilidades ----------
  font(size: number, bold = false, color: RGB = BLACK) {
    this.doc.setFont("helvetica", bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    this.doc.setTextColor(color[0], color[1], color[2]);
  }
  /** Largura em mm pela tabela AFM; caractere fora da tabela cai na medida do jsPDF. */
  medir(txt: string, size: number, bold: boolean): number {
    const tabela = bold ? AFM_B : AFM_N;
    let unidades = 0;
    let fora = "";
    for (const ch of txt) {
      const i = AFM_IDX.get(ch);
      if (i === undefined) fora += ch;
      else unidades += tabela[i];
    }
    let mm = (unidades / 1000) * size * PT;
    if (fora) {
      this.doc.setFont("helvetica", bold ? "bold" : "normal");
      this.doc.setFontSize(size);
      mm += this.doc.getTextWidth(fora);
    }
    return mm;
  }
  lh(size: number): number {
    return size * PT * LINE;
  }
  rect(x: number, y: number, w: number, h: number, fill?: RGB, stroke?: RGB, lw = 0.25) {
    if (fill) this.doc.setFillColor(fill[0], fill[1], fill[2]);
    if (stroke) {
      this.doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
      this.doc.setLineWidth(lw);
    }
    this.doc.rect(x, y, w, h, fill && stroke ? "FD" : fill ? "F" : "S");
  }
  need(h: number) {
    if (this.y + h > PAGE_H - MB) this.novaPagina();
  }
  novaPagina() {
    this.doc.addPage();
    this.primeiraPagina = false;
    this.y = MT;
    // filete azul no topo das páginas internas
    this.rect(0, 0, PAGE_W, 3.5, NAVY);
  }
  capacidade(): number {
    return PAGE_H - MB - MT;
  }

  // ---------- texto rico ----------
  layout(texto: string, size: number, width: number, boldAll = false): Linha[] {
    const linhas: Linha[] = [];
    let cur: Tok[] = [];
    let curW = 0;
    const spaceW = this.medir(" ", size, false);
    let pendingSpace = false;
    for (const seg of segmentos(texto)) {
      const partes = seg.text.split(/(\s+)/);
      for (const parte of partes) {
        if (!parte) continue;
        if (/^\s+$/.test(parte)) {
          pendingSpace = true;
          continue;
        }
        const bold = seg.bold || boldAll;
        const tw = this.medir(parte, size, bold);
        const sp = cur.length && pendingSpace ? spaceW : 0;
        if (cur.length && curW + sp + tw > width + 0.01) {
          linhas.push({ toks: cur, w: curW });
          cur = [];
          curW = 0;
        }
        const x = cur.length ? curW + sp : 0;
        cur.push({ text: parte, bold, hl: seg.hl, spaceBefore: cur.length > 0 && pendingSpace, x, width: tw });
        curW = x + tw;
        pendingSpace = false;
      }
    }
    if (cur.length) linhas.push({ toks: cur, w: curW });
    return linhas;
  }

  alturaRico(texto: string, size: number, width: number, boldAll = false): number {
    if (!texto.trim()) return 0;
    return this.layout(texto, size, width, boldAll).length * this.lh(size);
  }

  /** Desenha e devolve a altura usada. `y` é o topo da primeira linha. */
  rico(texto: string, x: number, y: number, width: number, size: number, opts: { align?: Align; color?: RGB; boldAll?: boolean } = {}): number {
    const linhas = this.layout(texto, size, width, opts.boldAll);
    const lh = this.lh(size);
    const asc = size * PT * 0.95; // baseline a partir do topo
    const color = opts.color || BLACK;
    linhas.forEach((linha, li) => {
      const ultima = li === linhas.length - 1;
      let off = 0;
      let extra = 0;
      const gaps = linha.toks.filter((t) => t.spaceBefore).length;
      if (opts.align === "center") off = (width - linha.w) / 2;
      else if (opts.align === "right") off = width - linha.w;
      else if (opts.align === "justify" && !ultima && gaps > 0 && linhas.length > 1) extra = (width - linha.w) / gaps;
      let shift = 0;
      const by = y + li * lh + asc;
      linha.toks.forEach((t, ti) => {
        if (t.spaceBefore) shift += extra;
        const tx = x + off + t.x + shift;
        if (t.hl) {
          const prev = ti > 0 ? linha.toks[ti - 1] : null;
          const x0 = prev && prev.hl ? x + off + prev.x + shift - (t.spaceBefore ? extra : 0) + prev.width : tx - 0.3;
          this.rect(x0, by - asc + 0.3, tx + t.width + 0.3 - x0, lh - 0.4, YELLOW);
        }
        this.font(size, t.bold, color);
        this.doc.text(t.text, tx, by);
      });
    });
    return linhas.length * lh;
  }

  texto(txt: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: RGB; align?: "left" | "center" | "right"; maxW?: number } = {}) {
    this.font(size, opts.bold, opts.color);
    this.doc.text(txt, x, y + size * PT * 0.95, { align: opts.align || "left", maxWidth: opts.maxW });
  }

  // ---------- capa / rodapé ----------
  faixaTitulo(logo?: string | null, titulo = "CONTRATO", subtitulo = "PRESTAÇÃO DE SERVIÇOS CONTÁBEIS") {
    this.doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    this.doc.roundedRect(-6, 6, 128, 27, 3, 3, "F");
    this.texto(titulo, ML, 11, 16, { bold: true, color: WHITE });
    this.doc.setDrawColor(255, 255, 255);
    this.doc.setLineWidth(0.3);
    this.doc.line(ML, 19.5, 112, 19.5);
    this.texto(subtitulo, ML, 21.5, 12, { color: WHITE });
    if (logo) {
      try {
        this.doc.addImage(logo, "PNG", PAGE_W - MR - 24, 6, 24, 24);
      } catch {
        /* logo opcional */
      }
    }
    this.y = 42;
  }

  rodapes(meta: ContratoPdfMeta) {
    const n = this.doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.doc.setPage(i);
      const yLinha = PAGE_H - 15;
      this.doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
      this.doc.setLineWidth(0.6);
      this.doc.line(ML, yLinha, PAGE_W - MR, yLinha);
      this.font(7.5, false, GREY);
      meta.rodapeEsquerda.forEach((l, k) => this.doc.text(l, ML, yLinha + 4 + k * 3.4));
      this.font(7.5, true, NAVY);
      meta.rodapeDireita.forEach((l, k) => this.doc.text(l, PAGE_W - MR - 10, yLinha + 4 + k * 3.4, { align: "right" }));
      this.font(8, false, GREY);
      this.doc.text(String(i), PAGE_W - MR, yLinha + 4, { align: "right" });
    }
  }

  // ---------- blocos ----------
  secao(titulo: string) {
    const h = this.alturaRico(titulo, 11.5, W, true);
    // reserva espaço para o que vem logo depois: título sozinho no fim da página fica órfão
    this.need(h + 34);
    this.y += 4;
    this.rico(titulo, ML, this.y, W, 11.5, { align: "center", color: NAVY, boldAll: true });
    this.y += h + 1.2;
    this.doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
    this.doc.setLineWidth(0.4);
    this.doc.line(ML, this.y, PAGE_W - MR, this.y);
    this.y += 5;
  }

  subtitulo(titulo: string, sub: string) {
    this.need(34);
    this.texto(titulo, ML, this.y, 10, { bold: true, color: NAVY });
    const w = this.medir(titulo, 10, true);
    this.font(8, false, GREY);
    this.doc.setFont("helvetica", "italic");
    this.doc.text(`  ·  ${sub}`, ML + w, this.y + 10 * PT * 0.95);
    this.y += 6;
  }

  paragrafo(texto: string, opts: { indent?: number; size?: number; align?: Align; after?: number } = {}) {
    const size = opts.size || 10;
    const x = ML + (opts.indent || 0);
    const w = W - (opts.indent || 0);
    const linhas = this.layout(texto, size, w);
    const lh = this.lh(size);
    // Parágrafo longo pode quebrar entre páginas: desenha linha a linha.
    let i = 0;
    while (i < linhas.length) {
      this.need(lh);
      const cabem = Math.max(1, Math.floor((PAGE_H - MB - this.y) / lh));
      const fatia = linhas.slice(i, i + cabem);
      const subTexto = fatia; // já medido; redesenha pelos tokens
      this.desenharLinhas(subTexto, x, this.y, w, size, opts.align || "justify", i + cabem >= linhas.length);
      this.y += fatia.length * lh;
      i += cabem;
    }
    this.y += opts.after ?? 3;
  }

  private desenharLinhas(linhas: Linha[], x: number, y: number, width: number, size: number, align: Align, incluiUltima: boolean) {
    const lh = this.lh(size);
    const asc = size * PT * 0.95;
    linhas.forEach((linha, li) => {
      const ultima = incluiUltima && li === linhas.length - 1;
      let off = 0;
      let extra = 0;
      const gaps = linha.toks.filter((t) => t.spaceBefore).length;
      if (align === "center") off = (width - linha.w) / 2;
      else if (align === "right") off = width - linha.w;
      else if (align === "justify" && !ultima && gaps > 0) extra = (width - linha.w) / gaps;
      let shift = 0;
      const by = y + li * lh + asc;
      linha.toks.forEach((t, ti) => {
        if (t.spaceBefore) shift += extra;
        const tx = x + off + t.x + shift;
        if (t.hl) {
          const prev = ti > 0 ? linha.toks[ti - 1] : null;
          const x0 = prev && prev.hl ? x + off + prev.x + shift - (t.spaceBefore ? extra : 0) + prev.width : tx - 0.3;
          this.rect(x0, by - asc + 0.3, tx + t.width + 0.3 - x0, lh - 0.4, YELLOW);
        }
        this.font(size, t.bold, BLACK);
        this.doc.text(t.text, tx, by);
      });
    });
  }

  clausula(num: string, texto: string) {
    this.paragrafo(`**${num}** ${texto}`);
  }

  barra(rotulo: string, texto: string) {
    const indent = 8;
    const size = 10;
    const h = this.alturaRico(`**${rotulo}** ${texto}`, size, W - indent);
    // Caixa inteira na mesma página quando cabe; senão deixa quebrar como parágrafo.
    if (h <= this.capacidade() * 0.6) this.need(h);
    const y0 = this.y;
    const pagina0 = this.doc.getCurrentPageInfo().pageNumber;
    this.paragrafo(`**${rotulo}** ${texto}`, { indent, size, after: 0 });
    const pagina1 = this.doc.getCurrentPageInfo().pageNumber;
    if (pagina0 === pagina1) {
      this.rect(ML + 3, y0 - 0.5, 1.4, this.y - y0 + 1, GOLD);
    } else {
      // a barra fica só na parte da última página
      this.doc.setPage(pagina1);
      this.rect(ML + 3, MT - 0.5, 1.4, this.y - MT + 1, GOLD);
    }
    this.y += 3.5;
  }

  alerta(texto: string, rotulo?: string) {
    const pad = 4;
    const colL = 12;
    const innerW = W - colL - pad * 2;
    const conteudo = rotulo ? `**${rotulo}** ${texto}` : texto;
    const h = this.alturaRico(conteudo, 9.5, innerW);
    const boxH = Math.max(h + pad * 2, 14);
    this.need(boxH + 2);
    this.rect(ML, this.y, colL, boxH, GOLD);
    this.texto("!", ML + colL / 2, this.y + boxH / 2 - 4, 20, { bold: true, color: WHITE, align: "center" });
    this.rect(ML + colL, this.y, W - colL, boxH, LGREY);
    this.rico(conteudo, ML + colL + pad, this.y + pad, innerW, 9.5, { align: "justify" });
    this.y += boxH + 4;
  }

  destaque(titulo: string, valor: string, linhas: string[]) {
    const colL = 16;
    const pad = 4;
    const innerW = W - colL - pad * 2;
    const hT = this.lh(8);
    const hV = this.alturaRico(valor, 11, innerW, true);
    const hL = linhas.reduce((s, l) => s + this.alturaRico(l, 9, innerW), 0);
    const boxH = hT + hV + hL + pad * 2 + 1;
    this.need(boxH + 2);
    this.rect(ML, this.y, colL, boxH, NAVY);
    this.rect(ML + colL, this.y, W - colL, boxH, BEIGE);
    // marca decorativa na coluna escura
    this.doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
    this.doc.setLineWidth(0.6);
    this.doc.line(ML + 5, this.y + boxH / 2, ML + colL - 5, this.y + boxH / 2);
    let yy = this.y + pad;
    this.texto(titulo, ML + colL + pad, yy, 8, { bold: true, color: NAVY });
    yy += hT + 0.5;
    this.rico(valor, ML + colL + pad, yy, innerW, 11, { boldAll: true });
    yy += hV + 0.5;
    for (const l of linhas) yy += this.rico(l, ML + colL + pad, yy, innerW, 9);
    this.y += boxH + 4;
  }

  parte(rotulo: string, texto: string) {
    const colL = 22;
    const pad = 4;
    const innerW = W - colL - pad * 2;
    const h = this.alturaRico(texto, 9.5, innerW);
    const boxH = Math.max(h + pad * 2, 18);
    this.need(boxH + 2);
    this.rect(ML, this.y, colL, boxH, NAVY);
    this.texto(rotulo, ML + colL / 2, this.y + boxH / 2 - 1.5, 7, { bold: true, color: WHITE, align: "center" });
    this.rect(ML + colL, this.y, W - colL, boxH, undefined, GOLD, 0.35);
    this.rico(texto, ML + colL + pad, this.y + pad, innerW, 9.5, { align: "justify" });
    this.y += boxH + 4;
  }

  resumo(itens: Array<{ titulo: string; texto: string }>) {
    this.need(8);
    this.texto("EM RESUMO", ML, this.y, 10, { bold: true, color: NAVY });
    const w = this.medir("EM RESUMO", 10, true);
    this.font(8, false, GREY);
    this.doc.setFont("helvetica", "italic");
    this.doc.text("  ·  o essencial deste contrato, antes das cláusulas", ML + w, this.y + 10 * PT * 0.95);
    this.y += 7;
    const colW = W / 2;
    const pad = 3;
    const innerW = colW - pad * 2;
    for (let r = 0; r < 2; r++) {
      const cells = [itens[r * 2], itens[r * 2 + 1]];
      const hs = cells.map((c) => this.lh(9) + this.alturaRico(c.texto, 8.5, innerW));
      const rowH = Math.max(...hs) + pad * 2;
      this.need(rowH);
      cells.forEach((c, k) => {
        const x = ML + k * colW;
        const fill = (r + k) % 2 === 0 ? BEIGE : LIGHT;
        this.rect(x, this.y, colW, rowH, fill);
        this.texto(c.titulo, x + pad, this.y + pad, 9, { bold: true, color: NAVY });
        this.rico(c.texto, x + pad, this.y + pad + this.lh(9), innerW, 8.5);
      });
      this.y += rowH;
    }
    this.y += 4;
  }

  cartoes(colunas: Array<{ titulo: string; itens: string[] }>) {
    const gap = 2;
    const colW = (W - gap * (colunas.length - 1)) / colunas.length;
    const pad = 3;
    const bullet = 3.5;
    const innerW = colW - pad * 2 - bullet;
    const alturas = colunas.map((c) => {
      const hT = this.alturaRico(c.titulo, 9, colW - pad * 2, true) + 2;
      const hI = c.itens.reduce((s, it) => s + this.alturaRico(it, 8.5, innerW) + 1.5, 0);
      return hT + hI + pad * 2;
    });
    const H = Math.max(...alturas);
    this.need(H + 2);
    colunas.forEach((c, k) => {
      const x = ML + k * (colW + gap);
      this.rect(x, this.y, colW, H, undefined, GOLD, 0.35);
      let yy = this.y + pad;
      yy += this.rico(c.titulo, x + pad, yy, colW - pad * 2, 9, { align: "center", color: NAVY, boldAll: true }) + 2;
      for (const it of c.itens) {
        this.rect(x + pad + 0.3, yy + 1.1, 1.6, 1.6, GOLD);
        yy += this.rico(it, x + pad + bullet, yy, innerW, 8.5) + 1.5;
      }
    });
    this.y += H + 4;
  }

  lista(itens: string[], rotulos?: string[], labelW = rotulos ? 27 : 9) {
    const gap = 1;
    const pad = 3;
    const textW = W - labelW - gap - pad * 2;
    itens.forEach((texto, i) => {
      const h = this.alturaRico(texto, 9, textW);
      const rowH = Math.max(h + pad * 2 - 1, 9);
      this.need(rowH + 1);
      this.rect(ML, this.y, labelW, rowH, NAVY);
      const lab = rotulos ? rotulos[i] : "abcdefghijklmnop"[i];
      this.texto(lab, ML + labelW / 2, this.y + rowH / 2 - (rotulos ? 1.4 : 1.8), rotulos ? 7 : 9, { bold: true, color: WHITE, align: "center" });
      this.rect(ML + labelW + gap, this.y, W - labelW - gap, rowH, undefined, BEIGE_B, 0.3);
      this.rico(texto, ML + labelW + gap + pad, this.y + pad - 0.5, textW, 9, { align: "justify" });
      this.y += rowH + 1;
    });
    this.y += 3;
  }

  kv(itens: Array<{ rotulo: string; linhas: string[] }>) {
    const labelW = 32;
    const gap = 1;
    const pad = 3;
    const textW = W - labelW - gap - pad * 2;
    for (const it of itens) {
      const hs = it.linhas.map((l) => this.alturaRico(l, 9, textW));
      const h = hs.reduce((s, x) => s + x, 0) + (it.linhas.length - 1) * 1;
      const rowH = Math.max(h + pad * 2 - 1, 10);
      this.need(rowH + 1);
      this.rect(ML, this.y, labelW, rowH, NAVY);
      this.font(7, true, WHITE);
      this.doc.text(it.rotulo, ML + labelW / 2, this.y + rowH / 2 + 1, { align: "center", maxWidth: labelW - 2 });
      this.rect(ML + labelW + gap, this.y, W - labelW - gap, rowH, undefined, BEIGE_B, 0.3);
      let yy = this.y + pad - 0.5;
      it.linhas.forEach((l, k) => {
        this.rico(l, ML + labelW + gap + pad, yy, textW, 9);
        yy += hs[k] + 1;
      });
      this.y += rowH + 1;
    }
    this.y += 3;
  }

  passos(itens: Array<{ titulo: string; texto: string }>) {
    const arrowW = 8;
    const colW = (W - arrowW * (itens.length - 1)) / itens.length;
    const pad = 3;
    const innerW = colW - pad * 2;
    const hs = itens.map((it) => this.lh(15) + this.alturaRico(it.titulo, 8.5, innerW, true) + this.alturaRico(it.texto, 8, innerW) + 1);
    const H = Math.max(...hs) + pad * 2;
    this.need(H + 2);
    itens.forEach((it, k) => {
      const x = ML + k * (colW + arrowW);
      this.rect(x, this.y, colW, H, k % 2 === 0 ? BEIGE : LIGHT);
      let yy = this.y + pad;
      this.texto(String(k + 1), x + colW / 2, yy, 15, { bold: true, color: GOLD, align: "center" });
      yy += this.lh(15);
      yy += this.rico(it.titulo, x + pad, yy, innerW, 8.5, { align: "center", color: NAVY, boldAll: true }) + 1;
      this.rico(it.texto, x + pad, yy, innerW, 8, { align: "center" });
      if (k < itens.length - 1) {
        const ax = x + colW + arrowW / 2;
        const ay = this.y + H / 2;
        this.doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
        this.doc.triangle(ax - 1.6, ay - 2, ax - 1.6, ay + 2, ax + 1.8, ay, "F");
      }
    });
    this.y += H + 4;
  }

  legenda(texto: string) {
    this.need(7);
    this.texto(texto, ML + W / 2, this.y, 8.5, { bold: true, color: NAVY, align: "center" });
    this.y += 6;
  }

  escudo(blocos: Array<{ titulo: string; texto: string }>) {
    const colL = 14;
    const pad = 4;
    const innerW = W - colL - pad * 2;
    const alturas = blocos.map((b) => this.lh(9) + this.alturaRico(b.texto, 9.5, innerW) + 3);
    const boxH = alturas.reduce((s, x) => s + x, 0) + pad * 2 - 3;
    if (boxH > this.capacidade() - 4) {
      // não cabe numa página: vira itens com barra dourada, que quebram bem
      for (const b of blocos) this.barra(b.titulo, b.texto);
      return;
    }
    this.need(boxH + 2);
    this.rect(ML, this.y, colL, boxH, BEIGE);
    this.doc.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
    this.doc.setLineWidth(0.6);
    // "escudo" estilizado
    const cx = ML + colL / 2;
    const cy = this.y + 9;
    this.doc.lines([[3, 0], [0, 4], [-3, 3], [-3, -3], [0, -4]], cx - 3, cy - 4, [1, 1], "S", true);
    this.rect(ML + colL, this.y, W - colL, boxH, undefined, GOLD, 0.35);
    let yy = this.y + pad;
    blocos.forEach((b, k) => {
      this.texto(b.titulo, ML + colL + pad, yy, 9, { bold: true, color: NAVY });
      yy += this.lh(9);
      yy += this.rico(b.texto, ML + colL + pad, yy, innerW, 9.5, { align: "justify" });
      if (k < blocos.length - 1) yy += 3;
    });
    this.y += boxH + 4;
  }

  data(texto: string) {
    this.need(8);
    this.rico(texto, ML, this.y, W, 10, { align: "right", boldAll: true });
    this.y += 9;
  }

  assinaturas(itens: Array<{ rotulo: string; nome: string; linhas: string[] }>) {
    const colW = W / 2;
    const pad = 6;
    const innerW = colW - pad * 2;
    const espaco = 14;
    for (let r = 0; r < Math.ceil(itens.length / 2); r++) {
      const cells = itens.slice(r * 2, r * 2 + 2);
      const hs = cells.map(
        (c) => this.lh(7.5) + espaco + 1 + this.alturaRico(c.nome, 9.5, innerW, true) + c.linhas.reduce((s, l) => s + this.alturaRico(l, 8.5, innerW), 0)
      );
      const rowH = Math.max(...hs) + 6;
      this.need(rowH);
      cells.forEach((c, k) => {
        const x = ML + k * colW + pad;
        let yy = this.y;
        this.texto(c.rotulo, x + innerW / 2, yy, 7.5, { bold: true, color: GOLD_D, align: "center" });
        yy += this.lh(7.5) + espaco;
        this.doc.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
        this.doc.setLineWidth(0.35);
        this.doc.line(x, yy, x + innerW, yy);
        yy += 1.5;
        yy += this.rico(c.nome, x, yy, innerW, 9.5, { align: "center", color: NAVY, boldAll: true });
        for (const l of c.linhas) yy += this.rico(l, x, yy, innerW, 8.5, { align: "center" });
      });
      this.y += rowH;
    }
  }
}

export function gerarContratoPdf(blocos: Bloco[], meta: ContratoPdfMeta, logoDataUrl?: string | null): jsPDF {
  const p = new Pdf();
  p.doc.setProperties({ title: meta.titulo, subject: meta.faixa?.assunto || "Contrato de prestação de serviços contábeis", creator: "Portal Nescon" });
  p.faixaTitulo(logoDataUrl, meta.faixa?.titulo, meta.faixa?.subtitulo);
  for (const b of blocos) {
    switch (b.t) {
      case "resumo":
        p.resumo(b.itens);
        break;
      case "secao":
        p.secao(b.titulo);
        break;
      case "subtitulo":
        p.subtitulo(b.titulo, b.sub);
        break;
      case "parte":
        p.parte(b.rotulo, b.texto);
        break;
      case "clausula":
        p.clausula(b.num, b.texto);
        break;
      case "par":
        p.paragrafo(b.texto);
        break;
      case "barra":
        p.barra(b.rotulo, b.texto);
        break;
      case "cartoes":
        p.cartoes(b.colunas);
        break;
      case "lista":
        p.lista(b.itens, b.rotulos);
        break;
      case "alerta":
        p.alerta(b.texto, b.rotulo);
        break;
      case "destaque":
        p.destaque(b.titulo, b.valor, b.linhas);
        break;
      case "passos":
        p.passos(b.itens);
        break;
      case "legenda":
        p.legenda(b.texto);
        break;
      case "escudo":
        p.escudo(b.blocos);
        break;
      case "data":
        p.data(b.texto);
        break;
      case "assinaturas":
        p.assinaturas(b.itens);
        break;
      case "quebra":
        p.novaPagina();
        break;
      case "kv":
        p.kv(b.itens);
        break;
    }
  }
  p.rodapes(meta);
  return p.doc;
}

export function pdfParaBase64(doc: jsPDF): string {
  const uri = doc.output("datauristring");
  const i = uri.indexOf(",");
  return i >= 0 ? uri.slice(i + 1) : uri;
}
