/**
 * Feriados que contam para a escala de trabalho.
 *
 * Diferente do calendário bancário (api/src/diasBancarios.js): lá Carnaval e Corpus
 * Christi entram porque o banco fecha; aqui não, porque são ponto facultativo — trabalhar
 * nesses dias não gera folga compensatória nem pagamento em dobro. Ficam os fixos da Lei
 * 662/1949 e 6.802/1980, Consciência Negra (Lei 14.759/2023) e a Sexta-feira Santa.
 * Feriados municipais e estaduais o planejador recebe à parte, digitados por empresa.
 */
import { paraISO } from "./datas";

const DIA_MS = 86400000;

/** Domingo de Páscoa (Gauss/Meeus), como em api/src/diasBancarios.js. */
function pascoa(ano: number): number {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mes - 1, dia);
}

export function feriadosTrabalhistas(ano: number): Map<string, string> {
  const fixos: Array<[number, number, string]> = [
    [1, 1, "Confraternização Universal"],
    [4, 21, "Tiradentes"],
    [5, 1, "Dia do Trabalho"],
    [9, 7, "Independência"],
    [10, 12, "Nossa Senhora Aparecida"],
    [11, 2, "Finados"],
    [11, 15, "Proclamação da República"],
    [12, 25, "Natal"],
  ];
  if (ano >= 2024) fixos.push([11, 20, "Consciência Negra"]);

  const out = new Map<string, string>();
  for (const [m, d, nome] of fixos) {
    out.set(`${ano}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, nome);
  }
  out.set(paraISO(pascoa(ano) - 2 * DIA_MS), "Sexta-feira Santa");
  return out;
}

/**
 * Pontos facultativos nacionais (Carnaval e Corpus Christi). Não são feriado por lei, mas
 * muita prefeitura e convenção os trata como tal — a empresa escolhe se entram.
 */
export function pontosFacultativos(ano: number): Map<string, string> {
  const p = pascoa(ano);
  return new Map([
    [paraISO(p - 48 * DIA_MS), "Carnaval (segunda)"],
    [paraISO(p - 47 * DIA_MS), "Carnaval (terça)"],
    [paraISO(p + 60 * DIA_MS), "Corpus Christi"],
  ]);
}

/** Feriado municipal/estadual digitado pela empresa. */
export interface FeriadoLocal {
  /** 'MM-DD' repete todo ano; 'YYYY-MM-DD' vale só naquele ano. */
  data: string;
  nome: string;
}

/** Todos os feriados que valem para a empresa nos anos pedidos. */
export function feriadosDaEmpresa(
  anos: number[],
  locais: FeriadoLocal[] = [],
  incluirFacultativos = false,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const ano of anos) {
    for (const [d, n] of feriadosTrabalhistas(ano)) out.set(d, n);
    if (incluirFacultativos) for (const [d, n] of pontosFacultativos(ano)) out.set(d, n);
    for (const f of locais) {
      if (/^\d{2}-\d{2}$/.test(f.data)) out.set(`${ano}-${f.data}`, f.nome || "Feriado local");
      else if (f.data.startsWith(`${ano}-`)) out.set(f.data, f.nome || "Feriado local");
    }
  }
  return out;
}
