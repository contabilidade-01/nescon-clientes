import { describe, expect, it } from "vitest";
import { normalizarConfigEmpresa } from "@/lib/escala/planejamento";

describe("funcionário de outra empresa do grupo", () => {
  it("lê os trazidos de outra empresa e os cedidos, sem repetir nem aceitar lixo", () => {
    const c = normalizarConfigEmpresa({
      emprestados: [
        { id: "f1", nome: "Maria de Fátima", cargo: "Atendente", origemId: "q3", origemNome: "Queijeiro 3" },
        { id: "f1", nome: "Repetida", origemId: "q3" },
        { id: "f2", nome: "Sem origem" },
        "lixo",
      ],
      cedidos: { f9: "Queijeiro Matriz", f8: "" },
    });
    expect(c.emprestados).toEqual([{ id: "f1", nome: "Maria de Fátima", cargo: "Atendente", origemId: "q3", origemNome: "Queijeiro 3" }]);
    expect(c.cedidos).toEqual({ f9: "Queijeiro Matriz" });
  });

  it("padrão sem ninguém emprestado", () => {
    const c = normalizarConfigEmpresa({});
    expect(c.emprestados).toEqual([]);
    expect(c.cedidos).toEqual({});
  });
});
