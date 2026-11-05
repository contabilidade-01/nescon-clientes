/**
 * Janela de horário do aviso de "documento novo". Dentro do horário comercial sai na
 * hora; fora dele, agenda para as 08:00 (mesmo dia se for madrugada, seguinte se noite).
 */
import { describe, it, expect } from "vitest";
import { podeEnviarAgora, podeDrenar, mesclarDocumentos, diaDoEnvioAgendado } from "../../api/src/docNotify.js";

const H = (h: number, m = 0) => h * 60 + m;

describe("podeEnviarAgora — janela comercial 08:00–17:59", () => {
  it("envia na hora dentro do horário comercial", () => {
    expect(podeEnviarAgora(H(8, 0))).toBe(true);
    expect(podeEnviarAgora(H(14, 30))).toBe(true);
    expect(podeEnviarAgora(H(17, 59))).toBe(true);
  });

  it("NÃO envia de madrugada nem a partir das 18h (vai para a fila)", () => {
    expect(podeEnviarAgora(H(0, 7))).toBe(false); // 00:07 — o caso do DAS
    expect(podeEnviarAgora(H(7, 59))).toBe(false);
    expect(podeEnviarAgora(H(18, 0))).toBe(false); // 18:00 já é fora
    expect(podeEnviarAgora(H(23, 30))).toBe(false);
  });
});

describe("podeDrenar — entrega dos agendados na mesma janela 08:00–17:59", () => {
  it("libera a partir das 08:00 e durante o dia", () => {
    expect(podeDrenar(H(8, 0))).toBe(true);
    expect(podeDrenar(H(17, 59))).toBe(true);
  });

  it("não drena antes das 08:00 nem a partir das 18h", () => {
    expect(podeDrenar(H(7, 50))).toBe(false);
    expect(podeDrenar(H(18, 0))).toBe(false);
    expect(podeDrenar(H(2, 0))).toBe(false);
  });
});

describe("diaDoEnvioAgendado — madrugada sai hoje, noite sai amanhã", () => {
  it("chegou de madrugada: sai às 08h do mesmo dia", () => {
    expect(diaDoEnvioAgendado("2026-11-05", H(2, 0))).toBe("2026-11-05");
  });
  it("chegou depois das 18h: sai às 08h do dia seguinte", () => {
    expect(diaDoEnvioAgendado("2026-11-05", H(20, 21))).toBe("2026-11-06");
  });
});

describe("mesclarDocumentos — junta sem duplicar (título+competência)", () => {
  it("remove duplicatas e ignora item sem título", () => {
    const a = [{ title: "DAS", competencia: "2026-08" }];
    const b = [
      { title: "DAS", competencia: "2026-08" },
      { title: "FGTS", competencia: "2026-08" },
      { title: "", competencia: "x" },
    ];
    expect(mesclarDocumentos(a, b)).toEqual([
      { title: "DAS", competencia: "2026-08", guia: false },
      { title: "FGTS", competencia: "2026-08", guia: false },
    ]);
  });
});
