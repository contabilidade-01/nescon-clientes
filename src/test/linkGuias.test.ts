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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { situacaoVencida } = require("../../api/src/routes/acesso.js");

describe("guia do mês vencida: situação vem do relatório da Receita", () => {
  const das = { doc_type: "DAS", due_date: "2026-10-20" };
  const deb = { tipo: "SN", data_vencimento: "2026-10-20", periodo_aaaamm: "202609" };
  it("consta em atraso no relatório → em aberto (recalcula)", () => {
    expect(situacaoVencida(das, { relatorio_data: "2026-10-26" }, [deb]).situacao).toBe("em_aberto");
  });
  it("relatório posterior ao vencimento sem débito → sem registro (provável pago)", () => {
    expect(situacaoVencida(das, { relatorio_data: "2026-10-26" }, []).situacao).toBe("sem_registro");
  });
  it("relatório anterior ao vencimento → sem informação", () => {
    expect(situacaoVencida(das, { relatorio_data: "2026-10-02" }, []).situacao).toBe("sem_info");
  });
  it("FGTS a Receita não informa → sem informação", () => {
    expect(situacaoVencida({ doc_type: "FGTS", due_date: "2026-10-20" }, { relatorio_data: "2026-10-26" }, [deb]).situacao).toBe("sem_info");
  });
});
