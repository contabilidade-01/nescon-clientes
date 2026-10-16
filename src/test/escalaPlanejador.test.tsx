/**
 * Planejador de escalas: estado (troca de células, semanas das pontas), feriados da
 * escala, liberação por empresa e a tela montando a grade. O arrastar em si é do
 * @dnd-kit e depende de layout real; a troca é `trocarCelulas`, testada aqui.
 */
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlanejadorEscala } from "@/components/escala/PlanejadorEscala";
import { feriadosTrabalhistas } from "@/lib/escala/feriados";
import { configPadrao, diasDoMes, diasParaValidar, trocarCelulas } from "@/lib/escala/planejamento";
import { validarEscala } from "@/lib/escala/validar";
import { defaultToolAccess, isToolAllowed, mergeClientToolAccess } from "@/lib/companyTools";
import { DEFAULT_TOOL_ACCESS, mergeToolAccess } from "../../api/src/companyTools.js";

describe("estado do planejador", () => {
  it("dias do mês respeitam fevereiro e virada de ano", () => {
    expect(diasDoMes("2027-02")).toHaveLength(28);
    expect(diasDoMes("2026-12").at(-1)).toBe("2026-12-31");
  });

  it("valida o mês com as semanas das pontas completas", () => {
    // Jan/2027 começa numa sexta e termina num domingo.
    const dias = diasParaValidar(configPadrao("p", "Ana", "5x2"), "2027-01", {});
    expect(dias[0].data).toBe("2026-12-27");
    expect(dias.at(-1)!.data).toBe("2027-02-06");
  });

  it("arrastar a folga para outro dia da mesma pessoa troca os dois", () => {
    const c = configPadrao("p", "Ana", "6x1"); // folga no domingo
    const turno = { entrada: "08:00", saida: "16:20", intervaloMin: 60 };
    const aj = trocarCelulas({}, { pessoa: "p", data: "2026-11-01", turno: null }, { pessoa: "p", data: "2026-11-04", turno });
    const dias = diasParaValidar(c, "2026-11", aj);
    expect(dias.find((d) => d.data === "2026-11-01")!.turno).toEqual(turno);
    expect(dias.find((d) => d.data === "2026-11-04")!.turno).toBeNull();
  });

  it("trocar com outra pessoa mexe nas duas", () => {
    const t = { entrada: "08:00", saida: "17:00", intervaloMin: 60 };
    const aj = trocarCelulas({}, { pessoa: "a", data: "2026-11-02", turno: t }, { pessoa: "b", data: "2026-11-02", turno: null });
    expect(aj).toEqual({ a: { "2026-11-02": null }, b: { "2026-11-02": t } });
  });

  it("o 6x1 padrão de 44h passa hoje e falha em jan/2027", () => {
    const c = configPadrao("p", "Ana", "6x1");
    const erros = (mes: string) =>
      validarEscala(diasParaValidar(c, mes, {}), { segmento: "outro", temAcordoColetivo: false }).ocorrencias.filter(
        (o) => o.gravidade === "erro",
      );
    expect(erros("2026-11")).toEqual([]);
    expect(erros("2027-01").length).toBeGreaterThan(0);
  });
});

describe("feriados da escala", () => {
  it("tem Sexta-feira Santa e Consciência Negra, mas não Carnaval nem Corpus Christi", () => {
    const f = feriadosTrabalhistas(2026);
    expect(f.get("2026-04-03")).toBe("Sexta-feira Santa");
    expect(f.has("2026-11-20")).toBe(true);
    expect(f.has("2026-02-17")).toBe(false);
    expect(f.has("2026-06-04")).toBe(false);
  });
});

describe("liberação da ferramenta", () => {
  it("nasce desligada no portal e no servidor", () => {
    expect(defaultToolAccess().escalas).toBe(false);
    expect(mergeClientToolAccess({}).escalas).toBe(false);
    expect(isToolAllowed(undefined, "escalas")).toBe(false);
    expect(DEFAULT_TOOL_ACCESS.escalas).toBe(false);
    expect(mergeToolAccess({ boletos: true }).escalas).toBe(false);
  });

  it("liga quando o escritório marca, sem mexer nas outras", () => {
    expect(mergeClientToolAccess({ escalas: true }).escalas).toBe(true);
    expect(mergeToolAccess({ escalas: true }).escalas).toBe(true);
    expect(isToolAllowed(undefined, "boletos")).toBe(true);
  });
});

vi.mock("@/lib/api", () => ({
  api: {
    escalas: {
      config: vi.fn().mockResolvedValue({ dados: null, atualizado_em: null, atualizado_por: null }),
      planos: vi.fn().mockResolvedValue([]),
      plano: vi.fn().mockResolvedValue(null),
      salvarConfig: vi.fn().mockResolvedValue({}),
      salvarPlano: vi.fn().mockResolvedValue({}),
      excluirPlano: vi.fn().mockResolvedValue({ ok: true }),
    },
  },
}));

function comQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const PESSOAS = [
  { id: "1", name: "Ana" },
  { id: "2", name: "Bruno" },
];

describe("tela do planejador", () => {
  it("monta a grade com as pessoas e conta quem trabalha", async () => {
    comQuery(<PlanejadorEscala pessoas={PESSOAS} />);
    await waitFor(() => expect(screen.getAllByText("Ana").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Bruno").length).toBeGreaterThan(0);
    expect(screen.getByText("Pessoas trabalhando")).toBeInTheDocument();
  });

  it("acrescenta vaga simulada e marca como não salvo", async () => {
    const SEM: typeof PESSOAS = [];
    comQuery(<PlanejadorEscala pessoas={SEM} />);
    await waitFor(() => expect(screen.getByText(/ainda não foi salvo/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Vaga simulada/ }));
    expect(screen.getAllByText("Vaga simulada 1").length).toBeGreaterThan(0);
    expect(screen.getByText("Mudanças não salvas")).toBeInTheDocument();
  });
});
