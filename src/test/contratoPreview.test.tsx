/**
 * A prévia e o PDF desenham a mesma lista de blocos. Aqui só se garante que a prévia
 * renderiza todo tipo de bloco sem lançar e que marca os campos em branco.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ContratoPreview } from "../components/ContratoPreview";
import { dadosPadrao, montarContrato } from "../lib/contratoModelo";

describe("ContratoPreview", () => {
  it("renderiza o contrato inteiro e destaca os campos pendentes", () => {
    const d = dadosPadrao();
    d.contratante.razao = "EMPRESA TESTE LTDA";
    const { container } = render(
      <ContratoPreview blocos={montarContrato(d)} rodapeEsquerda={["NESCON"]} rodapeDireita={["Jeandson"]} />,
    );
    expect(container.textContent).toContain("EMPRESA TESTE LTDA");
    expect(container.textContent).toContain("CLÁUSULA 5");
    expect(container.querySelectorAll("mark").length).toBeGreaterThan(5);
    expect(container.querySelectorAll(".cd-secao").length).toBeGreaterThan(8);
  });
});
