/**
 * Caminho guiado do planejador (modo simples do portal): empresa, equipe e escala em 3
 * passos, escala puxada do cadastro e "Não sei" com a regra mais segura.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlanejadorEscala } from "@/components/escala/PlanejadorEscala";
import { configDoCadastro, fraseDaPessoa, mesclarPlano, normalizarConfigEmpresa } from "@/lib/escala/planejamento";

describe("escala puxada do cadastro", () => {
  it("5x2 com folga sábado e domingo e o horário do cadastro", () => {
    const c = configDoCadastro("1", "Ana", { escala: "5x2", folga: "Sábado e domingo", horario_entrada: "09:00", horario_saida: "18:00" }, "5x2");
    expect(c).toMatchObject({ modelo: "5x2", folgas5x2: [6, 0], entrada: "09:00", saida: "18:00" });
  });

  it("5x2 com folga num dia da semana vira rodízio com essa folga", () => {
    const c = configDoCadastro("1", "Ana", { escala: "5x2", folga: "Quarta-feira" }, "5x2");
    expect(c).toMatchObject({ modelo: "5x2_rev", folgaFixa: 3 });
  });

  it("6x1 depois da emenda cai no modelo do mês e guarda a folga para a transição", () => {
    const c = configDoCadastro("1", "Ana", { escala: "6x1", folga: "Domingo", horario_entrada: "08:00", horario_saida: "16:20" }, "5x2");
    expect(c).toMatchObject({ modelo: "5x2", folga6x1: 0, entrada: "08:00", saida: "17:00" });
    expect(configDoCadastro("1", "Ana", { escala: "6x1", folga: "Segunda-feira" }, "6x1", { permite6x1: true })).toMatchObject({
      modelo: "6x1",
      folga6x1: 1,
    });
  });

  it("4x3 só com acordo; sem escala no cadastro vale o padrão", () => {
    expect(configDoCadastro("1", "Ana", { escala: "4x3" }, "5x2")).toBeNull();
    expect(configDoCadastro("1", "Ana", { escala: "4x3" }, "5x2", { temAcordo: true })?.modelo).toBe("4x3");
    expect(configDoCadastro("1", "Ana", {}, "5x2")).toBeNull();
  });

  it("mesclarPlano usa o cadastro só para quem não tem mês salvo", () => {
    const p = mesclarPlano(null, [{ id: "a", name: "Ana", cadastro: { escala: "12x36" } }, { id: "b", name: "Bia" }], "5x2");
    expect(p.configs.map((c) => c.modelo)).toEqual(["12x36", "5x2"]);
    const salvo = mesclarPlano({ configs: [{ ...p.configs[1], id: "a", nome: "Ana" }], ajustes: {} }, [{ id: "a", name: "Ana", cadastro: { escala: "12x36" } }], "5x2");
    expect(salvo.configs[0].modelo).toBe("5x2");
  });

  it("descreve a escala em palavras", () => {
    const c = configDoCadastro("1", "Ana", { escala: "5x2", folga: "Sábado e domingo" }, "5x2")!;
    expect(fraseDaPessoa(c)).toBe("Trabalha 5 dias e folga sábado e domingo, das 08:00 às 17:00.");
  });

  it("guarda quem marcou a atividade e o que o cliente não soube", () => {
    const cfg = normalizarConfigEmpresa({ atividadePeloEscritorio: true, naoSabe: ["acordo", "x", "acordo"] });
    expect(cfg.atividadePeloEscritorio).toBe(true);
    expect(cfg.naoSabe).toEqual(["acordo"]);
  });
});

const mockApi = vi.hoisted(() => ({ config: vi.fn(), salvarConfig: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: {
    escalas: {
      config: mockApi.config,
      planos: vi.fn().mockResolvedValue([]),
      plano: vi.fn().mockResolvedValue(null),
      salvarConfig: mockApi.salvarConfig,
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
  { id: "1", name: "Ana", cadastro: { escala: "5x2", folga: "Domingo e segunda-feira" } },
  { id: "2", name: "Bruno" },
];

describe("caminho guiado na tela", () => {
  beforeEach(() => {
    localStorage.removeItem("escala-modo-portal");
    mockApi.salvarConfig.mockReset().mockResolvedValue({});
  });

  it("empresa com Não sei, equipe do cadastro e escolha de uma sugestão", async () => {
    mockApi.config.mockResolvedValue({ dados: null, atualizado_em: null, atualizado_por: null });
    comQuery(<PlanejadorEscala pessoas={PESSOAS} />);
    await waitFor(() => expect(screen.getByText("Qual é o ramo da empresa?")).toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: /Cenários/ })).not.toBeInTheDocument();
    const continuar = screen.getByRole("button", { name: /Continuar/ });
    expect(continuar).toBeDisabled();
    fireEvent.click(screen.getAllByRole("radio", { name: /Não sei/ })[0]);
    fireEvent.click(screen.getAllByRole("radio", { name: /Não sei/ })[1]);
    fireEvent.click(continuar);
    await waitFor(() =>
      expect(mockApi.salvarConfig).toHaveBeenCalledWith(
        expect.objectContaining({ segmento: "comercio", temAcordoColetivo: false, atividadeDefinida: true, naoSabe: ["atividade", "acordo"] }),
        undefined,
      ),
    );

    await waitFor(() => expect(screen.getByText("Confira como cada pessoa trabalha hoje")).toBeInTheDocument());
    expect(screen.getByText(/Trabalha 5 dias e folga domingo e segunda/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));

    await waitFor(() => expect(screen.getByText("Escolha uma escala")).toBeInTheDocument());
    const quero = screen.getAllByRole("button", { name: "Quero esta" });
    expect(quero.length).toBeGreaterThan(0);
    fireEvent.click(quero[0]);
    await waitFor(() => expect(screen.getAllByText("Em uso").length).toBe(1));
    expect(screen.getByText("Mudanças ainda não salvas")).toBeInTheDocument();
    expect(screen.getByText(/Semana de cada pessoa/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Baixar PDF/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Baixar Excel/ })).toBeInTheDocument();
  });

  it("atividade marcada pelo escritório: abre na escala e o cliente só vê a empresa", async () => {
    mockApi.config.mockResolvedValue({
      dados: { segmento: "restaurante", atividadeDefinida: true, atividadePeloEscritorio: true },
      atualizado_em: null,
      atualizado_por: null,
    });
    comQuery(<PlanejadorEscala pessoas={PESSOAS} />);
    await waitFor(() => expect(screen.getByText("Escolha uma escala")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Trocar atividade/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sua empresa/ }));
    expect(screen.getByText(/Informado pelo escritório/)).toBeInTheDocument();
    expect(screen.queryByText("Qual é o ramo da empresa?")).not.toBeInTheDocument();
  });

  it("modo avançado mostra as abas completas", async () => {
    mockApi.config.mockResolvedValue({ dados: { segmento: "comercio", atividadeDefinida: true }, atualizado_em: null, atualizado_por: null });
    comQuery(<PlanejadorEscala pessoas={PESSOAS} />);
    await waitFor(() => expect(screen.getByText("Escolha uma escala")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Modo avançado/ }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Escala do mês/ })).toBeInTheDocument());
    expect(localStorage.getItem("escala-modo-portal")).toBe("avancado");
  });
  it("com acordo coletivo oferece usar as 42h e mostra as horas da semana", async () => {
    mockApi.config.mockResolvedValue({
      dados: { segmento: "comercio", atividadeDefinida: true, temAcordoColetivo: true },
      atualizado_em: null,
      atualizado_por: null,
    });
    comQuery(<PlanejadorEscala pessoas={PESSOAS} />);
    await waitFor(() => expect(screen.getByText("Escolha uma escala")).toBeInTheDocument());
    expect(screen.getAllByText(/40h por semana/).length).toBeGreaterThan(0);
    const usar = screen.getAllByRole("button", { name: /Usar as 42h: 08:00 às 17:24/ });
    fireEvent.click(usar[0]);
    await waitFor(() => expect(screen.getAllByText(/42h por semana/).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /Voltar ao horário padrão/ })).toBeInTheDocument();
  });
});
