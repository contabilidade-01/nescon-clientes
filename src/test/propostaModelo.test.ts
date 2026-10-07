/**
 * O valor de cada item e o texto da proposta saem daqui, nunca da IA nem da tela.
 * Se a conta ou o patch do assistente errar, o cliente recebe um número errado.
 */
import { describe, it, expect } from "vitest";
import {
  CATALOGO_PADRAO,
  aplicarPacote,
  aplicarPatch,
  calcularItem,
  catalogoParaAssistente,
  mesclarCatalogo,
  montarProposta,
  normalizarProposta,
  propostaNova,
  totais,
  validadeAte,
  camposPendentesProposta,
  type PropostaDados,
} from "../lib/propostaModelo";
import type { Bloco } from "../lib/contratoModelo";

const cat = CATALOGO_PADRAO;

function textoDe(blocos: Bloco[]): string {
  return JSON.stringify(blocos);
}

function base(): PropostaDados {
  const d = propostaNova(cat);
  d.cliente.nome = "João da Silva MEI";
  d.cabecalho.data = "2026-10-07";
  return d;
}

describe("cálculo dos itens", () => {
  it("valor fechado × quantidade", () => {
    const { dados } = aplicarPatch(base(), { adicionar: [{ codigo: "dasn_atraso", quantidade: 3 }] }, cat);
    const c = calcularItem(dados.itens[0], dados.condicoes);
    expect(c.total).toBe(450);
    expect(c.custo).toContain("R$ 450,00");
    expect(c.pagamento).toBe("À vista, na contratação.");
  });

  it("entrada + saldo (abertura 60/40)", () => {
    const { dados } = aplicarPatch(base(), { adicionar: [{ codigo: "abertura_empresa" }] }, cat);
    const c = calcularItem(dados.itens[0], dados.condicoes);
    expect(c.total).toBe(1200);
    expect(c.entrada).toBe(720);
    expect(c.saldo).toBe(480);
    expect(c.pagamento).toContain("60%");
  });

  it("percentual respeita o mínimo", () => {
    const { dados } = aplicarPatch(base(), { adicionar: [{ codigo: "parc_receita", modo: "percentual", base: 10000, percentual: 5, minimo: 800 }] }, cat);
    expect(calcularItem(dados.itens[0], dados.condicoes).total).toBe(800);
    const { dados: d2 } = aplicarPatch(dados, { alterar: [{ codigo: "parc_receita", base: 30000 }] }, cat);
    expect(calcularItem(d2.itens[0], d2.condicoes).total).toBe(1500);
  });

  it("retroativo = mensalidade × meses", () => {
    const { dados } = aplicarPatch(base(), { adicionar: [{ codigo: "contab_retroativa", quantidade: 8 }] }, cat);
    expect(calcularItem(dados.itens[0], dados.condicoes).total).toBe(2240);
  });

  it("totais separam serviços, repasses e mensal", () => {
    const { dados } = aplicarPatch(
      base(),
      { adicionar: [{ codigo: "dasn_atraso", quantidade: 2 }, { codigo: "certificado_ecpf" }, { codigo: "mensal_mei" }, { codigo: "abertura_empresa" }] },
      cat
    );
    const t = totais(dados);
    expect(t.unico).toBe(300 + 1200);
    expect(t.repasses).toBe(150);
    expect(t.mensal).toBe(100);
    expect(t.naContratacao).toBe(300 + 720 + 150);
    expect(t.saldos).toBe(480);
  });

  it("item desmarcado não entra no total", () => {
    const { dados } = aplicarPatch(base(), { adicionar: [{ codigo: "dasn_atraso" }] }, cat);
    const off = { ...dados, itens: dados.itens.map((i) => ({ ...i, ativo: false })) };
    expect(totais(off).unico).toBe(0);
  });
});

describe("pacotes e automatismos", () => {
  it("pacote traz os itens e não duplica ao reaplicar", () => {
    let d = aplicarPacote(base(), cat, "mei_regularizacao");
    expect(d.itens.map((i) => i.codigo)).toEqual(["dasn_atraso", "recalculo_das_mei", "parc_mei", "mensal_mei"]);
    d = aplicarPacote(d, cat, "mei_regularizacao");
    expect(d.itens).toHaveLength(4);
  });

  it("mensalidade ME/EPP segue a tabela por tipo e complexidade", () => {
    const d0 = base();
    d0.cliente.tipoEmpresa = "comercio";
    d0.cliente.complexidade = "alta";
    const d = aplicarPacote(d0, cat, "mensal_me_epp");
    expect(d.itens[0].valorUnit).toBe(550);
    const { dados } = aplicarPatch(d, { cliente: { tipoEmpresa: "servico", complexidade: "baixa" } }, cat);
    expect(dados.itens[0].valorUnit).toBe(280);
  });

  it("valor editado à mão não é sobrescrito pela tabela", () => {
    let d = aplicarPacote(base(), cat, "mensal_me_epp");
    d = aplicarPatch(d, { alterar: [{ codigo: "mensal_me_epp", valorUnit: 420 }] }, cat).dados;
    d = aplicarPatch(d, { cliente: { complexidade: "alta" } }, cat).dados;
    expect(d.itens[0].valorUnit).toBe(420);
  });

  it("funcionário acima do incluído gera o item adicional e some quando deixa de valer", () => {
    let d = aplicarPacote(base(), cat, "mensal_me_epp");
    d = aplicarPatch(d, { cliente: { funcionarios: 6 } }, cat).dados;
    const extra = d.itens.find((i) => i.codigo === "folha_extra");
    expect(extra?.quantidade).toBe(3);
    expect(totais(d).mensal).toBe(d.itens[0].valorUnit + 3 * 70);
    d = aplicarPatch(d, { cliente: { funcionarios: 2 } }, cat).dados;
    expect(d.itens.some((i) => i.codigo === "folha_extra")).toBe(false);
  });
});

describe("patch do assistente", () => {
  it("ignora serviço fora do catálogo e avisa", () => {
    const { dados, avisos } = aplicarPatch(base(), { adicionar: [{ codigo: "inventado" }], pacotes: ["nao_existe"] }, cat);
    expect(dados.itens).toHaveLength(0);
    expect(avisos).toHaveLength(2);
  });

  it("clampa números e descarta lixo", () => {
    const { dados } = aplicarPatch(
      base(),
      {
        cliente: { funcionarios: -5, enquadramento: "xx" as never, nome: "  Maria  " },
        adicionar: [{ codigo: "dasn_atraso", quantidade: "3" as never, valorUnit: "abc" as never }],
      },
      cat
    );
    expect(dados.cliente.funcionarios).toBe(0);
    expect(dados.cliente.enquadramento).toBe("simples");
    expect(dados.cliente.nome).toBe("Maria");
    expect(dados.itens[0].quantidade).toBe(3);
    expect(dados.itens[0].valorUnit).toBe(150);
  });

  it("remove por código", () => {
    let d = aplicarPacote(base(), cat, "mei_regularizacao");
    d = aplicarPatch(d, { remover: ["mensal_mei"] }, cat).dados;
    expect(d.itens.some((i) => i.codigo === "mensal_mei")).toBe(false);
  });
});

describe("catálogo", () => {
  it("o salvo vale sobre o padrão e itens novos do padrão continuam aparecendo", () => {
    const c = mesclarCatalogo({ itens: [{ ...cat.itens.find((i) => i.codigo === "dasn_atraso")!, valorUnit: 199 }] });
    expect(c.itens.find((i) => i.codigo === "dasn_atraso")!.valorUnit).toBe(199);
    expect(c.itens.length).toBe(cat.itens.length);
    expect(c.pacotes.length).toBe(cat.pacotes.length);
  });

  it("o assistente só recebe itens habilitados", () => {
    const c = mesclarCatalogo({ itens: [{ ...cat.itens[0], habilitado: false }] });
    expect(catalogoParaAssistente(c).itens.some((i) => i.codigo === cat.itens[0].codigo)).toBe(false);
  });
});

describe("texto da proposta", () => {
  it("monta resumo, itens, condições e aceite com os valores certos", () => {
    let d = aplicarPacote(base(), cat, "mei_regularizacao");
    d = aplicarPatch(d, { alterar: [{ codigo: "dasn_atraso", quantidade: 3 }, { codigo: "recalculo_das_mei", quantidade: 10 }] }, cat).dados;
    const txt = textoDe(montarProposta(d));
    expect(txt).toContain("João da Silva MEI");
    expect(txt).toContain("R$ 450,00"); // 3 DASN
    expect(txt).toContain("R$ 200,00"); // 10 recálculos
    expect(txt).toContain("Aceite da proposta");
    expect(txt).toContain("até **06/11/2026**");
  });

  it("o que falta aparece entre colchetes", () => {
    const txt = textoDe(montarProposta(propostaNova(cat)));
    expect(txt).toContain("[CLIENTE]");
    expect(camposPendentesProposta(propostaNova(cat))).toContain("Nome do cliente");
  });

  it("validade soma os dias à data", () => {
    const d = base();
    d.cabecalho.validadeDias = 10;
    expect(validadeAte(d)).toBe("2026-10-17");
  });

  it("normalizar tolera dado salvo antigo", () => {
    const d = normalizarProposta({ cliente: { nome: "X" }, itens: [{ codigo: "dasn_atraso", titulo: "t" }] }, cat);
    expect(d.itens[0].uid).toBeTruthy();
    expect(d.itens[0].quantidade).toBe(1);
    expect(d.condicoes.vencimentoDia).toBe(15);
  });
});
