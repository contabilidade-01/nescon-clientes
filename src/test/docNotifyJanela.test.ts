/**
 * Janela de horário do aviso de "documento novo". Dentro do horário comercial sai na
 * hora; fora dele, agenda para as 07:50 do dia seguinte (antes dos alertas das 08h).
 */
import { describe, it, expect } from "vitest";
import { podeEnviarAgora, podeDrenar, mesclarDocumentos } from "../../api/src/docNotify.js";

const H = (h: number, m = 0) => h * 60 + m;

describe("podeEnviarAgora — janela comercial 08:00–18:59", () => {
  it("envia na hora dentro do horário comercial", () => {
    expect(podeEnviarAgora(H(8, 0))).toBe(true);
    expect(podeEnviarAgora(H(14, 30))).toBe(true);
    expect(podeEnviarAgora(H(18, 59))).toBe(true);
  });

  it("NÃO envia de madrugada nem à noite (vai para a fila)", () => {
    expect(podeEnviarAgora(H(0, 7))).toBe(false); // 00:07 — o caso do DAS
    expect(podeEnviarAgora(H(7, 49))).toBe(false);
    expect(podeEnviarAgora(H(19, 0))).toBe(false); // 19:00 já é fora
    expect(podeEnviarAgora(H(23, 30))).toBe(false);
  });
});

describe("podeDrenar — entrega dos agendados a partir das 07:50", () => {
  it("libera a partir das 07:50 e durante o dia", () => {
    expect(podeDrenar(H(7, 50))).toBe(true);
    expect(podeDrenar(H(8, 0))).toBe(true);
    expect(podeDrenar(H(18, 59))).toBe(true);
  });

  it("não drena antes das 07:50 nem depois das 19h", () => {
    expect(podeDrenar(H(7, 49))).toBe(false);
    expect(podeDrenar(H(19, 0))).toBe(false);
    expect(podeDrenar(H(2, 0))).toBe(false);
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
      { title: "DAS", competencia: "2026-08" },
      { title: "FGTS", competencia: "2026-08" },
    ]);
  });
});
