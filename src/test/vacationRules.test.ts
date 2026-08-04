/**
 * Regras de férias. Três coisas com consequência real para o cliente:
 * o número de faltas que ainda cabem, a data que dispara o alerta e o custo.
 *
 * As fronteiras das faixas do Art. 130 (5/6, 14/15, 23/24, 32/33) são testadas uma a
 * uma: errar por uma falta muda os dias de férias de uma pessoa.
 */
import { describe, it, expect } from "vitest";
import {
  diasPorFaltas,
  faixaLabel,
  faltasParaProximaPerda,
  limiteSeguranca,
  situacao,
  custoFerias,
  somarCustos,
} from "../../api/src/vacationRules.js";

describe("Art. 130 — dias por faltas", () => {
  it("as fronteiras de cada faixa", () => {
    expect(diasPorFaltas(0)).toBe(30);
    expect(diasPorFaltas(5)).toBe(30);
    expect(diasPorFaltas(6)).toBe(24);
    expect(diasPorFaltas(14)).toBe(24);
    expect(diasPorFaltas(15)).toBe(18);
    expect(diasPorFaltas(23)).toBe(18);
    expect(diasPorFaltas(24)).toBe(12);
    expect(diasPorFaltas(32)).toBe(12);
    expect(diasPorFaltas(33)).toBe(0);
    expect(diasPorFaltas(100)).toBe(0);
  });

  it("confere com o PDF real: 11 e 13 faltas dão 24 dias", () => {
    // FLAVIA (11 faltas) e GRAZIELI (13) aparecem com 24 dias no QUEIJEIRO 3.
    expect(diasPorFaltas(11)).toBe(24);
    expect(diasPorFaltas(13)).toBe(24);
  });

  it("valor ausente ou negativo conta como zero falta", () => {
    expect(diasPorFaltas(null)).toBe(30);
    expect(diasPorFaltas(-3)).toBe(30);
  });

  it("rótulo da faixa", () => {
    expect(faixaLabel(3)).toBe("Até 5 faltas");
    expect(faixaLabel(11)).toBe("6 a 14 faltas");
    expect(faixaLabel(40)).toBe("Mais de 32 faltas");
  });
});

describe("quantas faltas ainda cabem", () => {
  it("com 11 faltas, mais 4 e perde 6 dias", () => {
    expect(faltasParaProximaPerda(11)).toMatchObject({
      diasAtuais: 24,
      faltasRestantes: 4,
      diasDepois: 18,
      perde: 6,
    });
  });

  it("na borda da faixa, a próxima falta já derruba", () => {
    expect(faltasParaProximaPerda(5)).toMatchObject({ faltasRestantes: 1, diasDepois: 24 });
    expect(faltasParaProximaPerda(14)).toMatchObject({ faltasRestantes: 1, diasDepois: 18 });
    expect(faltasParaProximaPerda(32)).toMatchObject({ faltasRestantes: 1, diasDepois: 0, perde: 12 });
  });

  it("sem nenhuma falta, ainda cabem 6", () => {
    expect(faltasParaProximaPerda(0)).toMatchObject({ diasAtuais: 30, faltasRestantes: 6 });
  });

  it("acima de 32 não há mais o que perder", () => {
    expect(faltasParaProximaPerda(33)).toBeNull();
  });
});

describe("limite de segurança e situação", () => {
  const hoje = new Date(2026, 7, 4); // 04/08/2026

  it("antecipa 30 dias o limite oficial", () => {
    expect(limiteSeguranca("2026-10-30")).toBe("2026-09-30");
    expect(limiteSeguranca(null)).toBeNull();
  });

  it("passou do limite oficial é vencida", () => {
    expect(situacao("2026-08-03", hoje)).toBe("vencida");
  });

  it("vencer hoje ainda não é vencida", () => {
    expect(situacao("2026-08-04", hoje)).toBe("a_vencer");
  });

  it("dentro dos 30 dias finais é a vencer; um dia antes disso ainda é ok", () => {
    expect(situacao("2026-09-03", hoje)).toBe("a_vencer"); // segurança em 04/08
    expect(situacao("2026-09-04", hoje)).toBe("ok"); // segurança em 05/08
  });

  it("sem data na Programação, não inventa situação", () => {
    expect(situacao(null, hoje)).toBe("sem_limite");
  });
});

describe("custo: férias + 1/3 + FGTS", () => {
  it("30 dias de um salário de 3.000", () => {
    const c = custoFerias(3000, 30);
    expect(c).toMatchObject({ bruto: 3000, umTerco: 1000, fgts: 320, total: 4320 });
  });

  it("o FGTS incide sobre férias JÁ com o terço", () => {
    const c = custoFerias(3000, 30)!;
    // 8% de 3.000 seriam 240; sobre 4.000 são 320. É a diferença que o terço faz.
    expect(c.fgts).toBe(320);
    expect(c.fgts).not.toBe(240);
  });

  it("proporcional aos dias", () => {
    expect(custoFerias(3000, 24)!.bruto).toBe(2400);
  });

  it("sem salário devolve null, não zero", () => {
    expect(custoFerias(null, 30)).toBeNull();
    expect(custoFerias(0, 30)).toBeNull();
  });

  it("sem dias também devolve null", () => {
    expect(custoFerias(3000, 0)).toBeNull();
  });

  it("soma ignora quem está sem salário, mas conta quantos são", () => {
    const total = somarCustos([custoFerias(3000, 30), null, custoFerias(1500, 30)]);
    expect(total.total).toBe(6480);
    expect(total.semSalario).toBe(1);
  });
});
