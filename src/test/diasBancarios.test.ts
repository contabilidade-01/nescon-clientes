/**
 * Calendário bancário. Todo alerta de vencimento sai daqui — um feriado errado é uma
 * mensagem no dia errado, que vale menos que nenhuma mensagem.
 *
 * As datas usadas são de 2026 e foram conferidas contra o calendário real.
 */
import { describe, it, expect } from "vitest";
import {
  feriadosNacionais,
  ehDiaBancario,
  ehDiaUtilTrabalhista,
  proximoDiaBancario,
  diaBancarioAnterior,
  ultimoDiaBancarioDoMes,
  nEsimoDiaUtilTrabalhista,
  ddmm,
} from "../../api/src/diasBancarios.js";

describe("feriados nacionais", () => {
  it("calcula os móveis a partir da Páscoa (05/04/2026)", () => {
    const f = feriadosNacionais(2026);
    expect(f.has("2026-02-16")).toBe(true); // segunda de Carnaval
    expect(f.has("2026-02-17")).toBe(true); // terça de Carnaval
    expect(f.has("2026-04-03")).toBe(true); // Sexta-feira Santa
    expect(f.has("2026-06-04")).toBe(true); // Corpus Christi
  });

  it("traz os fixos", () => {
    const f = feriadosNacionais(2026);
    for (const d of ["2026-01-01", "2026-04-21", "2026-05-01", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-12-25"]) {
      expect(f.has(d)).toBe(true);
    }
  });

  it("Consciência Negra só é nacional a partir de 2024", () => {
    expect(feriadosNacionais(2023).has("2023-11-20")).toBe(false);
    expect(feriadosNacionais(2024).has("2024-11-20")).toBe(true);
    expect(feriadosNacionais(2026).has("2026-11-20")).toBe(true);
  });
});

describe("ehDiaBancario", () => {
  it("dia comum de semana é bancário", () => {
    expect(ehDiaBancario("2026-08-20")).toBe(true); // quinta
  });

  it("fim de semana e feriado não são", () => {
    expect(ehDiaBancario("2026-08-22")).toBe(false); // sábado
    expect(ehDiaBancario("2026-08-23")).toBe(false); // domingo
    expect(ehDiaBancario("2026-01-01")).toBe(false);
  });

  it("24 e 31 de dezembro não têm expediente bancário", () => {
    expect(ehDiaBancario("2026-12-24")).toBe(false); // quinta
    expect(ehDiaBancario("2026-12-31")).toBe(false); // quinta
  });

  it("data inválida não vira dia bancário por acidente", () => {
    expect(ehDiaBancario("2026-02-31")).toBe(false);
    expect(ehDiaBancario("qualquer coisa")).toBe(false);
  });
});

describe("ajuste para dia bancário", () => {
  it("antecipa: 20/09/2026 é domingo, o anterior é sexta 18", () => {
    expect(diaBancarioAnterior("2026-09-20")).toBe("2026-09-18");
  });

  it("adia: 20/09/2026 é domingo, o próximo é segunda 21", () => {
    expect(proximoDiaBancario("2026-09-20")).toBe("2026-09-21");
  });

  it("dia que já é bancário não se move", () => {
    expect(proximoDiaBancario("2026-08-20")).toBe("2026-08-20");
    expect(diaBancarioAnterior("2026-08-20")).toBe("2026-08-20");
  });

  it("atravessa feriado emendado", () => {
    // 01/05/2026 é sexta (Dia do Trabalho): o anterior é quinta 30/04.
    expect(diaBancarioAnterior("2026-05-01")).toBe("2026-04-30");
    // e o próximo é segunda 04/05.
    expect(proximoDiaBancario("2026-05-01")).toBe("2026-05-04");
  });
});

describe("ultimoDiaBancarioDoMes", () => {
  it("maio/2026 termina em domingo: cai na sexta 29", () => {
    expect(ultimoDiaBancarioDoMes(2026, 5)).toBe("2026-05-29");
  });

  it("dezembro para no dia 30, porque 31 não tem expediente", () => {
    expect(ultimoDiaBancarioDoMes(2026, 12)).toBe("2026-12-30");
  });

  it("mês que termina em dia útil comum", () => {
    expect(ultimoDiaBancarioDoMes(2026, 8)).toBe("2026-08-31"); // segunda
  });
});

describe("5º dia útil trabalhista (salário)", () => {
  it("sábado conta como dia útil — é o que a CLT manda", () => {
    expect(ehDiaUtilTrabalhista("2026-08-01")).toBe(true); // sábado
    expect(ehDiaUtilTrabalhista("2026-08-02")).toBe(false); // domingo
  });

  it("agosto/2026 começa num sábado: o 5º útil é 06/08", () => {
    expect(nEsimoDiaUtilTrabalhista(2026, 8, 5)).toEqual({ data: "2026-08-06", sabado: false });
  });

  it("dezembro/2026 começa numa terça: o 5º útil cai no sábado 05/12", () => {
    expect(nEsimoDiaUtilTrabalhista(2026, 12, 5)).toEqual({ data: "2026-12-05", sabado: true });
  });

  it("contar pela régua bancária daria data diferente — e adiantada", () => {
    // Sem o sábado, o 5º dia de agosto/2026 seria 07/08 em vez de 06/08.
    const trabalhista = nEsimoDiaUtilTrabalhista(2026, 8, 5);
    expect(trabalhista?.data).toBe("2026-08-06");
    expect(ehDiaBancario("2026-08-01")).toBe(false);
  });
});

describe("ddmm", () => {
  it("formata para a mensagem", () => {
    expect(ddmm("2026-08-20")).toBe("20/08");
  });
});
