import { describe, expect, it } from "vitest";
import { divisorMensal, proximoProblema, resumoJornada, situacaoJornada } from "@/lib/jornadaFuncionario";
import { avisoJornadaAdmissao, presetsParaData } from "@/lib/admissionFicha";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { lerJornada } = require("../../api/src/employeeJornada.js");

describe("situacaoJornada", () => {
  it("44h é ok até 15/12/2026 e fica fora a partir de 16/12/2026", () => {
    expect(situacaoJornada({ carga_semanal: 44, escala: "5x2" }, "2026-12-15").nivel).toBe("ok");
    const s = situacaoJornada({ carga_semanal: 44, escala: "5x2" }, "2026-12-16");
    expect(s.nivel).toBe("fora");
    expect(s.rotulo).toBe("Acima de 42h");
  });

  it("6x1 deixa de valer na etapa 1, mesmo com carga baixa", () => {
    expect(situacaoJornada({ carga_semanal: 36, escala: "6x1" }, "2026-12-20").nivel).toBe("fora");
  });

  it("42h em 5x2 pede acordo na etapa 1 e fica fora na etapa 2", () => {
    expect(situacaoJornada({ carga_semanal: "42", escala: "5x2" }, "2027-01-10").nivel).toBe("atencao");
    expect(situacaoJornada({ carga_semanal: "42", escala: "5x2" }, "2027-12-16").nivel).toBe("fora");
  });

  it("12x36 vira aviso de renegociação depois da etapa 1", () => {
    expect(situacaoJornada({ escala: "12x36" }, "2026-11-20").nivel).toBe("ok");
    expect(situacaoJornada({ escala: "12x36" }, "2026-12-16").nivel).toBe("atencao");
  });

  it("hipersuficiente fica fora do limite de horas", () => {
    expect(situacaoJornada({ carga_semanal: 44, hipersuficiente: true }, "2027-12-20").nivel).toBe("ok");
  });

  it("sem carga e sem escala é sem_dado", () => {
    expect(situacaoJornada({}, "2026-11-16").nivel).toBe("sem_dado");
  });
});

describe("proximoProblema", () => {
  it("aponta a etapa em que a jornada de hoje deixa de valer", () => {
    const p = proximoProblema({ carga_semanal: 44, escala: "6x1" }, "2026-11-16");
    expect(p?.etapa.inicio).toBe("2026-12-16");
    expect(p?.situacao.nivel).toBe("fora");
  });

  it("40h em 5x2 nunca tem problema", () => {
    expect(proximoProblema({ carga_semanal: 40, escala: "5x2" }, "2026-11-16")).toBeNull();
  });
});

describe("resumo e divisor", () => {
  it("monta o resumo curto", () => {
    expect(resumoJornada({ carga_semanal: "42.00", escala: "5x2", folga: "Sábado e domingo" })).toBe(
      "42h · 5x2 · folga sábado e domingo",
    );
  });
  it("divisor mensal 220/210/200", () => {
    expect([44, 42, 40].map(divisorMensal)).toEqual([220, 210, 200]);
  });
});

describe("ficha de admissão por data", () => {
  it("esconde 44h e 6x1 para admissão a partir de 16/12/2026", () => {
    const ids = presetsParaData("2026-12-16", "2026-11-16").map((p) => p.id);
    expect(ids).not.toContain("comercial44");
    expect(ids).not.toContain("6x1");
    expect(ids).toContain("42h");
    expect(ids).toContain("40h");
  });
  it("esconde 42h a partir de 16/12/2027", () => {
    expect(presetsParaData("2027-12-16", "2026-11-16").map((p) => p.id)).not.toContain("42h");
  });
  it("sem data usa hoje", () => {
    expect(presetsParaData("", "2026-11-16").map((p) => p.id)).toContain("comercial44");
  });
  it("avisa carga acima do limite da data de admissão", () => {
    const a = avisoJornadaAdmissao({ dataAdmissao: "2027-01-05", cargaSemanal: "44", diaFolga: "Domingo", jornadaPreset: "personalizado" });
    expect(a).toContain("42h");
    expect(
      avisoJornadaAdmissao({ dataAdmissao: "2027-01-05", cargaSemanal: "40", diaFolga: "Sábado e domingo", jornadaPreset: "40h" }),
    ).toBeNull();
  });
});

describe("lerJornada (API)", () => {
  it("aceita campos válidos e vírgula decimal", () => {
    expect(lerJornada({ carga_semanal: "42,5", escala: "5x2", horario_entrada: "08:00" }).campos).toEqual({
      carga_semanal: 42.5,
      escala: "5x2",
      horario_entrada: "08:00",
    });
  });
  it("recusa escala e horário inválidos", () => {
    expect(lerJornada({ escala: "7x0" }).erro).toBeTruthy();
    expect(lerJornada({ horario_saida: "25:00" }).erro).toBeTruthy();
    expect(lerJornada({ carga_semanal: 90 }).erro).toBeTruthy();
  });
  it("vazio limpa o campo", () => {
    expect(lerJornada({ folga: "" }).campos).toEqual({ folga: null });
  });
});
