/**
 * Confere uma escala contra a EC 141/2026 e a CLT e diz, dia a dia e semana a semana,
 * o que está fora da regra.
 *
 * Duas gravidades:
 *  - **erro**: a escala, como está, descumpre a lei. O planejador não deve deixar salvar
 *    sem o cliente ver.
 *  - **atencao**: é permitido, mas custa (hora extra, feriado em dobro) ou depende de
 *    negociação coletiva (12x36 acima do limite novo).
 *
 * Semanas vão de domingo a sábado. A regra de cada semana é a que vigora no SÁBADO dela:
 * na semana em que a emenda entra em vigor já se cobra o limite novo, que é o lado
 * seguro para o cliente.
 */
import { diaDaSemana, diasEntre, hhmmParaMin, inicioDaSemana, somarDias } from "./datas";
import { DiaEscala, duracaoBrutaMin, minutosTrabalhados } from "./modelos";
import { CLT, PUBLICACAO_EC, PerfilJornada, SEGMENTOS, VIGENCIAS, vigenciaEm } from "./regras";

export type Gravidade = "erro" | "atencao";

export type CodigoRegra =
  | "JORNADA_DIARIA"
  | "HORA_EXTRA"
  | "INTERVALO"
  | "INTERJORNADA"
  | "LIMITE_SEMANAL"
  | "REPOUSO_SEMANAL"
  | "DIAS_SEGUIDOS"
  | "DOMINGO"
  | "FERIADO";

export interface Ocorrencia {
  /** Dia do problema; nas regras semanais, o domingo que abre a semana. */
  data: string;
  regra: CodigoRegra;
  gravidade: Gravidade;
  mensagem: string;
}

export interface ResumoSemana {
  inicio: string;
  /** false quando o período não cobre os 7 dias (início ou fim do intervalo). */
  completa: boolean;
  horas: number;
  folgas: number;
  limiteHoras: number;
  repousosExigidos: number;
  vigencia: string;
}

export interface ResultadoValidacao {
  ocorrencias: Ocorrencia[];
  semanas: ResumoSemana[];
}

const H = 60;

/** Etapa 1: com acordo coletivo, a jornada diária pode subir para distribuir as 42h. */
const ETAPA1 = VIGENCIAS[1];

export function validarEscala(
  diasEntrada: DiaEscala[],
  perfil: PerfilJornada,
  feriados: Set<string> = new Set(),
): ResultadoValidacao {
  const dias = [...diasEntrada].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const ocorrencias: Ocorrencia[] = [];
  const add = (data: string, regra: CodigoRegra, gravidade: Gravidade, mensagem: string) =>
    ocorrencias.push({ data, regra, gravidade, mensagem });

  const seg = SEGMENTOS[perfil.segmento];
  const r12 = Boolean(perfil.regime12x36);
  // Art. 8º da EC vale desde a publicação (art. 10, II), não só a partir da etapa 1.
  const isentoDeHoras = (data: string) => Boolean(perfil.hipersuficiente) && data >= PUBLICACAO_EC;

  // --- Regras do dia -----------------------------------------------------------------
  for (const { data, turno } of dias) {
    if (!turno) continue;
    const trab = minutosTrabalhados(turno);
    const bruta = duracaoBrutaMin(turno);

    if (!isentoDeHoras(data)) {
      // Art. 7º da EC: até a etapa 2, convenção pode ampliar o dia para distribuir as 42h
      // em 5 dias (8h24) sem que isso conte como hora extra.
      const v = vigenciaEm(data);
      const ampliado = perfil.temAcordoColetivo && v === ETAPA1 ? (v.limiteSemanalHoras * H) / 5 : 0;
      const base = r12 ? CLT.plantao12x36Horas * H : Math.max(CLT.limiteDiarioHoras * H, ampliado);
      const teto = r12 ? base : base + CLT.maxHorasExtrasDia * H;
      if (trab > teto) {
        add(data, "JORNADA_DIARIA", "erro", `${fmtH(trab)} trabalhadas; o máximo no dia é ${fmtH(teto)}.`);
      } else if (trab > base) {
        add(data, "HORA_EXTRA", "atencao", `${fmtH(trab - base)} acima das ${fmtH(base)} diárias (hora extra ou compensação).`);
      }
    }

    const minimo =
      bruta > 6 * H
        ? perfil.temAcordoColetivo
          ? CLT.intervaloAcimaDe6hComAcordoMin
          : CLT.intervaloAcimaDe6hMin
        : bruta > 4 * H
          ? CLT.intervaloAte6hMin
          : 0;
    if (turno.intervaloMin < minimo) {
      if (r12) {
        // Art. 59-A: na 12x36 o intervalo pode ser "observado ou indenizado".
        add(data, "INTERVALO", "atencao", `Intervalo de ${turno.intervaloMin}min no plantão: na 12x36 pode, mas o intervalo não usufruído (${minimo}min) é pago como indenização.`);
      } else {
        add(data, "INTERVALO", "erro", `Intervalo de ${turno.intervaloMin}min; o mínimo para essa jornada é ${minimo}min.`);
      }
    }

    if (feriados.has(data) && !r12) {
      if (seg.feriadoExigeConvencao && !perfil.temAcordoColetivo) {
        add(data, "FERIADO", "erro", "Trabalho em feriado no comércio só com autorização em convenção coletiva.");
      } else {
        add(data, "FERIADO", "atencao", "Trabalho em feriado: pagar em dobro ou dar folga compensatória.");
      }
    }
  }

  // --- Interjornada (11h entre o fim de um turno e o início do próximo) ---------------
  const origem = dias[0]?.data;
  let fimAnterior: { min: number; data: string } | null = null;
  for (const { data, turno } of dias) {
    if (!turno) continue;
    const inicio = diasEntre(origem, data) * 1440 + hhmmParaMin(turno.entrada);
    if (fimAnterior) {
      const pausa = inicio - fimAnterior.min;
      if (pausa < CLT.interjornadaHoras * H) {
        add(data, "INTERJORNADA", "erro", `Só ${fmtH(pausa)} de descanso desde o turno anterior; o mínimo é 11h.`);
      }
    }
    fimAnterior = { min: inicio + duracaoBrutaMin(turno), data };
  }

  // --- Dias seguidos sem folga ---------------------------------------------------------
  let seguidos = 0;
  for (const { data, turno } of dias) {
    seguidos = turno ? seguidos + 1 : 0;
    if (seguidos === CLT.maxDiasSeguidos + 1) {
      add(data, "DIAS_SEGUIDOS", "erro", `${seguidos}º dia seguido de trabalho; o repouso não pode passar do 7º dia.`);
    }
  }

  // --- Domingo de folga a cada N semanas -----------------------------------------------
  let domingosTrabalhados = 0;
  for (const { data, turno } of dias) {
    if (diaDaSemana(data) !== 0) continue;
    domingosTrabalhados = turno ? domingosTrabalhados + 1 : 0;
    if (!r12 && domingosTrabalhados === seg.domingoACadaSemanas) {
      add(
        data,
        "DOMINGO",
        "erro",
        `${domingosTrabalhados} domingos seguidos trabalhados; em ${seg.nome.toLowerCase()} a folga deve cair no domingo ao menos 1 vez a cada ${seg.domingoACadaSemanas} semanas.`,
      );
    }
  }

  // --- Semanas: limite de horas e repousos ---------------------------------------------
  const porSemana = new Map<string, DiaEscala[]>();
  for (const d of dias) {
    const k = inicioDaSemana(d.data);
    if (!porSemana.has(k)) porSemana.set(k, []);
    porSemana.get(k)!.push(d);
  }

  const semanas: ResumoSemana[] = [];
  for (const [inicio, ds] of porSemana) {
    const v = vigenciaEm(somarDias(inicio, 6));
    const min = ds.reduce((acc, d) => acc + (d.turno ? minutosTrabalhados(d.turno) : 0), 0);
    semanas.push({
      inicio,
      completa: ds.length === 7,
      horas: min / H,
      folgas: ds.filter((d) => !d.turno).length,
      limiteHoras: v.limiteSemanalHoras,
      repousosExigidos: v.repousosSemanais,
      vigencia: v.nome,
    });
  }

  // Com acordo coletivo a semana pode compensar a outra: estourar numa semana é aviso,
  // e o erro só vem se a média do mês (semanas completas, pelo mês do sábado) estourar.
  const flexivel = perfil.temAcordoColetivo || r12;
  for (const s of semanas.filter((x) => x.completa)) {
    // Na 12x36 a semana alterna 3 e 4 plantões (33h/44h com 1h de intervalo): semana a
    // semana sempre "estoura". A régua dela é a média (abaixo, mediasDa12x36).
    if (!r12 && !isentoDeHoras(somarDias(s.inicio, 6)) && s.horas > s.limiteHoras) {
      const msg = `${fmtH(s.horas * H)} na semana; o limite é ${s.limiteHoras}h (${s.vigencia}).`;
      add(s.inicio, "LIMITE_SEMANAL", flexivel ? "atencao" : "erro", msg);
    }
    if (!r12 && s.folgas < s.repousosExigidos) {
      add(
        s.inicio,
        "REPOUSO_SEMANAL",
        perfil.temAcordoColetivo ? "atencao" : "erro",
        `${s.folgas} folga(s) na semana; são exigidos ${s.repousosExigidos} (${s.vigencia}).`,
      );
    }
  }

  if (r12) {
    // 12x36 (art. 59-A): mede-se a média do ciclo. Duas semanas seguidas têm sempre 7
    // plantões num 12x36 regular, então a média de cada par é a média real do regime
    // (11h x 3,5 = 38h30 com 1h de intervalo; 12h x 3,5 = 42h com intervalo indenizado).
    for (const m of mediasDa12x36(semanas)) {
      if (isentoDeHoras(somarDias(m.inicio, 13)) || m.horas <= m.limiteHoras + 1e-9) continue;
      add(
        m.inicio,
        "LIMITE_SEMANAL",
        "atencao",
        `12x36 com média de ${fmtH(m.horas * H)} por semana, acima das ${m.limiteHoras}h de ${m.vigencia}: precisa de previsão na convenção coletiva (com 1h de intervalo usufruído a média de um plantão de 12h cai para 38h30).`,
      );
    }
  }

  if (perfil.temAcordoColetivo && !r12) {
    const porMes = new Map<string, ResumoSemana[]>();
    for (const s of semanas.filter((x) => x.completa)) {
      const mes = somarDias(s.inicio, 6).slice(0, 7);
      if (!porMes.has(mes)) porMes.set(mes, []);
      porMes.get(mes)!.push(s);
    }
    for (const [mes, ss] of porMes) {
      const n = ss.length;
      const limite = ss.reduce((a, s) => a + s.limiteHoras, 0) / n;
      const horas = ss.reduce((a, s) => a + s.horas, 0) / n;
      const ultimaSemana = somarDias(ss[n - 1].inicio, 6);
      if (!isentoDeHoras(ultimaSemana) && horas > limite + 1e-9) {
        add(ss[0].inicio, "LIMITE_SEMANAL", "erro", `Média de ${fmtH(horas * H)} por semana em ${mes}; o limite é ${limite}h mesmo com compensação.`);
      }
    }

    // Repousos com compensação (art. 7º, § 2º): média de 2 por semana DENTRO DO
    // MÊS-CALENDÁRIO. Só confere mês que a escala cobre inteiro. O "pelo menos 1 folga por
    // semana de trabalho" é a regra DIAS_SEGUIDOS, que vale sempre. Arredonda para baixo:
    // num mês de 30 dias um 5x2 comum tem 8 folgas (média 1,87) e não pode virar erro.
    const diasPorMes = new Map<string, DiaEscala[]>();
    for (const d of dias) {
      const m = d.data.slice(0, 7);
      if (!diasPorMes.has(m)) diasPorMes.set(m, []);
      diasPorMes.get(m)!.push(d);
    }
    for (const [mes, ds] of diasPorMes) {
      const total = diasNoMes(mes);
      if (ds.length !== total) continue;
      // Quem cumpre as folgas semana a semana não está usando a compensação: a borda do
      // mês pode cortar uma folga (fevereiro de 29 dias) sem haver semana com folga a menos.
      const compensa = semanas.some(
        (s) => s.completa && s.folgas < s.repousosExigidos && (s.inicio.startsWith(mes) || somarDias(s.inicio, 6).startsWith(mes)),
      );
      if (!compensa) continue;
      const repousos = vigenciaEm(ds[total - 1].data).repousosSemanais;
      const exigidas = Math.floor((repousos * total) / 7 + 1e-9);
      const folgas = ds.filter((d) => !d.turno).length;
      if (folgas < exigidas) {
        add(
          `${mes}-01`,
          "REPOUSO_SEMANAL",
          "erro",
          `${folgas} folga(s) no mês ${mes.slice(5)}/${mes.slice(0, 4)}; com compensação a média exige ${exigidas} (${repousos} por semana).`,
        );
      }
    }
  }

  ocorrencias.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  return { ocorrencias, semanas };
}

/**
 * Média semanal da 12x36 em cada par de semanas completas e seguidas (14 dias = 7
 * plantões no ciclo regular). Com uma semana completa só, vale ela sozinha. O limite é o
 * da 2ª semana do par (o lado seguro na virada da emenda).
 */
export function mediasDa12x36(semanas: ResumoSemana[]): Array<{ inicio: string; horas: number; limiteHoras: number; vigencia: string }> {
  const completas = semanas.filter((s) => s.completa).sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
  if (completas.length === 1) {
    const s = completas[0];
    return [{ inicio: s.inicio, horas: s.horas, limiteHoras: s.limiteHoras, vigencia: s.vigencia }];
  }
  const out: Array<{ inicio: string; horas: number; limiteHoras: number; vigencia: string }> = [];
  for (let i = 0; i + 1 < completas.length; i++) {
    const a = completas[i];
    const b = completas[i + 1];
    if (diasEntre(a.inicio, b.inicio) !== 7) continue;
    out.push({ inicio: a.inicio, horas: (a.horas + b.horas) / 2, limiteHoras: b.limiteHoras, vigencia: b.vigencia });
  }
  return out;
}

function diasNoMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

function fmtH(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}
