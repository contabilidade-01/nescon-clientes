/**
 * Construtor de modelos: adicionar blocos pela paleta, editar, remover e a regra de
 * condição. (O arrastar em si é do @dnd-kit e depende de layout real, que o jsdom não tem;
 * a reordenação é arrayMove sobre a lista, coberta pela ordem renderizada.)
 */
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ListaBlocos } from "../components/onboarding/ConstrutorModelo";
import { comUids, semUids, resumoRegras, type Bloco } from "../lib/onboardingModelo";

function Harness({ inicial = [] as Bloco[], aoMudar = vi.fn() }) {
  const [blocos, setBlocos] = useState<Bloco[]>(comUids(inicial));
  return (
    <ListaBlocos
      blocos={blocos}
      onChange={(b) => {
        setBlocos(b);
        aoMudar(semUids(b));
      }}
    />
  );
}

describe("construtor de modelos", () => {
  it("lista vazia mostra a orientação", () => {
    render(<Harness />);
    expect(screen.getByText(/Arraste um tipo de bloco/)).toBeTruthy();
  });

  it("clicar num tipo da paleta adiciona o bloco já aberto, com padrões do tipo", () => {
    const aoMudar = vi.fn();
    render(<Harness aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole("button", { name: /Documento/ }));
    expect(screen.getAllByTestId("bloco-modelo")).toHaveLength(1);
    const ultimo = aoMudar.mock.calls.at(-1)![0] as Bloco[];
    expect(ultimo[0]).toMatchObject({ tipo: "documento", obrigatorio: true, prazo: { ref: "assinatura", dias: 5, uteis: true } });
    expect(ultimo[0]).not.toHaveProperty("uid");
    expect(screen.getByLabelText("Título do bloco")).toBeTruthy();
  });

  it("editar título e prazo reflete no modelo", () => {
    const aoMudar = vi.fn();
    render(<Harness aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole("button", { name: /Documento/ }));
    fireEvent.change(screen.getByLabelText("Título do bloco"), { target: { value: "Extratos" } });
    fireEvent.change(screen.getByLabelText("Dias de prazo"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Formatos aceitos"), { target: { value: "PDF, ofx" } });
    const b = (aoMudar.mock.calls.at(-1)![0] as Bloco[])[0];
    expect(b.titulo).toBe("Extratos");
    expect(b.prazo?.dias).toBe(7);
    expect(b.formatos).toEqual(["pdf", "ofx"]);
  });

  it("'Mostrar só em alguns contratos' cria e remove a condição", () => {
    const aoMudar = vi.fn();
    render(<Harness aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole("button", { name: /Passo/ }));
    fireEvent.click(screen.getByLabelText(/Mostrar só em alguns contratos/));
    fireEvent.click(screen.getByRole("button", { name: "Pessoal" }));
    expect((aoMudar.mock.calls.at(-1)![0] as Bloco[])[0].condicao).toEqual({ areas: ["pessoal"] });
    fireEvent.click(screen.getByLabelText(/Mostrar só em alguns contratos/));
    expect((aoMudar.mock.calls.at(-1)![0] as Bloco[])[0].condicao).toBeUndefined();
  });

  it("remove o bloco escolhido e mantém a ordem dos outros", () => {
    const aoMudar = vi.fn();
    const inicial: Bloco[] = [
      { tipo: "etapa", titulo: "Primeiro", descricao: "" },
      { tipo: "etapa", titulo: "Segundo", descricao: "" },
      { tipo: "etapa", titulo: "Terceiro", descricao: "" },
    ];
    render(<Harness inicial={inicial} aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole("button", { name: "Remover bloco Segundo" }));
    const itens = screen.getAllByTestId("bloco-modelo");
    expect(itens.map((i) => within(i).getAllByText(/Primeiro|Terceiro/)[0].textContent)).toEqual(["Primeiro", "Terceiro"]);
    expect((aoMudar.mock.calls.at(-1)![0] as Bloco[]).map((b) => b.titulo)).toEqual(["Primeiro", "Terceiro"]);
  });
});

describe("resumo das regras", () => {
  it("descreve em uma linha", () => {
    expect(resumoRegras({})).toBe("Qualquer contrato");
    expect(resumoRegras({ enquadramento: ["simples"], areas: ["contabil", "fiscal"], comFuncionarios: true })).toBe("Simples · contabil + fiscal · com funcionários");
  });
});
