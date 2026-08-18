/**
 * Carência de compensação na cobrança de honorário.
 *
 * Reproduz o caso real: honorário vence no SÁBADO, cliente paga na SEGUNDA (1º dia útil),
 * boleto compensa TERÇA à tarde. Sem carência, o marco 3 (dias corridos) dispara terça de
 * manhã e cobra quem já pagou. Com carência de 2 dias úteis, a 1ª cobrança só sai quando
 * a compensação já teve tempo de aparecer.
 */
import { describe, it, expect } from "vitest";
import { itensBoletoDoDia, diasUteisAposVencimento } from "../../api/src/alertas.js";

// 2026-08 (referência de dias da semana):
//  sáb 15/08, dom 16, seg 17, ter 18, qua 19, qui 20, sex 21.
const SABADO = "2026-08-15";

const honorario = (over = {}) => ({
  id: "h1",
  title: "Honorários 08/2026",
  valor_centavos: 50000,
  due_date: SABADO,
  is_honorario: true,
  ...over,
});

const opts = (hoje: string, over = {}) => ({
  hoje,
  diasAntes: 1,
  cobrancaDias: [3, 10, 30],
  honorariosCobrancaDias: [1, 3, 5, 10, 15, 30],
  lembreteOn: true,
  cobrancaOn: true,
  carenciaHonorarioDiasUteis: 2,
  ...over,
});

describe("diasUteisAposVencimento", () => {
  it("vencimento sábado conta a partir da segunda (1º dia útil)", () => {
    // seg é o vencimento efetivo → 0 dias úteis após
    expect(diasUteisAposVencimento(SABADO, "2026-08-17")).toBe(0);
    // ter = 1 dia útil após; qua = 2
    expect(diasUteisAposVencimento(SABADO, "2026-08-18")).toBe(1);
    expect(diasUteisAposVencimento(SABADO, "2026-08-19")).toBe(2);
  });
});

describe("carência de honorário (o caso do Jean)", () => {
  it("NÃO cobra na terça (marco 3 corridos, mas só 1 dia útil de compensação)", () => {
    // sáb + 3 corridos = terça 18. Sem carência cobraria; com 2 dias úteis, não.
    const r = itensBoletoDoDia([honorario()], opts("2026-08-18"));
    expect(r).toHaveLength(0);
  });

  it("cobra a partir da quinta (marco 5 corridos = 3 dias úteis, compensação já visível)", () => {
    // sáb + 5 corridos = quinta 20 → 3 dias úteis após o venc. efetivo (seg).
    const r = itensBoletoDoDia([honorario()], opts("2026-08-20"));
    expect(r).toHaveLength(1);
    expect(r[0].diasEmAtraso).toBe(5);
  });

  it("carência não afeta boleto COMUM (não-honorário mantém a régua)", () => {
    const comum = honorario({ id: "c1", is_honorario: false });
    // boleto comum marco 3 = terça: continua cobrando normalmente.
    const r = itensBoletoDoDia([comum], opts("2026-08-18"));
    expect(r).toHaveLength(1);
    expect(r[0].diasEmAtraso).toBe(3);
  });

  it("carência não afeta o LEMBRETE (antes do vencimento não há o que compensar)", () => {
    // lembrete = vence amanhã. Honorário que vence sexta 21, hoje quinta 20.
    const h = honorario({ due_date: "2026-08-21" });
    const r = itensBoletoDoDia([h], opts("2026-08-20"));
    expect(r).toHaveLength(1);
    expect(r[0].diasEmAtraso).toBeNull(); // é lembrete, não cobrança
  });

  it("com carência 0 (desligada), volta a cobrar na terça", () => {
    const r = itensBoletoDoDia([honorario()], opts("2026-08-18", { carenciaHonorarioDiasUteis: 0 }));
    expect(r).toHaveLength(1);
    expect(r[0].diasEmAtraso).toBe(3);
  });
});
