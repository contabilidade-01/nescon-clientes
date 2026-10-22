import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { montarTexto } = require("../../api/src/docNotify.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classificar, categoriaDe } = require("../../api/src/gclick/guides.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { avisaDocumentoNovo } = require("../../api/src/gclick/avisoDocumento.js");

describe("aviso de guia do mês com link sem senha", () => {
  it("guia leva o link sem senha; folha continua no portal", () => {
    process.env.PUBLIC_APP_URL = "https://app.teste";
    const t = montarTexto(
      "ALFA",
      [
        { title: "DAS", competencia: "09/2026", guia: true },
        { title: "Recibos", competencia: "09/2026", guia: false },
      ],
      "https://app.teste/g/abc"
    );
    expect(t).toContain("Baixe suas guias aqui (sem senha): https://app.teste/g/abc");
    expect(t).toContain("Demais documentos no portal: https://app.teste/documentos");
  });
  it("sem guia: só o portal, como antes", () => {
    process.env.PUBLIC_APP_URL = "https://app.teste";
    const t = montarTexto("ALFA", [{ title: "Recibos", guia: false }]);
    expect(t).toContain("Acesse: https://app.teste/documentos");
    expect(t).not.toContain("sem senha");
  });
});

describe("parcelamento como guia do mês", () => {
  it("DAS de parcelamento não vira DAS do mês e avisa", () => {
    const c = classificar("DAS Parcelamento Simples Nacional 09-2026.pdf");
    expect(c.codigo).toBe("PARCELAMENTO");
    expect(categoriaDe("PARCELAMENTO")).toBe("guia");
    expect(avisaDocumentoNovo("PARCELAMENTO")).toBe(true);
    expect(classificar("DAS Simples 09-2026.pdf").codigo).toBe("DAS");
  });
});
