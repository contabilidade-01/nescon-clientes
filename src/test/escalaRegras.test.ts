/**
 * Motor de regras do planejador de escalas (EC 141/2026 + CLT).
 *
 * Datas conferidas no calendário: 18/10/2026 é domingo; a semana de 13/12/2026 termina
 * no sábado 19/12, já dentro da etapa 1 (15/12/2026).
 */
import { describe, it, expect } from "vitest";
import {
  escala12x36,
  escala5x2,
  escala6x1,
  escalaRevezamento,
  gerarDias,
  type DiaEscala,
  type Turno,
} from "@/lib/escala/modelos";
import { vigenciaEm, type PerfilJornada } from "@/lib/escala/regras";
import { validarEscala } from "@/lib/escala/validar";

const T8: Turno = { entrada: "08:00", saida: "17:00", intervaloMin: 60 }; // 8h
const T7h20: Turno = { entrada: "08:00", saida: "16:20", intervaloMin: 60 }; // 7h20 -> 44h em 6x1
const COMERCIO: PerfilJornada = { segmento: "comercio", temAcordoColetivo: false };
const OUTRO: PerfilJornada = { segmento: "outro", temAcordoColetivo: false };

const erros = (dias: DiaEscala[], perfil: PerfilJornada, feriados?: Set<string>) =>
  validarEscala(dias, perfil, feriados).ocorrencias.filter((o) => o.gravidade === "erro");
const regras = (os: { regra: string }[]) => [...new Set(os.map((o) => o.regra))].sort();

describe("vigências da EC 141/2026", () => {
  it("troca 44h → 42h → 40h nas datas de transição", () => {
    expect(vigenciaEm("2026-12-14").limiteSemanalHoras).toBe(44);
    expect(vigenciaEm("2026-12-15").limiteSemanalHoras).toBe(42);
    expect(vigenciaEm("2026-12-15").repousosSemanais).toBe(2);
    expect(vigenciaEm("2027-12-14").limiteSemanalHoras).toBe(42);
    expect(vigenciaEm("2027-12-15").limiteSemanalHoras).toBe(40);
  });
});

describe("6x1 de 44h", () => {
  const modelo = escala6x1(T7h20);

  it("está regular hoje (antes da emenda valer)", () => {
    expect(erros(gerarDias(modelo, "2026-10-18", "2026-11-14"), OUTRO)).toEqual([]);
  });

  it("vira irregular na etapa 1: passa de 42h e só tem 1 folga", () => {
    const e = erros(gerarDias(modelo, "2027-01-03", "2027-01-30"), OUTRO);
    expect(regras(e)).toEqual(["LIMITE_SEMANAL", "REPOUSO_SEMANAL"]);
  });

  it("a semana da virada já é cobrada pela regra nova", () => {
    const { semanas } = validarEscala(gerarDias(modelo, "2026-12-13", "2026-12-19"), OUTRO);
    expect(semanas[0].limiteHoras).toBe(42);
  });
});

describe("5x2 de 40h", () => {
  it("cumpre a etapa 2 sem nenhum aviso", () => {
    const { ocorrencias } = validarEscala(gerarDias(escala5x2(T8), "2028-01-02", "2028-02-26"), COMERCIO);
    expect(ocorrencias).toEqual([]);
  });
});

describe("domingos", () => {
  // Folga fixa na segunda: todo domingo é trabalhado.
  const dias = gerarDias(escala6x1(T7h20, 1), "2026-10-18", "2026-12-12");

  it("no comércio, o 3º domingo seguido trabalhado é erro", () => {
    const d = erros(dias, COMERCIO).filter((o) => o.regra === "DOMINGO");
    expect(d.map((o) => o.data)).toEqual(["2026-11-01"]);
  });

  it("nos demais segmentos, só no 7º domingo", () => {
    const d = erros(dias, OUTRO).filter((o) => o.regra === "DOMINGO");
    expect(d.map((o) => o.data)).toEqual(["2026-11-29"]);
  });
});

describe("12x36", () => {
  const perfil: PerfilJornada = { segmento: "outro", temAcordoColetivo: true, regime12x36: true };

  it("não tem erro, mas avisa as semanas acima de 40h na etapa 2", () => {
    const r = validarEscala(gerarDias(escala12x36("2028-01-02"), "2028-01-02", "2028-01-29"), perfil);
    expect(r.ocorrencias.filter((o) => o.gravidade === "erro")).toEqual([]);
    const avisos = r.ocorrencias.filter((o) => o.regra === "LIMITE_SEMANAL");
    expect(avisos.length).toBeGreaterThan(0);
    expect(avisos.every((o) => o.gravidade === "atencao")).toBe(true);
  });
});

describe("regras do dia", () => {
  it("interjornada menor que 11h", () => {
    const dias: DiaEscala[] = [
      { data: "2026-11-03", turno: { entrada: "14:00", saida: "23:00", intervaloMin: 60 } },
      { data: "2026-11-04", turno: { entrada: "08:00", saida: "17:00", intervaloMin: 60 } },
    ];
    const e = erros(dias, OUTRO);
    expect(e.map((o) => [o.data, o.regra])).toEqual([["2026-11-04", "INTERJORNADA"]]);
  });

  it("turno noturno que vira a meia-noite conta as horas certas", () => {
    const dias: DiaEscala[] = [{ data: "2026-11-03", turno: { entrada: "22:00", saida: "06:00", intervaloMin: 60 } }];
    expect(validarEscala(dias, OUTRO).ocorrencias).toEqual([]);
  });

  it("intervalo de 30min só vale com acordo coletivo", () => {
    const dias: DiaEscala[] = [{ data: "2026-11-03", turno: { entrada: "08:00", saida: "16:30", intervaloMin: 30 } }];
    expect(regras(erros(dias, OUTRO))).toEqual(["INTERVALO"]);
    expect(erros(dias, { ...OUTRO, temAcordoColetivo: true })).toEqual([]);
  });

  it("mais de 10h no dia é erro; entre 8h e 10h é hora extra", () => {
    const dias: DiaEscala[] = [
      { data: "2026-11-03", turno: { entrada: "07:00", saida: "18:00", intervaloMin: 60 } }, // 10h
      { data: "2026-11-04", turno: { entrada: "07:00", saida: "19:00", intervaloMin: 60 } }, // 11h
    ];
    const r = validarEscala(dias, OUTRO).ocorrencias;
    expect(r.map((o) => [o.data, o.regra, o.gravidade])).toEqual([
      ["2026-11-03", "HORA_EXTRA", "atencao"],
      ["2026-11-04", "JORNADA_DIARIA", "erro"],
    ]);
  });

  it("feriado no comércio exige convenção; nos demais é aviso", () => {
    const dias: DiaEscala[] = [{ data: "2026-11-02", turno: T8 }];
    const feriados = new Set(["2026-11-02"]);
    expect(regras(erros(dias, COMERCIO, feriados))).toEqual(["FERIADO"]);
    const comAcordo = validarEscala(dias, { ...COMERCIO, temAcordoColetivo: true }, feriados).ocorrencias;
    expect(comAcordo.map((o) => o.gravidade)).toEqual(["atencao"]);
  });

  it("7 dias seguidos de trabalho é erro", () => {
    const dias = gerarDias(escalaRevezamento(7, 1, T7h20, "2026-11-01"), "2026-11-01", "2026-11-08");
    expect(erros(dias, OUTRO).map((o) => [o.data, o.regra])).toContainEqual(["2026-11-07", "DIAS_SEGUIDOS"]);
  });
});

describe("acordo coletivo: compensação dentro do mês", () => {
  // Fevereiro/2027 (etapa 1): 4 semanas completas, de 31/01 a 27/02.
  // Semanas alternam 3 e 1 folga: média 2 por semana. Turnos de 7h -> 28h ou 42h.
  const T7: Turno = { entrada: "08:00", saida: "16:00", intervaloMin: 60 };
  const semana = (inicio: string, folgas: number[]) =>
    gerarDias({ tipo: "semanal", nome: "x", diasFolga: folgas, turno: T7 }, inicio, addDias(inicio, 6));
  const dias = [
    ...semana("2027-01-31", [0, 3, 6]),
    ...semana("2027-02-07", [0]),
    ...semana("2027-02-14", [0, 3, 6]),
    ...semana("2027-02-21", [0]),
  ];

  it("sem acordo, a semana com 1 folga é erro", () => {
    expect(regras(erros(dias, OUTRO))).toEqual(["REPOUSO_SEMANAL"]);
  });

  it("com acordo, vira aviso porque a média do mês fecha 2 folgas", () => {
    const r = validarEscala(dias, { ...OUTRO, temAcordoColetivo: true });
    expect(r.ocorrencias.filter((o) => o.gravidade === "erro")).toEqual([]);
    expect(r.ocorrencias.some((o) => o.regra === "REPOUSO_SEMANAL" && o.gravidade === "atencao")).toBe(true);
  });
});

describe("empregado hipersuficiente", () => {
  it("sai do limite de horas após a emenda, mas mantém o repouso", () => {
    const dias = gerarDias(escala6x1(T8), "2027-01-03", "2027-01-30");
    const e = erros(dias, { ...OUTRO, hipersuficiente: true });
    expect(regras(e)).toEqual(["REPOUSO_SEMANAL"]);
  });
});

function addDias(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
