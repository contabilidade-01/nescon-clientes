/**
 * Backoff da fila de reenvio (alert_outbox). Função pura: define quando a próxima
 * tentativa acontece e quando a mensagem esgota e vira falha definitiva.
 */
import { describe, it, expect } from "vitest";
import { calcularBackoff } from "../../api/src/alertasEnvio.js";

describe("calcularBackoff", () => {
  it("cresce exponencialmente em minutos (2, 4, 8, 16)", () => {
    expect(calcularBackoff(1, 5)).toEqual({ esgotou: false, proximaMin: 2 });
    expect(calcularBackoff(2, 5)).toEqual({ esgotou: false, proximaMin: 4 });
    expect(calcularBackoff(3, 5)).toEqual({ esgotou: false, proximaMin: 8 });
    expect(calcularBackoff(4, 5)).toEqual({ esgotou: false, proximaMin: 16 });
  });

  it("esgota ao atingir o teto de tentativas", () => {
    expect(calcularBackoff(5, 5)).toEqual({ esgotou: true, proximaMin: null });
    expect(calcularBackoff(6, 5)).toEqual({ esgotou: true, proximaMin: null });
  });

  it("limita o backoff a 6 horas (360 min)", () => {
    // 2^9 = 512 > 360 → teto de 360.
    expect(calcularBackoff(9, 100)).toEqual({ esgotou: false, proximaMin: 360 });
  });

  it("nunca calcula abaixo de 1 tentativa", () => {
    expect(calcularBackoff(0, 5)).toEqual({ esgotou: false, proximaMin: 2 });
  });
});
