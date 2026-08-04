/**
 * Leitor da Programação de Férias. As linhas abaixo são **cópias exatas** do PDF real
 * do QUEIJEIRO 3 (emissão 22/07/2026), como o pdf-parse entrega — com as tabulações no
 * lugar. Testar contra texto inventado esconderia justamente o que quebra na prática.
 */
import { describe, it, expect } from "vitest";
import { extrairDoTexto, lerLinha } from "../../api/src/vacationParser.js";

// FLAVIA é o caso de referência: 11 faltas e 24 dias de direito no relatório.
const LINHA_FLAVIA =
  "FLAVIA MORAES DE GOIS\t8 01/05/2024 1 08/12 01/05/2025\t30/04/2026 .... 24 0 24 07/04/2027 - 11\t....\t....\t..../..../......\t30/04/2026";
const LINHA_CONTINUACAO =
  "01/05/2026 .... 20 0 30 01/04/2028 - 1\t....\t....\t..../..../......\t30/04/2027";

const CABECALHO = [
  "RESTAURANTE DO QUEIJEIRO 3 LIMITADA",
  "52.191.264/0001-73",
  "PROGRAMAÇÃO DE FÉRIAS",
  "31/12/2026",
  "CNPJ:",
  "Data base:",
  "1 / 1",
  "22/07/2026",
  "09:50:14",
].join("\n");

describe("linha de funcionário", () => {
  it("lê nome, código, admissão e o período", () => {
    const r = lerLinha(LINHA_FLAVIA)!;
    expect(r.continuacao).toBe(false);
    expect(r.nome).toBe("FLAVIA MORAES DE GOIS");
    expect(r.codigo).toBe("8");
    expect(r.admissao).toBe("2024-05-01");
    expect(r.periodo).toMatchObject({
      inicioAquisitivo: "2025-05-01",
      fimAquisitivo: "2026-04-30",
      limiteGozo: "2027-04-07",
      diasDireito: 24,
      faltas: 11,
    });
  });

  it("os três números são acumulado, gozados e DIREITO — nessa ordem", () => {
    // A ordem foi deduzida do próprio relatório: na continuação, quem tem 1 falta
    // aparece com 30 no terceiro número. Se o terceiro fosse "restantes", uma pessoa
    // com 0 faltas teria direito a 20 dias — o que contraria o Art. 130.
    const r = lerLinha(LINHA_CONTINUACAO)!;
    expect(r.periodo).toMatchObject({ diasAcumulados: 20, diasGozados: 0, diasDireito: 30, faltas: 1 });
  });

  it("continuação não traz nome nem código", () => {
    const r = lerLinha(LINHA_CONTINUACAO)!;
    expect(r.continuacao).toBe(true);
    expect(r.periodo.inicioAquisitivo).toBe("2026-05-01");
    expect(r.periodo.fimAquisitivo).toBe("2027-04-30");
  });

  it("aceita a ordem invertida (código antes do nome)", () => {
    // É como o outro extrator de PDF entrega a mesma linha.
    const invertida =
      "8 FLAVIA MORAES DE GOIS 01/05/2024 1 08/12 01/05/2025 30/04/2026 .... 24 0 24 07/04/2027 - 11";
    const r = lerLinha(invertida)!;
    expect(r.nome).toBe("FLAVIA MORAES DE GOIS");
    expect(r.codigo).toBe("8");
    expect(r.periodo.faltas).toBe(11);
  });

  it("linha que não é de funcionário é ignorada", () => {
    expect(lerLinha("Total de empregados: 15")).toBeNull();
    expect(lerLinha("Sistema licenciado para NESCON SERVICOS EMPRESARIAIS LTDA")).toBeNull();
    expect(lerLinha("")).toBeNull();
  });

  it("traço em afastamento e faltas vira zero, não texto", () => {
    const semFaltas =
      "ANA CLAUDIA CICERO DE FREITAS SALES\t30 29/11/2025 1 01/12 29/11/2025\t28/11/2026 .... 30 0 30 30/10/2027 - -\t....\t28/11/2026";
    expect(lerLinha(semFaltas)!.periodo).toMatchObject({ faltas: 0, diasAfastamento: 0 });
  });

  it("dias com vírgula viram decimal", () => {
    const proporcional = "29/11/2026 .... 2,5 0 30 30/10/2028 - -\t....\t28/11/2027";
    expect(lerLinha(proporcional)!.periodo.diasAcumulados).toBe(2.5);
  });
});

describe("documento inteiro", () => {
  const texto = [CABECALHO, LINHA_FLAVIA, LINHA_CONTINUACAO, "Total de empregados: 1"].join("\n");

  it("lê o cabeçalho", () => {
    const r = extrairDoTexto(texto);
    expect(r.empresa).toBe("RESTAURANTE DO QUEIJEIRO 3 LIMITADA");
    expect(r.cnpj).toBe("52191264000173");
    expect(r.dataBase).toBe("2026-12-31");
    expect(r.emissao).toBe("2026-07-22");
  });

  it("agrupa a continuação no funcionário anterior", () => {
    const r = extrairDoTexto(texto);
    expect(r.funcionarios).toHaveLength(1);
    expect(r.funcionarios[0].periodos).toHaveLength(2);
  });

  it("guarda o total declarado no rodapé, para conferência", () => {
    expect(extrairDoTexto(texto).totalDeclarado).toBe(1);
  });

  it("continuação órfã (quebra de página) é contada, não atribuída a ninguém", () => {
    const r = extrairDoTexto([CABECALHO, LINHA_CONTINUACAO].join("\n"));
    expect(r.funcionarios).toHaveLength(0);
    expect(r.ignoradas).toBe(1);
  });

  it("texto que não é o relatório não devolve funcionário nenhum", () => {
    expect(extrairDoTexto("qualquer coisa\noutra linha").funcionarios).toHaveLength(0);
  });
});
