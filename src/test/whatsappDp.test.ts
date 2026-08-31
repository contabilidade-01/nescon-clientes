// @vitest-environment node
// pdfkit é uma lib de servidor: em jsdom ela tenta resolver os arquivos de fonte por URL
// e quebra na importação. Este módulo só roda no backend, então o teste roda em node.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dp = require("../../api/src/whatsappDp.js");
const doc = require("../../api/src/dpDocumento.js");

describe("classificação de tema (escopo fechado)", () => {
  it("reconhece advertência e suspensão", () => {
    expect(dp.classificarPorPalavra("preciso advertir o João")).toBe("advertencia");
    expect(dp.classificarPorPalavra("quero uma advertência")).toBe("advertencia");
    expect(dp.classificarPorPalavra("suspender a Maria por 3 dias")).toBe("suspensao");
    expect(dp.classificarPorPalavra("SUSPENSÃO do funcionário")).toBe("suspensao");
  });

  it("não assume tema em assunto fora do escopo", () => {
    for (const txt of ["quero demitir o José", "como está minha folha?", "boa tarde", "preciso das guias"]) {
      expect(dp.classificarPorPalavra(txt)).toBe("outro");
    }
  });
});

describe("resolverFuncionario — nunca inventa nome", () => {
  const lista = [
    { id: "1", name: "MARIA APARECIDA SILVA", cpf: "111" },
    { id: "2", name: "MARIA DE FATIMA SOUZA", cpf: "222" },
    { id: "3", name: "JOAO PEDRO LIMA", cpf: "333" },
  ];

  it("escolhe pelo número da lista", () => {
    expect(dp.resolverFuncionario(lista, "3").escolhido.id).toBe("3");
  });

  it("acha por nome único, ignorando acento e caixa", () => {
    expect(dp.resolverFuncionario(lista, "joão pedro lima").escolhido.id).toBe("3");
    expect(dp.resolverFuncionario(lista, "joao").escolhido.id).toBe("3");
  });

  it("devolve opções quando é ambíguo (duas Marias)", () => {
    const r = dp.resolverFuncionario(lista, "maria");
    expect(r.escolhido).toBeUndefined();
    expect(r.opcoes).toHaveLength(2);
  });

  it("não casa nada quando o nome não existe", () => {
    expect(dp.resolverFuncionario(lista, "carlos").escolhido).toBeUndefined();
  });

  it("escolhe o número mesmo com prefixo de nome do WhatsApp", () => {
    expect(dp.extrairResposta("Jean:\n2")).toBe("2");
    expect(dp.resolverFuncionario(lista, dp.extrairResposta("Jean:\n2")).escolhido.id).toBe("2");
  });
});

describe("parseData", () => {
  it("aceita hoje e amanhã", () => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    expect(dp.parseData("hoje")?.getTime()).toBe(hoje.getTime());
    expect(dp.parseData("AMANHÃ")?.getDate()).toBe(new Date(hoje.getTime() + 86400000).getDate());
  });

  it("aceita dd/mm/aaaa e dd/mm", () => {
    const d = dp.parseData("28/08/2026")!;
    expect([d.getDate(), d.getMonth(), d.getFullYear()]).toEqual([28, 7, 2026]);
    expect(dp.parseData("05/01")?.getMonth()).toBe(0);
  });

  it("rejeita data inválida em vez de inventar", () => {
    expect(dp.parseData("32/13/2026")).toBeNull();
    expect(dp.parseData("semana que vem")).toBeNull();
    expect(dp.parseData("")).toBeNull();
  });
});

describe("calendário 12x36", () => {
  it("1 plantão após anúncio em dia de trabalho: folga, suspensão, folga, retorno", () => {
    const anuncio = new Date(2026, 7, 31);
    const c = dp.calendarioSuspensao12x36({ anuncio, diasPlantao: 1, anuncioEhPlantao: true });
    const p = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
    expect(p(c.inicio)).toBe("2/9");
    expect(p(c.fim)).toBe("2/9");
    expect(p(c.retorno)).toBe("4/9");
  });
});

describe("escala por CNPJ", () => {
  it("só Queijeiro 3 e 4 são 12x36; o resto é 6x1", () => {
    expect(dp.eh12x36("52.191.264/0001-73")).toBe(true);
    expect(dp.eh12x36("54803962000108")).toBe(true);
    expect(dp.eh12x36("26.786.637/0001-49")).toBe(false);
    expect(dp.eh12x36("35.736.034/0001-23")).toBe(false);
  });
});

describe("data da falta no texto", () => {
  it("entende 'faltou no dia 30'", () => {
    const ds = dp.parseDatasLista("Faltou no dia 30");
    expect(ds).toHaveLength(1);
    expect(ds[0].getDate()).toBe(30);
  });
});

describe("teto de dias no assistente", () => {
  it("aceita só 1, 2 ou 3", () => {
    expect(dp.lerDiasSuspensao("1")).toBe(1);
    expect(dp.lerDiasSuspensao("3 dias")).toBe(3);
    expect(dp.lerDiasSuspensao("4")).toBeNull();
    expect(dp.lerDiasSuspensao("30")).toBeNull();
  });
});

describe("confirmação do resumo", () => {
  it("SIM emite; NÃO sozinho cancela; 'não está correto' é correção", () => {
    expect(dp.ehSimEmitir("sim")).toBe(true);
    expect(dp.ehCancelarEmissao("não")).toBe(true);
    expect(dp.ehCancelarEmissao("não está correto, faltou dia 28")).toBe(false);
    expect(dp.temCorrecao({}, "não está correto, faltou no dia 28")).toBe(true);
    expect(dp.temCorrecao({}, "não está correto")).toBe(false);
  });
});

describe("documento gerado no servidor", () => {
  const base = {
    employeeName: "Maria Souza",
    cpf: "987.654.321-00",
    companyName: "Queijeiro 3 LTDA",
    cnpj: "52.191.264/0001-73",
    data: new Date(2026, 7, 28),
    motivo: "ausência sem justificativa",
  };

  it("gera PDF e DOCX válidos para advertência", async () => {
    const r = await doc.gerarArquivos({ ...base, tipo: "advertencia" });
    expect(r.pdf.slice(0, 4).toString()).toBe("%PDF");
    expect(r.docx.slice(0, 2).toString()).toBe("PK"); // zip do OOXML
    expect(r.nomeBase).toContain("advertencia_maria_souza");
  });

  it("suspensão traz período, retorno e testemunhas", async () => {
    const { blocos } = doc.montarBlocos({ ...base, tipo: "suspensao", suspensionDays: 3 });
    const campos = blocos.filter((b: { t: string }) => b.t === "campo");
    const periodo = campos.find((c: { rot: string }) => c.rot.startsWith("Período"));
    const retorno = campos.find((c: { rot: string }) => c.rot.startsWith("Data de retorno"));
    // 28,29,30 de suspensão → retorna no dia 31.
    expect(periodo.val).toBe("28/08/2026 a 30/08/2026");
    expect(retorno.val).toBe("31/08/2026");
    expect(blocos.some((b: { t: string }) => b.t === "testemunhas")).toBe(true);
  });

  it("advertência também tem testemunhas (recusa de assinatura)", () => {
    const { blocos } = doc.montarBlocos({ ...base, tipo: "advertencia" });
    expect(blocos.some((b: { t: string }) => b.t === "testemunhas")).toBe(true);
  });

  it("capitaliza e pontua o motivo ditado pelo cliente", () => {
    const { blocos } = doc.montarBlocos({ ...base, tipo: "advertencia", motivo: "faltou tres dias" });
    const corpo = blocos.find((b: { t: string; align?: string }) => b.t === "p" && b.align === "just");
    expect(corpo.runs[0].txt.startsWith("Faltou tres dias.")).toBe(true);
  });

  it("respeita o teto de 30 dias do art. 474", () => {
    const { blocos } = doc.montarBlocos({ ...base, tipo: "suspensao", suspensionDays: 99 });
    const total = blocos.find((b: { t: string; rot?: string }) => b.t === "campo" && b.rot?.startsWith("Total"));
    expect(total.val).toContain("30");
  });
});

describe("enquadramento no art. 482 (motivos que não são falta)", () => {
  const base = {
    employeeName: "Fulano",
    cpf: "1",
    companyName: "X",
    cnpj: "1",
    data: new Date(2026, 7, 28),
    motivo: "discussão agressiva com colega na frente de clientes",
  };
  const corpoDe = (d: Record<string, unknown>) => {
    const { blocos } = doc.montarBlocos(d);
    const corpo = blocos.find((b: { t: string; align?: string }) => b.t === "p" && b.align === "just");
    const legal = blocos.find(
      (b: { t: string; runs?: Array<{ txt: string }> }) => b.t === "p" && b.runs?.[0]?.txt === "Base Legal: "
    );
    return { texto: corpo.runs[0].txt, legal: legal.runs.map((r: { txt: string }) => r.txt).join("") };
  };

  it("indisciplina cita a alínea h, não desídia", () => {
    const r = corpoDe({ ...base, tipo: "suspensao", suspensionDays: 2, conduta: "ordem" });
    expect(r.texto).toContain('alínea "h" (ato de indisciplina ou de insubordinação)');
    expect(r.legal).toContain('alínea "h"');
    expect(r.texto).not.toContain("desídia");
  });

  it("mau procedimento cita a alínea b", () => {
    const r = corpoDe({ ...base, tipo: "advertencia", conduta: "conduta" });
    expect(r.texto).toContain('alínea "b" (mau procedimento)');
  });

  it("faltas cita a alínea e (desídia)", () => {
    const r = corpoDe({ ...base, tipo: "advertencia", conduta: "faltas" });
    expect(r.texto).toContain('alínea "e" (desídia');
  });

  it('"outro" mantém o art. 482 genérico, sem enquadrar errado', () => {
    const r = corpoDe({ ...base, tipo: "advertencia", conduta: "outro" });
    expect(r.texto).toContain("artigo 482 da CLT");
    expect(r.texto).not.toContain("alínea");
    expect(r.legal).not.toContain("alínea");
  });

  it("sem conduta informada também fica genérico (nunca assume falta)", () => {
    const r = corpoDe({ ...base, tipo: "suspensao", suspensionDays: 3 });
    expect(r.texto).not.toContain("alínea");
    expect(r.texto).not.toContain("falta");
    expect(r.texto).not.toContain("ausência");
  });
});
