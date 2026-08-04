/**
 * Quem saiu da folha. A leitura automática do extrato NÃO inativa ninguém — ela usa
 * esta função para abrir avisos. Um erro aqui some com funcionário da tela do cliente,
 * então os casos de borda importam mais que o caminho feliz.
 */
import { describe, it, expect } from "vitest";
import { calcularSaidas } from "../../api/src/extratoAuto.js";

const ativos = [
  { id: "1", name: "ANA", cpf: "51051276845" },
  { id: "2", name: "BRUNO", cpf: "52998224725" },
  { id: "3", name: "CARLA", cpf: "11144477735" },
];

describe("calcularSaidas", () => {
  it("quem não veio no extrato é saída", () => {
    const r = calcularSaidas(ativos, ["51051276845", "11144477735"]);
    expect(r.map((e) => e.name)).toEqual(["BRUNO"]);
  });

  it("extrato completo não gera saída nenhuma", () => {
    expect(calcularSaidas(ativos, ativos.map((a) => a.cpf))).toHaveLength(0);
  });

  it("CPF mascarado no extrato casa com o cadastrado só em dígitos", () => {
    const r = calcularSaidas(ativos, ["510.512.768-45", "529.982.247-25", "111.444.777-35"]);
    expect(r).toHaveLength(0);
  });

  it("extrato vazio marcaria todos — por isso quem chama precisa barrar antes", () => {
    // Guarda de verdade fica em processarExtratos ("parse vazio" não processa). Este
    // teste existe para deixar explícito o que a função pura faria sozinha.
    expect(calcularSaidas(ativos, [])).toHaveLength(3);
  });

  it("funcionário sem CPF cadastrado não some por engano de comparação", () => {
    const semCpf = [{ id: "4", name: "SEM CPF", cpf: "" }];
    expect(calcularSaidas(semCpf, ["51051276845"])).toHaveLength(1);
  });
});
