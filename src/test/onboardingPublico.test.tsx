/**
 * Página do cliente novo: mostra os passos, prazo e situação de cada documento, e manda
 * o arquivo para o item certo. A API é simulada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OnboardingPublicoPage from "../pages/OnboardingPublicoPage";
import type { OnboardingCliente } from "../lib/onboardingModelo";

const get = vi.fn();
const enviar = vi.fn();
vi.mock("@/lib/api", () => ({ api: { onboarding: { get: (...a: unknown[]) => get(...a), enviar: (...a: unknown[]) => enviar(...a) } } }));

const base: OnboardingCliente = {
  cliente_nome: "Padaria Bom Pão",
  status: "aguardando",
  progresso: { enviados: 0, total: 2 },
  itens: [
    { id: "1-boas_vindas", tipo: "boas_vindas", titulo: "Bem-vindo", descricao: "Siga os passos abaixo." },
    { id: "2-documento", tipo: "documento", titulo: "Contrato social", descricao: "", obrigatorio: true, formatos: ["pdf"], prazoData: "2026-10-12" },
    {
      id: "3-documento",
      tipo: "documento",
      titulo: "Extratos bancários",
      descricao: "",
      obrigatorio: true,
      prazoData: "2026-10-20",
      envio: { status: "reprovado", observacao: "Falta o mês de agosto", arquivo: "extrato.pdf", em: "2026-10-08" },
    },
    { id: "4-prazo_recorrente", tipo: "prazo_recorrente", titulo: "Variáveis da folha", descricao: "", regra: "Todo mês, até o dia 20." },
  ],
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/onboarding/abc"]}>
        <Routes>
          <Route path="/onboarding/:token" element={<OnboardingPublicoPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("página pública de onboarding", () => {
  beforeEach(() => {
    get.mockReset();
    enviar.mockReset();
  });

  it("mostra boas-vindas, prazos em dd/mm/aaaa, regra do mês e motivo da reprovação", async () => {
    get.mockResolvedValue(base);
    montar();
    expect(await screen.findByText("Olá, Padaria Bom Pão")).toBeTruthy();
    expect(screen.getByText("Siga os passos abaixo.")).toBeTruthy();
    expect(screen.getByText("12/10/2026")).toBeTruthy();
    expect(screen.getByText("Todo mês, até o dia 20.")).toBeTruthy();
    expect(screen.getByText(/Falta o mês de agosto/)).toBeTruthy();
    expect(screen.getByText("0 de 2 documentos enviados")).toBeTruthy();
  });

  it("envia o arquivo para o item certo e atualiza a tela com a resposta", async () => {
    get.mockResolvedValue(base);
    enviar.mockResolvedValue({ ...base, progresso: { enviados: 1, total: 2 } });
    const { container } = montar();
    await screen.findByText("Contrato social");
    const inputs = container.querySelectorAll('input[type="file"]');
    const arquivo = new File(["x"], "contrato.pdf", { type: "application/pdf" });
    fireEvent.change(inputs[0], { target: { files: [arquivo] } });
    await waitFor(() => expect(enviar).toHaveBeenCalledWith("abc", "2-documento", [arquivo]));
    expect(await screen.findByText("1 de 2 documentos enviados")).toBeTruthy();
  });

  it("link inválido mostra aviso em vez de quebrar", async () => {
    get.mockRejectedValue(new Error("Link inválido"));
    montar();
    expect(await screen.findByText("Link inválido ou expirado")).toBeTruthy();
  });
});
