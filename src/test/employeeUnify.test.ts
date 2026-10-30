/**
 * Unificação do cadastro feito pelo cliente com o da folha. Unir errado junta duas
 * pessoas (o histórico de uma vai para a outra), então o automático só pega o óbvio.
 */
import { describe, it, expect } from "vitest";
import {
  normalizarNome,
  ehProvisorio,
  paresAutomaticos,
  sugestoesManuais,
  semelhanca,
} from "../../api/src/employeeUnify.js";

const oficial = (id: string, name: string, cpf: string, extra = {}) => ({
  id, name, cpf, codigo: id, origem: "escritorio", active: true, conferido_em: null, ...extra,
});
const doCliente = (id: string, name: string, cpf: string, extra = {}) => ({
  id, name, cpf, codigo: null, origem: "cliente", active: true, conferido_em: null, ...extra,
});

describe("employeeUnify", () => {
  it("normaliza acento, caixa e espaços", () => {
    expect(normalizarNome("  José  da Silva ")).toBe("JOSE DA SILVA");
  });

  it("provisório = sem código e (do cliente ou sem CPF)", () => {
    expect(ehProvisorio(doCliente("1", "A", "52998224725"))).toBe(true);
    expect(ehProvisorio({ ...oficial("2", "B", ""), codigo: null })).toBe(true);
    expect(ehProvisorio({ ...oficial("3", "C", "52998224725"), codigo: null })).toBe(false);
    expect(ehProvisorio({ ...doCliente("4", "D", "52998224725"), codigo: "15" })).toBe(false);
  });

  it("une sozinho quando o CPF é o mesmo", () => {
    const pares = paresAutomaticos([
      oficial("o1", "JOSE DA SILVA", "52998224725"),
      doCliente("c1", "Zé da Silva", "529.982.247-25"),
    ]);
    expect(pares.map((p) => [p.manter.id, p.absorver.id])).toEqual([["o1", "c1"]]);
  });

  it("une sozinho quando o nome é idêntico e o cliente errou um dígito do CPF", () => {
    const pares = paresAutomaticos([
      oficial("o1", "JOSÉ DA SILVA", "52998224725"),
      doCliente("c1", "jose da silva", "52998224735"),
    ]);
    expect(pares).toHaveLength(1);
  });

  it("listagem sem CPF une pelo nome", () => {
    const pares = paresAutomaticos([
      oficial("o1", "ANA LIMA", "52998224725"),
      { ...oficial("p1", "ANA LIMA", ""), codigo: null },
    ]);
    expect(pares.map((p) => p.absorver.id)).toEqual(["p1"]);
  });

  it("nome igual com CPFs bem diferentes pode ser homônimo: não une sozinho", () => {
    const pares = paresAutomaticos([
      oficial("o1", "ANA LIMA", "52998224725"),
      doCliente("c1", "ANA LIMA", "11144477735"),
    ]);
    expect(pares).toHaveLength(0);
  });

  it("dois oficiais com o mesmo nome: ambíguo, não une", () => {
    const pares = paresAutomaticos([
      oficial("o1", "ANA LIMA", "52998224725"),
      oficial("o2", "ANA LIMA", "11144477735"),
      { ...oficial("p1", "ANA LIMA", ""), codigo: null },
    ]);
    expect(pares).toHaveLength(0);
  });

  it("nome parecido vira sugestão para o admin", () => {
    const [s] = sugestoesManuais([
      oficial("o1", "MARIA APARECIDA SOUZA", "52998224725"),
      doCliente("c1", "MARIA SOUZA", "11144477735"),
    ]);
    expect(s.provisorio.id).toBe("c1");
    expect(s.sugestao?.id).toBe("o1");
    expect(s.semelhanca).toBeGreaterThanOrEqual(60);
  });

  it("sem ninguém parecido: provavelmente admissão nova, sem sugestão", () => {
    const [s] = sugestoesManuais([
      oficial("o1", "CARLOS PEREIRA", "52998224725"),
      doCliente("c1", "BEATRIZ NUNES", "11144477735"),
    ]);
    expect(s.sugestao).toBeNull();
  });

  it("já conferido pelo admin sai da lista", () => {
    expect(sugestoesManuais([doCliente("c1", "BEATRIZ", "11144477735", { conferido_em: new Date() })])).toHaveLength(0);
  });

  it("semelhança: primeiro nome diferente pesa pouco", () => {
    expect(semelhanca({ name: "JOAO SILVA", cpf: "" }, { name: "PEDRO SILVA", cpf: "" })).toBeLessThan(0.6);
  });
});
