import { describe, it, expect } from "vitest";
import { documentoDoBoleto, emAberto, resumirSemCadastro } from "../../api/src/coraSemCadastro.js";

describe("documentoDoBoleto", () => {
  it("aceita os formatos que a Cora já usou", () => {
    expect(documentoDoBoleto({ customer_document: "12.345.678/0001-90" })).toBe("12345678000190");
    expect(documentoDoBoleto({ customer: { document: { identity: "12345678000190" } } })).toBe("12345678000190");
    expect(documentoDoBoleto({ customer: { document: "123.456.789-09" } })).toBe("12345678909");
    expect(documentoDoBoleto({})).toBe("");
  });
});

describe("emAberto", () => {
  it("pago, cancelado e rascunho não contam", () => {
    for (const s of ["PAID", "CANCELLED", "DRAFT", "RECURRENCE_DRAFT", "REJECTED"]) expect(emAberto(s)).toBe(false);
    for (const s of ["OPEN", "LATE", "IN_PAYMENT"]) expect(emAberto(s)).toBe(true);
  });
});

describe("resumirSemCadastro", () => {
  const b = (id: string, doc: string, status = "OPEN", due = "2026-09-10", valor = 10000) => ({
    id, status, due_date: due, total_amount: valor, customer_document: doc, customer_name: `Cliente ${doc}`,
  });
  const cadastro = new Map([
    ["11111111000111", { boletosAtivo: true }],
    ["22222222000122", { boletosAtivo: false }],
  ]);

  it("cadastrada com boletos ligados fica de fora (a sync normal já traz)", () => {
    expect(resumirSemCadastro([b("1", "11111111000111")], cadastro)).toEqual([]);
  });

  it("separa sem cadastro de boletos desligados e soma por cliente", () => {
    const r = resumirSemCadastro(
      [
        b("1", "33333333000133", "LATE", "2026-08-10", 5000),
        b("2", "33333333000133", "OPEN", "2026-09-10", 7000),
        b("3", "22222222000122"),
        b("4", "33333333000133", "PAID"),
      ],
      cadastro
    );
    expect(r).toHaveLength(2);
    const sem = r.find((x) => x.documento === "33333333000133")!;
    expect(sem).toMatchObject({ situacao: "sem_cadastro", boletos: 2, total_centavos: 12000 });
    expect(sem.vencimentos).toEqual(["2026-08-10", "2026-09-10"]);
    expect(r.find((x) => x.documento === "22222222000122")!.situacao).toBe("sem_acesso_boletos");
  });

  it("boleto sem documento é ignorado", () => {
    expect(resumirSemCadastro([{ id: "9", status: "OPEN" }], cadastro)).toEqual([]);
  });
});
