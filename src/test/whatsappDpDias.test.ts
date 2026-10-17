// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dp = require("../../api/src/whatsappDp.js");

describe("suspensão pelo WhatsApp: dias não mudam de carona no motivo", () => {
  // Caso relatado (12x36): escolheu 1 dia, o calendário saiu com uma data só, e o
  // motivo "faltou 2 dias" virava suspensão de 02 plantões no termo.
  it("motivo citando quantidade de faltas não troca os dias já escolhidos", () => {
    for (const texto of ["Faltou 2 dias sem avisar", "faltou dia 2", "chegou atrasado 3 vezes", "brigou com 2 colegas"]) {
      const p = dp.patchDeSlots({ ia: {}, texto, step: "motivo_sus", diasAtuais: 1 });
      expect(p.dias, texto).toBeUndefined();
    }
  });

  it("IA também não troca os dias fora da confirmação", () => {
    const p = dp.patchDeSlots({ ia: { dias: 2 }, texto: "Faltou 2 dias", step: "motivo_sus", diasAtuais: 1 });
    expect(p.dias).toBeUndefined();
  });

  it("data digitada no passo da data não vira dias", () => {
    const p = dp.patchDeSlots({ ia: {}, texto: "dia 2", step: "data", diasAtuais: 1 });
    expect(p.dias).toBeUndefined();
  });

  it("pedido inicial com a quantidade de suspensão continua valendo", () => {
    const p = dp.patchDeSlots({ ia: {}, texto: "suspender o João por 1 dia", step: "funcionario" });
    expect(p.dias).toBe(1);
  });

  it("correção explícita na confirmação ainda muda os dias", () => {
    expect(dp.patchDeSlots({ ia: {}, texto: "são 2 dias", step: "confirma", diasAtuais: 1 }).dias).toBe(2);
    expect(dp.patchDeSlots({ ia: {}, texto: "o motivo é falta no dia 2", step: "confirma", diasAtuais: 1 }).dias).toBeUndefined();
  });

  it("lerDiasExplicitos exige a forma N dia(s)/plantão", () => {
    expect(dp.lerDiasExplicitos("2")).toBeNull();
    expect(dp.lerDiasExplicitos("16/10/2026")).toBeNull();
    expect(dp.lerDiasExplicitos("um plantão")).toBe(1);
    expect(dp.lerDiasExplicitos("faltou 3 dias, suspensão de 1 dia")).toBe(1);
    expect(dp.lerDiasExplicitos("suspender o João por 2 plantões")).toBe(2);
    expect(dp.lerDiasExplicitos("1 dia de suspensão, faltou 3 dias")).toBe(1);
  });
});
