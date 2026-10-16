/**
 * Modelos de escala: geram, dia a dia, quando a pessoa trabalha e em que horário.
 *
 * Dois formatos cobrem os casos da carteira:
 *  - **semanal**: os mesmos dias de folga toda semana (6x1, 5x2, 5x2 com sábado curto).
 *  - **ciclo**: um padrão de N dias que se repete a partir de uma data base, sem olhar
 *    o dia da semana (12x36, revezamentos como 6x2 ou 5x1 do restaurante).
 *
 * O planejador parte de um modelo e depois o cliente arrasta e edita dias soltos; por
 * isso a saída é uma lista simples de dias, que a validação lê sem saber de onde veio.
 */
import { diaDaSemana, diasEntre, hhmmParaMin, minParaHhmm, somarDias } from "./datas";

export interface Turno {
  /** 'HH:MM'. Se a saída for menor ou igual à entrada, o turno vira a meia-noite. */
  entrada: string;
  saida: string;
  /** Intervalo para refeição e descanso, em minutos (não conta como trabalhado). */
  intervaloMin: number;
}

export interface DiaEscala {
  data: string;
  /** null = folga. */
  turno: Turno | null;
}

export type ModeloEscala =
  | {
      tipo: "semanal";
      nome: string;
      /** 0 = domingo … 6 = sábado. */
      diasFolga: number[];
      turno: Turno;
      /** Horário diferente em algum dia da semana (ex.: sábado até 12h). */
      turnoPorDia?: Partial<Record<number, Turno>>;
    }
  | {
      /**
       * Folgas que mudam de semana para semana e se repetem (rodízio de folgas): cada
       * item de `semanas` são os dias de folga daquela semana. É o que deixa o domingo
       * de folga cair para cada pessoa a cada N semanas sem parar a loja no domingo.
       */
      tipo: "rotativo";
      nome: string;
      turno: Turno;
      semanas: number[][];
      /** Domingo em que a pessoa está na 1ª semana do rodízio. */
      base: string;
    }
  | {
      tipo: "ciclo";
      nome: string;
      /** Um item por dia do ciclo; null = folga. */
      ciclo: (Turno | null)[];
      /** Data em que o ciclo está no seu 1º dia. */
      base: string;
    };

/** Minutos efetivamente trabalhados no turno (duração menos o intervalo). */
export function minutosTrabalhados(t: Turno): number {
  return duracaoBrutaMin(t) - t.intervaloMin;
}

/** Da entrada à saída, sem descontar intervalo. */
export function duracaoBrutaMin(t: Turno): number {
  const e = hhmmParaMin(t.entrada);
  let s = hhmmParaMin(t.saida);
  if (s <= e) s += 1440;
  return s - e;
}

export function escala6x1(turno: Turno, diaFolga = 0): ModeloEscala {
  return { tipo: "semanal", nome: "6x1", diasFolga: [diaFolga], turno };
}

export function escala5x2(turno: Turno, diasFolga: number[] = [6, 0]): ModeloEscala {
  return { tipo: "semanal", nome: "5x2", diasFolga, turno };
}

/** 12h de plantão, 36h de descanso: trabalha dia sim, dia não a partir de `base`. */
export function escala12x36(base: string, entrada = "07:00", intervaloMin = 60): ModeloEscala {
  const saida = somarHoras(entrada, 12);
  return { tipo: "ciclo", nome: "12x36", base, ciclo: [{ entrada, saida, intervaloMin }, null] };
}

/** Revezamento de N dias de trabalho por M de folga (ex.: 6x2, 5x1). */
export function escalaRevezamento(trabalho: number, folga: number, turno: Turno, base: string): ModeloEscala {
  const ciclo: (Turno | null)[] = [...Array(trabalho).fill(turno), ...Array(folga).fill(null)];
  return { tipo: "ciclo", nome: `${trabalho}x${folga}`, base, ciclo };
}

/** Expande o modelo em dias, de `de` até `ate` inclusive. */
export function gerarDias(modelo: ModeloEscala, de: string, ate: string): DiaEscala[] {
  const total = diasEntre(de, ate);
  const dias: DiaEscala[] = [];
  for (let i = 0; i <= total; i++) {
    const data = somarDias(de, i);
    dias.push({ data, turno: turnoDoDia(modelo, data) });
  }
  return dias;
}

function turnoDoDia(modelo: ModeloEscala, data: string): Turno | null {
  if (modelo.tipo === "semanal") {
    const dow = diaDaSemana(data);
    if (modelo.diasFolga.includes(dow)) return null;
    return modelo.turnoPorDia?.[dow] ?? modelo.turno;
  }
  if (modelo.tipo === "rotativo") {
    const n = modelo.semanas.length;
    const semana = Math.floor(diasEntre(modelo.base, data) / 7);
    const folgas = modelo.semanas[((semana % n) + n) % n];
    return folgas.includes(diaDaSemana(data)) ? null : modelo.turno;
  }
  const n = modelo.ciclo.length;
  const pos = ((diasEntre(modelo.base, data) % n) + n) % n;
  return modelo.ciclo[pos];
}

function somarHoras(hhmm: string, horas: number): string {
  return minParaHhmm((hhmmParaMin(hhmm) + horas * 60) % 1440);
}
