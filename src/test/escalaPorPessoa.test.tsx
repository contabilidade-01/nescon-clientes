/**
 * Simulação por funcionário: as opções de uma pessoa só trazem variações dentro da regra,
 * respeitam os dias em que a casa fecha e são medidas contra a equipe toda.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlanejadorEscala } from "@/components/escala/PlanejadorEscala";
import { diaDaSemana } from "@/lib/escala/datas";
import { feriadosDaEmpresa } from "@/lib/escala/feriados";
import { avaliarPessoa, configPadrao, normalizarConfigEmpresa, type ConfigEmpresa } from "@/lib/escala/planejamento";
import { opcoesDaPessoa } from "@/lib/escala/porPessoa";

const feriados = new Set(feriadosDaEmpresa([2026, 2027], [], false).keys());
const MES = "2027-01";

function cenario(patch: Partial<ConfigEmpresa> = {}) {
  const empresa: ConfigEmpresa = { ...normalizarConfigEmpresa(null), segmento: "comercio", ...patch };
  const configs = Array.from({ length: 6 }, (_, i) => configPadrao(String(i), `P${i}`, "5x2"));
  const equipe = configs.map((c) => avaliarPessoa(c, MES, {}, empresa, feriados));
  return { empresa, configs, equipe };
}

describe("opções por funcionário", () => {
  it("só lista variações dentro da regra e trava a 6x1 e a 4x3 sem acordo", () => {
    const { empresa, configs, equipe } = cenario();
    const grupos = opcoesDaPessoa(configs[0], equipe, {}, MES, empresa, feriados);
    const g = (m: string) => grupos.find((x) => x.modelo === m)!;
    expect(g("6x1").opcoes).toEqual([]);
    expect(g("6x1").indisponivel).toMatch(/proibida/);
    expect(g("4x3").indisponivel).toMatch(/acordo/);
    expect(g("5x2").opcoes[0].atual).toBe(true);
    for (const grupo of grupos) for (const o of grupo.opcoes.filter((x) => !x.atual)) expect(o.erros).toBe(0);
    expect(g("5x2_rev").opcoes.length).toBeGreaterThan(1);
  });

  it("não escala a pessoa no dia em que a casa fecha", () => {
    const { empresa, configs, equipe } = cenario({ segmento: "restaurante", diasFechados: [1] });
    const grupos = opcoesDaPessoa(configs[0], equipe, {}, MES, empresa, feriados);
    const opcoes = grupos.flatMap((g) => g.opcoes).filter((o) => !o.atual);
    expect(opcoes.length).toBeGreaterThan(0);
    for (const o of opcoes) expect(o.avaliacao.dias.some((d) => d.turno && diaDaSemana(d.data) === 1)).toBe(false);
    expect(grupos.find((g) => g.modelo === "5x2_fechado")!.opcoes.length).toBeGreaterThan(0);
  });

  it("mede a equipe com a opção: com demanda no sábado, a melhor tira a folga do sábado", () => {
    const { empresa, configs, equipe } = cenario({ demanda: [0, 0, 0, 0, 0, 0, 1] });
    const g = opcoesDaPessoa(configs[0], equipe, {}, MES, empresa, feriados).find((x) => x.modelo === "5x2")!;
    const [atual, melhor] = g.opcoes;
    expect(atual.diasDescobertos).toBeGreaterThan(0);
    expect(melhor.diasDescobertos).toBe(0);
    expect(melhor.mediaPorDia[6]).toBeGreaterThan(atual.mediaPorDia[6]);
  });
});

const mockApi = vi.hoisted(() => ({ config: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: {
    escalas: {
      config: mockApi.config,
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

describe("aba Por funcionário", () => {
  beforeEach(() => {
    mockApi.config.mockResolvedValue({ dados: { segmento: "comercio", atividadeDefinida: true }, atualizado_em: null, atualizado_por: null });
  });

  it("escolhe a pessoa, troca só a escala dela e mostra a equipe", async () => {
    comQuery(
      <PlanejadorEscala
        pessoas={[
          { id: "1", name: "Ana" },
          { id: "2", name: "Bruno" },
        ]}
      />,
    );
    const aba = await screen.findByRole("tab", { name: /Por funcionário/ });
    fireEvent.mouseDown(aba, { button: 0 });
    await waitFor(() => expect(screen.getByText("Visão da equipe")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Bruno/, pressed: false }));
    expect(screen.getByText("Opções para Bruno")).toBeInTheDocument();
    const usar = screen.getAllByRole("button", { name: "Usar esta" }).find((b) => !b.hasAttribute("disabled"))!;
    fireEvent.click(usar);
    await waitFor(() => expect(screen.getByText("Mudanças não salvas")).toBeInTheDocument());
    expect(screen.getAllByText("Em uso")).toHaveLength(1);
  });
});
