/**
 * Funcionário × pró-labore. Esta regra decide se o cliente vê a seção Férias —
 * esconder de quem tem funcionário seria tirar um serviço contratado da vista.
 */
import { describe, it, expect } from "vitest";
import { ehProLabore, apenasFuncionariosFerias } from "../../api/src/payrollRoles.js";

describe("ehProLabore", () => {
  it("reconhece as formas que aparecem no extrato", () => {
    expect(ehProLabore("SOCIO ADMINISTRADOR")).toBe(true);
    expect(ehProLabore("SÓCIA")).toBe(true);
    expect(ehProLabore("DIRETOR")).toBe(true);
    expect(ehProLabore("Titular")).toBe(true);
    expect(ehProLabore("PRO-LABORE")).toBe(true);
    expect(ehProLabore("PRÓ LABORE")).toBe(true);
  });

  it("cargos operacionais não são pró-labore", () => {
    expect(ehProLabore("COZINHEIRA")).toBe(false);
    expect(ehProLabore("AUXILIAR DE COZINHA")).toBe(false);
    expect(ehProLabore("GARCOM")).toBe(false);
    expect(ehProLabore("ENCARREGADO")).toBe(false);
  });

  it("cargo desconhecido conta como funcionário", () => {
    // Enquanto o extrato não foi lido, cargo é nulo. Mostrar um menu a mais é barato;
    // esconder faz o cliente achar que perdeu um serviço.
    expect(ehProLabore(null)).toBe(false);
    expect(ehProLabore("")).toBe(false);
    expect(ehProLabore(undefined)).toBe(false);
  });

  it("não confunde palavra parecida dentro de outra", () => {
    // "ASSOCIADO" contém "socia" como trecho, mas não é pró-labore.
    expect(ehProLabore("ASSOCIADO DE VENDAS")).toBe(false);
  });
});

describe("apenasFuncionariosFerias", () => {
  it("empresa só com sócio fica sem funcionário", () => {
    const lista = [{ cargo: "SOCIO ADMINISTRADOR" }, { cargo: "DIRETORA" }];
    expect(apenasFuncionariosFerias(lista)).toHaveLength(0);
  });

  it("mistura de sócio e celetista devolve só o celetista", () => {
    const lista = [{ cargo: "SOCIO" }, { cargo: "COZINHEIRA" }, { cargo: null }];
    expect(apenasFuncionariosFerias(lista)).toHaveLength(2);
  });

  it("estagiário TEM férias (entra na lista, diferente do 13º)", () => {
    const lista = [{ cargo: "AUX ADMINISTRATIVO", vinculo: "Estagiário" }];
    expect(apenasFuncionariosFerias(lista)).toHaveLength(1);
  });
});
