import { describe, expect, it } from "vitest";
import { clausulasAditivo, gerarAditivoJornadaPdf, type AditivoJornadaDados } from "@/lib/generateAditivoJornadaPdf";

const base: AditivoJornadaDados = {
  empresaNome: "Empresa Teste Ltda",
  empresaCnpj: "12345678000190",
  funcionarioNome: "Maria da Silva",
  funcionarioCpf: "12345678901",
  jornadaAnterior: "44h · 6x1",
  inicio: "2026-12-14",
  cargaSemanal: "40",
  escala: "5x2",
  folga: "Sábado e domingo",
  entrada: "08:00",
  saida: "17:00",
  intervalo: "1 hora",
  cidade: "Campinas/SP",
  dataAssinatura: "2026-11-16",
};

describe("aditivo de jornada", () => {
  it("traz a nova jornada, a data, a anterior e a manutenção do salário", () => {
    const txt = clausulasAditivo(base).map((c) => c.texto).join(" ");
    expect(txt).toContain("14/12/2026");
    expect(txt).toContain("40 (40) horas semanais");
    expect(txt).toContain("escala 5x2");
    expect(txt).toContain("44h · 6x1");
    expect(txt).toContain("não implica redução do salário");
    expect(txt).toContain("art. 468");
  });
  it("cita o acordo coletivo só quando há ampliação diária", () => {
    expect(clausulasAditivo(base).map((c) => c.texto).join(" ")).not.toContain("convenção coletiva aplicável");
    expect(clausulasAditivo({ ...base, cargaSemanal: "42", comAcordo: true }).map((c) => c.texto).join(" ")).toContain(
      "convenção coletiva aplicável",
    );
  });
  it("gera o PDF", () => {
    const doc = gerarAditivoJornadaPdf(base);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
