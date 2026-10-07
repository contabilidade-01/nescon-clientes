/**
 * Fluxo da tela: o assistente devolve um patch → a proposta ganha os itens e a prévia
 * mostra os valores. A API é simulada; o que se garante é a costura tela ↔ motor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContratoPreview } from "../components/ContratoPreview";
import { AssistentePropostas } from "../components/propostas/AssistentePropostas";
import { AbaServicos } from "../components/propostas/FormularioProposta";
import {
  CATALOGO_PADRAO,
  aplicarPacote,
  metaPropostaPdf,
  montarProposta,
  propostaNova,
  reconciliar,
  type PropostaDados,
} from "../lib/propostaModelo";

const assistente = vi.fn();
vi.mock("@/lib/api", () => ({ api: { admin: { propostas: { assistente: (...a: unknown[]) => assistente(...a) } } } }));

const cat = CATALOGO_PADRAO;

function Harness({ ia = true }: { ia?: boolean }) {
  const [d, setD] = useState<PropostaDados>(() => propostaNova(cat));
  const meta = metaPropostaPdf(d, cat.padroes);
  return (
    <div>
      <AssistentePropostas dados={d} setDados={(x) => setD(reconciliar(x, cat))} catalogo={cat} habilitado={ia} />
      <ContratoPreview blocos={montarProposta(d, cat.padroes)} rodapeEsquerda={meta.rodapeEsquerda} rodapeDireita={meta.rodapeDireita} faixa={meta.faixa} />
    </div>
  );
}

describe("assistente de propostas (tela)", () => {
  beforeEach(() => {
    assistente.mockReset();
  });

  it("aplica o patch do assistente e a prévia mostra os valores do catálogo", async () => {
    assistente.mockResolvedValue({
      mensagem: "Montei a regularização. Quantas competências do DAS estão atrasadas?",
      patch: {
        cliente: { nome: "João MEI", enquadramento: "mei" },
        pacotes: ["mei_regularizacao"],
        alterar: [{ codigo: "dasn_atraso", quantidade: 3 }],
      },
      faltando: ["competências em atraso"],
      pronta: false,
    });
    const { container } = render(<Harness />);
    expect(container.textContent).toContain("PROPOSTA"); // faixa da proposta, não "CONTRATO"
    fireEvent.change(screen.getByPlaceholderText(/Descreva o cliente/), { target: { value: "MEI com 3 DASN em atraso" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Descreva o cliente/), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Montei a regularização/)).toBeTruthy());
    expect(assistente).toHaveBeenCalledTimes(1);
    const enviado = assistente.mock.calls[0][0];
    expect(enviado.catalogo.itens.length).toBeGreaterThan(10);
    expect(enviado.estado.itens).toHaveLength(0);
    expect(container.textContent).toContain("João MEI");
    expect(container.textContent).toContain("R$ 450,00"); // 3 × R$ 150
    expect(container.textContent).toContain("+ Declaração anual do MEI");
  });

  it("assistente desligado: avisa e bloqueia o envio", () => {
    render(<Harness ia={false} />);
    expect(screen.getByText(/Assistente desligado/)).toBeTruthy();
    expect((screen.getByPlaceholderText(/indisponível/) as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("mostra erro do assistente sem quebrar a tela", async () => {
    assistente.mockImplementation(async () => {
      throw new Error("Claude API: sem créditos");
    });
    render(<Harness />);
    fireEvent.change(screen.getByPlaceholderText(/Descreva o cliente/), { target: { value: "oi" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Descreva o cliente/), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/sem créditos/)).toBeTruthy());
  });
});

describe("aba de serviços", () => {
  it("cenário aplicado mostra o roteiro de perguntas e os itens", () => {
    const d = aplicarPacote(propostaNova(cat), cat, "mei_regularizacao");
    render(<AbaServicos d={d} set={() => {}} catalogo={cat} onPacote={() => {}} onItem={() => {}} />);
    expect(screen.getByText("O que perguntar ao cliente")).toBeTruthy();
    expect(screen.getByText(/Quais anos de DASN-SIMEI/)).toBeTruthy();
    expect(screen.getAllByDisplayValue(/Declaração anual do MEI/).length).toBe(1);
  });
});
