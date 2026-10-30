import * as XLSX from "xlsx";

/**
 * Leitor mínimo de células de um .xls (BIFF8) — plano B quando o SheetJS não acha a aba.
 *
 * Por que existe: a "Relação de Empregados" exportada pelo Domínio sai com a aba sem o
 * registro BOF de início. O Excel abre assim mesmo, mas o SheetJS (e o xlrd) devolvem a
 * pasta sem nenhuma aba — a importação dizia "CNPJ não identificado" num arquivo que
 * tem o CNPJ na segunda linha. Aqui lemos os registros de célula direto do fluxo
 * `Workbook`, sem depender da estrutura de abas.
 *
 * Cobre o que esses relatórios usam: texto compartilhado (SST/LABELSST), LABEL, NUMBER,
 * RK, MULRK e fórmula com resultado. Só a primeira aba.
 */

type Celulas = Map<number, Map<number, string>>;

function rkParaNumero(rk: number): number {
  const v = rk >>> 0;
  let n: number;
  if (v & 2) {
    n = (rk | 0) >> 2;
  } else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(0, v & 0xfffffffc, false);
    buf.setUint32(4, 0, false);
    n = buf.getFloat64(0, false);
  }
  return v & 1 ? n / 100 : n;
}

function numeroParaTexto(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(10)));
}

/** Lê as strings do SST, que podem atravessar registros CONTINUE. */
function lerSst(segmentos: Uint8Array[]): string[] {
  let seg = 0;
  let pos = 0;
  const atual = () => segmentos[seg];
  const avancarSeg = () => {
    seg += 1;
    pos = 0;
  };
  const u8 = () => {
    if (pos >= atual().length) avancarSeg();
    return atual()[pos++];
  };
  const u16 = () => u8() | (u8() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const pular = (n: number) => {
    let resto = n;
    while (resto > 0) {
      const disp = atual().length - pos;
      if (disp <= 0) {
        avancarSeg();
        continue;
      }
      const k = Math.min(disp, resto);
      pos += k;
      resto -= k;
    }
  };

  u32(); // total de referências
  const unicas = u32();
  const out: string[] = [];
  for (let i = 0; i < unicas && seg < segmentos.length; i += 1) {
    const cch = u16();
    let flags = u8();
    const rico = flags & 0x08;
    const ext = flags & 0x04;
    const runs = rico ? u16() : 0;
    const extTam = ext ? u32() : 0;
    let s = "";
    for (let c = 0; c < cch; c += 1) {
      if (pos >= atual().length) {
        // String quebrada entre registros: o CONTINUE começa com um novo byte de flags.
        avancarSeg();
        flags = atual()[pos++];
      }
      if (flags & 0x01) {
        s += String.fromCharCode(u16());
      } else {
        s += String.fromCharCode(u8());
      }
    }
    pular(runs * 4 + extTam);
    out.push(s);
  }
  return out;
}

function lerTextoUnicode(b: Uint8Array, inicio: number): string {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const cch = v.getUint16(inicio, true);
  const flags = b[inicio + 2];
  let p = inicio + 3;
  let s = "";
  for (let c = 0; c < cch && p < b.length; c += 1) {
    if (flags & 1) {
      s += String.fromCharCode(v.getUint16(p, true));
      p += 2;
    } else {
      s += String.fromCharCode(b[p]);
      p += 1;
    }
  }
  return s;
}

/** Células da primeira aba como matriz de texto, ou null se não for um .xls legível. */
export function lerCelulasXlsBiff(data: ArrayBuffer | Uint8Array): string[][] | null {
  let fluxo: Uint8Array;
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const cfb = XLSX.CFB.read(bytes, { type: "array" });
    const entrada = XLSX.CFB.find(cfb, "Workbook") || XLSX.CFB.find(cfb, "Book");
    if (!entrada?.content) return null;
    fluxo = entrada.content instanceof Uint8Array ? entrada.content : Uint8Array.from(entrada.content);
  } catch {
    return null;
  }

  const registros: Array<{ tipo: number; corpo: Uint8Array }> = [];
  for (let p = 0; p + 4 <= fluxo.length; ) {
    const tipo = fluxo[p] | (fluxo[p + 1] << 8);
    const tam = fluxo[p + 2] | (fluxo[p + 3] << 8);
    registros.push({ tipo, corpo: fluxo.subarray(p + 4, p + 4 + tam) });
    p += 4 + tam;
  }

  let sst: string[] = [];
  const iSst = registros.findIndex((r) => r.tipo === 0x00fc);
  if (iSst >= 0) {
    const segs = [registros[iSst].corpo];
    for (let k = iSst + 1; k < registros.length && registros[k].tipo === 0x003c; k += 1) {
      segs.push(registros[k].corpo);
    }
    try {
      sst = lerSst(segs);
    } catch {
      sst = [];
    }
  }

  const celulas: Celulas = new Map();
  let maxCol = 0;
  let temCelula = false;
  const por = (linha: number, col: number, valor: string) => {
    if (!celulas.has(linha)) celulas.set(linha, new Map());
    celulas.get(linha)!.set(col, valor);
    if (col > maxCol) maxCol = col;
    temCelula = true;
  };

  let formulaPendente: { linha: number; col: number } | null = null;
  for (const { tipo, corpo } of registros) {
    // EOF depois de já ter lido células = fim da primeira aba.
    if (tipo === 0x000a && temCelula) break;
    if (corpo.length < 6 && tipo !== 0x0207) continue;
    const v = new DataView(corpo.buffer, corpo.byteOffset, corpo.byteLength);
    switch (tipo) {
      case 0x00fd: // LABELSST
        if (corpo.length >= 10) por(v.getUint16(0, true), v.getUint16(2, true), sst[v.getUint32(6, true)] ?? "");
        break;
      case 0x0204: // LABEL
        por(v.getUint16(0, true), v.getUint16(2, true), lerTextoUnicode(corpo, 6));
        break;
      case 0x0203: // NUMBER
        if (corpo.length >= 14) {
          por(v.getUint16(0, true), v.getUint16(2, true), numeroParaTexto(v.getFloat64(6, true)));
        }
        break;
      case 0x027e: // RK
        if (corpo.length >= 10) {
          por(v.getUint16(0, true), v.getUint16(2, true), numeroParaTexto(rkParaNumero(v.getInt32(6, true))));
        }
        break;
      case 0x00bd: {
        // MULRK
        const linha = v.getUint16(0, true);
        const primeira = v.getUint16(2, true);
        const n = Math.floor((corpo.length - 6) / 6);
        for (let k = 0; k < n; k += 1) {
          por(linha, primeira + k, numeroParaTexto(rkParaNumero(v.getInt32(4 + k * 6 + 2, true))));
        }
        break;
      }
      case 0x0006: {
        // FORMULA: número direto; texto vem no registro STRING seguinte.
        if (corpo.length < 14) break;
        const linha = v.getUint16(0, true);
        const col = v.getUint16(2, true);
        if (v.getUint16(12, true) === 0xffff) {
          if (corpo[6] === 0) formulaPendente = { linha, col };
        } else {
          por(linha, col, numeroParaTexto(v.getFloat64(6, true)));
        }
        break;
      }
      case 0x0207: // STRING (resultado de fórmula)
        if (formulaPendente) {
          por(formulaPendente.linha, formulaPendente.col, lerTextoUnicode(corpo, 0));
          formulaPendente = null;
        }
        break;
      default:
        break;
    }
  }

  if (!temCelula) return null;
  const ultimaLinha = Math.max(...celulas.keys());
  const linhas: string[][] = [];
  for (let r = 0; r <= ultimaLinha; r += 1) {
    const mapa = celulas.get(r);
    const linha: string[] = [];
    for (let c = 0; c <= maxCol; c += 1) linha.push(mapa?.get(c) ?? "");
    linhas.push(linha);
  }
  return linhas;
}
