/**
 * Janela diurna de envio: a trava de "nenhuma mensagem de madrugada".
 *
 * Função pura sobre minutos-desde-a-meia-noite (SP), então dá para varrer o dia inteiro
 * sem mexer no relógio. É a mesma fonte que alerta de vencimento, cobrança de boleto,
 * aviso de documento e envio de acesso consultam antes de mandar qualquer coisa.
 */
import { describe, it, expect } from "vitest";
import { dentroDaJanela, JANELA_INICIO_MIN, JANELA_FIM_MIN, descricaoJanela } from "../../api/src/janelaEnvio.js";

describe("dentroDaJanela", () => {
  it("bloqueia a madrugada", () => {
    for (const min of [0, 2 * 60, 5 * 60, 7 * 60 + 59]) {
      expect(dentroDaJanela(min)).toBe(false);
    }
  });

  it("abre às 08:00 em ponto", () => {
    expect(dentroDaJanela(JANELA_INICIO_MIN)).toBe(true);
    expect(dentroDaJanela(JANELA_INICIO_MIN - 1)).toBe(false);
  });

  it("libera o horário comercial", () => {
    for (const min of [8 * 60, 12 * 60, 15 * 60 + 30, 18 * 60 + 59]) {
      expect(dentroDaJanela(min)).toBe(true);
    }
  });

  it("fecha às 19:00 (exclusive) e bloqueia a noite", () => {
    expect(dentroDaJanela(JANELA_FIM_MIN)).toBe(false);
    expect(dentroDaJanela(JANELA_FIM_MIN - 1)).toBe(true);
    for (const min of [20 * 60, 22 * 60, 23 * 60 + 59]) {
      expect(dentroDaJanela(min)).toBe(false);
    }
  });

  it("descreve a janela de forma legível", () => {
    expect(descricaoJanela()).toBe("08:00–19:00");
  });
});
