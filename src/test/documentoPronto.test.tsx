import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentoPronto } from "@/components/DocumentoPronto";
import { dpDocDocxUrl } from "@/lib/api";

const blob = new Blob(["x"]);

describe("DocumentoPronto", () => {
  it("não mostra nada antes de gerar", () => {
    const { container } = render(<DocumentoPronto doc={null} titulo="Advertência gerada" />);
    expect(container.innerHTML).toBe("");
  });

  it("link avulso: botão Baixar Word aponta para o link do servidor", () => {
    render(
      <DocumentoPronto
        doc={{ blob, fileName: "advertencia.docx", url: dpDocDocxUrl("abc123") }}
        titulo="Advertência gerada"
      />
    );
    const link = screen.getByRole("link", { name: /baixar word/i });
    expect(link.getAttribute("href")).toMatch(/\/dp-docs\/abc123\/docx$/);
  });

  it("portal: sem link do servidor, mostra botão que baixa o arquivo gerado", () => {
    render(<DocumentoPronto doc={{ blob, fileName: "suspensao.docx" }} titulo="Suspensão gerada" />);
    expect(screen.getByRole("button", { name: /baixar word/i })).toBeTruthy();
  });
});
