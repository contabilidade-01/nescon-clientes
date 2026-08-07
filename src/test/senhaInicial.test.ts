/**
 * Senha inicial de acesso. Antes era o CNPJ — público e listável na Receita —, então
 * toda empresa que não tivesse feito o primeiro acesso estava aberta a quem soubesse o
 * número. Estes testes fixam o que não pode regredir.
 */
import { describe, it, expect } from "vitest";
import { gerarSenhaInicial, ALFABETO, TAMANHO } from "../../api/src/senhaInicial.js";

describe("alfabeto", () => {
  it("não tem caractere ambíguo — a senha é ditada ao telefone", () => {
    // 0/O, 1/l/I, 5/S, 8/B se confundem lidos em voz alta ou escritos à mão.
    expect(ALFABETO).not.toMatch(/[0O1lI5S8B]/);
  });

  it("não tem símbolo: complica de digitar sem ganhar segurança útil", () => {
    expect(ALFABETO).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("é grande o bastante para o comprimento compensar", () => {
    // 10 caracteres em 51 símbolos ≈ 57 bits. Com o limite de tentativas do login,
    // adivinhar é impraticável.
    const bits = TAMANHO * Math.log2(ALFABETO.length);
    expect(bits).toBeGreaterThan(50);
  });
});

describe("geração", () => {
  it("usa só o alfabeto, mais o hífen que separa os blocos", () => {
    for (let i = 0; i < 200; i += 1) {
      const s = gerarSenhaInicial();
      expect(s.replace("-", "")).toMatch(new RegExp(`^[${ALFABETO}]{${TAMANHO}}$`));
    }
  });

  it("nunca repete em volume — se repetisse, não seria aleatória", () => {
    const vistas = new Set<string>();
    for (let i = 0; i < 5000; i += 1) vistas.add(gerarSenhaInicial());
    expect(vistas.size).toBe(5000);
  });

  it("não é o CNPJ nem nada derivado dele", () => {
    const s = gerarSenhaInicial();
    expect(s.replace(/\D/g, "").length).toBeLessThan(14);
  });

  it("vem em dois blocos, para conferir ao ditar", () => {
    expect(gerarSenhaInicial()).toMatch(/^.{5}-.{5}$/);
  });

  it("distribui por todo o alfabeto, sem viés de módulo", () => {
    const usados = new Set<string>();
    for (let i = 0; i < 3000; i += 1) {
      for (const c of gerarSenhaInicial().replace("-", "")) usados.add(c);
    }
    // Com 30.000 sorteios, todo símbolo deve ter aparecido pelo menos uma vez.
    expect(usados.size).toBe(ALFABETO.length);
  });
});
