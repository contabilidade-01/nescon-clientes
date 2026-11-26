import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExcluirFuncionario } from "@/components/escala/ExcluirFuncionario";

describe("excluir funcionário pela escala", () => {
  it("funcionário: inativar é o padrão e dá para escolher excluir de vez", async () => {
    const onConfirmar = vi.fn();
    const { unmount } = render(<ExcluirFuncionario nome="Ana" vaga={false} onFechar={() => {}} onConfirmar={onConfirmar} />);
    fireEvent.click(screen.getByRole("button", { name: "Inativar" }));
    expect(onConfirmar).toHaveBeenLastCalledWith("inativar");
    fireEvent.click(screen.getByText("Cadastro errado ou repetido"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Excluir de vez" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Excluir de vez" }));
    expect(onConfirmar).toHaveBeenLastCalledWith("excluir");
    unmount();
  });

  it("vaga simulada só some", () => {
    const onConfirmar = vi.fn();
    render(<ExcluirFuncionario nome="Vaga simulada 1" vaga onFechar={() => {}} onConfirmar={onConfirmar} />);
    expect(screen.queryByText("Saiu da empresa")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Excluir vaga" }));
    expect(onConfirmar).toHaveBeenCalledWith("excluir");
  });
});
