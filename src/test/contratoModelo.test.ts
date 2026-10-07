/**
 * O texto do contrato é gerado a partir do formulário. Um número errado aqui vira
 * cláusula errada num documento assinado — por isso os cálculos e os trechos que
 * dependem dos dados são testados contra o modelo, não contra a tela.
 */
import { describe, it, expect } from "vitest";
import {
  valorExtenso,
  montarContrato,
  dadosPadrao,
  normalizarDados,
  camposPendentes,
  textoPlano,
  tituloContrato,
  valorSugerido,
  mesclarDados,
  cadastroCompleto,
  type Bloco,
} from "../lib/contratoModelo";

function textoDe(blocos: Bloco[]): string {
  const partes: string[] = [];
  for (const b of blocos) {
    switch (b.t) {
      case "resumo":
        b.itens.forEach((i) => partes.push(i.titulo, i.texto));
        break;
      case "secao":
      case "legenda":
        partes.push(b.t === "secao" ? b.titulo : b.texto);
        break;
      case "subtitulo":
        partes.push(b.titulo, b.sub);
        break;
      case "parte":
      case "par":
      case "data":
        partes.push(b.texto);
        break;
      case "alerta":
        if (b.rotulo) partes.push(b.rotulo);
        partes.push(b.texto);
        break;
      case "clausula":
        partes.push(b.num, b.texto);
        break;
      case "barra":
        partes.push(b.rotulo, b.texto);
        break;
      case "cartoes":
        b.colunas.forEach((c) => partes.push(c.titulo, ...c.itens));
        break;
      case "lista":
        partes.push(...b.itens);
        break;
      case "destaque":
        partes.push(b.titulo, b.valor, ...b.linhas);
        break;
      case "passos":
        b.itens.forEach((i) => partes.push(i.titulo, i.texto));
        break;
      case "escudo":
        b.blocos.forEach((i) => partes.push(i.titulo, i.texto));
        break;
      case "assinaturas":
        b.itens.forEach((i) => partes.push(i.rotulo, i.nome, ...i.linhas));
        break;
      case "kv":
        b.itens.forEach((i) => partes.push(i.rotulo, ...i.linhas));
        break;
      case "quebra":
        break;
    }
  }
  return textoPlano(partes.join("\n"));
}

describe("valorExtenso", () => {
  it("escreve os valores usados nos contratos", () => {
    expect(valorExtenso(550)).toBe("quinhentos e cinquenta reais");
    expect(valorExtenso(1450)).toBe("mil, quatrocentos e cinquenta reais");
    expect(valorExtenso(70)).toBe("setenta reais");
    expect(valorExtenso(183.33)).toBe("cento e oitenta e três reais e trinta e três centavos");
    expect(valorExtenso(1)).toBe("um real");
    expect(valorExtenso(1000)).toBe("mil reais");
    expect(valorExtenso(1100)).toBe("mil e cem reais");
    expect(valorExtenso(2050)).toBe("dois mil e cinquenta reais");
    expect(valorExtenso(150000)).toBe("cento e cinquenta mil reais");
    expect(valorExtenso(0.5)).toBe("cinquenta centavos");
  });
});

describe("montarContrato", () => {
  const base = () => {
    const d = dadosPadrao();
    d.contratante.razao = "BQRB OTICAS LTDA";
    d.contratante.cnpj = "00.000.000/0001-00";
    d.contratante.repNome = "Maria Isabel";
    d.vigencia.dataInicio = "2026-09-04";
    d.honorarios.valorMensal = 550;
    d.honorarios.faturamentoLimite = 150000;
    d.honorarios.valorFuncAdicional = 70;
    d.honorarios.meioPagamento = "boleto bancário ou Pix";
    d.prazos.horarioAtendimento = "das 9h às 18h";
    d.objeto.regimeTributario = "Simples Nacional";
    d.vigencia.foro = "Jundiaí/SP";
    d.honorarios.primeiraCobranca = "2026-10-15";
    return d;
  };

  it("leva os valores do formulário para as cláusulas certas", () => {
    const t = textoDe(montarContrato(base()));
    expect(t).toContain("R$ 550,00 (quinhentos e cinquenta reais)");
    expect(t).toContain("A partir do 4º empregado registrado");
    expect(t).toContain("foro da Comarca de Jundiaí/SP");
    expect(t).toContain("60 dias");
    expect(t).toContain("primeira competência em setembro de 2026");
  });

  it("13º só aparece quando ligado, fixo e em duas parcelas", () => {
    const d = base();
    d.honorarios.decimoTerceiro = false;
    let t = textoDe(montarContrato(d));
    expect(t).not.toContain("13º HONORÁRIO");
    expect(t).toContain("5.3. FATURAMENTO ACIMA DA FAIXA.");

    d.honorarios.decimoTerceiro = true;
    t = textoDe(montarContrato(d));
    expect(t).toContain("5.3. 13º HONORÁRIO.");
    expect(t).toContain("vencimentos em 25/11 e 18/12");
    expect(t).not.toContain("proporcional a 1/12");
    expect(t).not.toContain("ABERTURA DA EMPRESA");
    expect(t).toContain("abertura, alteração ou encerramento de empresas");
    const b13 = montarContrato(d);
    expect(b13.some((b) => b.t === "destaque" && b.titulo.includes("13º"))).toBe(false);
    expect((b13[0] as { t: "resumo"; itens: Array<{ texto: string }> }).itens[1].texto).not.toContain("13º");
  });

  it("retroativo e prazo da folha", () => {
    const d = base();
    let t = textoDe(montarContrato(d));
    expect(t).toContain("até o dia 2 de cada mês");
    expect(t).toContain("50% da mensalidade vigente por competência");
    d.honorarios.retroativoPct = 0;
    d.prazos.diaVariaveisFolha = "3";
    t = textoDe(montarContrato(d));
    expect(t).toContain("até o dia 3 de cada mês");
    expect(t).toContain("conforme orçamento prévio por competência");
    expect(t).toContain("2.3. ACESSOS.");
  });

  it("recálculo de guia: 1º grátis, 2º cobrado por guia", () => {
    const d = base();
    let t = textoDe(montarContrato(d));
    expect(t).toContain("2.2. RECÁLCULO DE GUIAS.");
    expect(t).toContain("R$ 15,00 por guia");
    d.honorarios.recalculoGuiaValor = 20;
    t = textoDe(montarContrato(d));
    expect(t).toContain("R$ 20,00 por guia");
  });

  it("guias prioritariamente por e-mail, com dever de acompanhar o e-mail cadastrado", () => {
    const t = textoDe(montarContrato(base()));
    expect(t).toContain("prioritariamente por e-mail");
    expect(t).toContain("o envio ao e-mail cadastrado vale como entrega");
    expect(t).toContain("Acompanhar o e-mail cadastrado, por onde chegam as guias");
  });

  it("modelo MEI: texto simplificado, sem as cláusulas de ME/EPP", () => {
    const d = base();
    d.objeto.modelo = "mei";
    d.objeto.enquadramento = "mei";
    d.honorarios.valorMensal = 120;
    const t = textoDe(montarContrato(d));
    expect(t).toContain("microempreendedor(a) individual");
    expect(t).toContain("DASN-SIMEI");
    expect(t).toContain("R$ 120,00 (cento e vinte reais)");
    expect(t).toContain("R$ 15,00 por guia");
    expect(t).toContain("Contabilidade especializada em MEI");
    expect(t).toContain("vencimentos em 25/11 e 18/12");
    expect(t).not.toContain("Carta de Responsabilidade");
    expect(t).not.toContain("ECD e ECF");
    expect(tituloContrato(d)).toContain("(MEI)");
  });

  it("valor sugerido: tabela do portal vence a faixa fixa", () => {
    expect(valorSugerido("simples", "servico", "baixa")).toEqual({ valor: 280, origem: "faixa" });
    expect(valorSugerido("simples", "servico", "alta")).toEqual({ valor: 350, origem: "faixa" });
    expect(valorSugerido("simples", "comercio", "baixa")).toEqual({ valor: 350, origem: "faixa" });
    expect(valorSugerido("simples", "comercio", "alta")).toEqual({ valor: 550, origem: "faixa" });
    expect(valorSugerido("mei", "servico", "baixa")).toEqual({ valor: 0, origem: "nenhum" });
    const padroes = [{ enquadramento: "simples", tipo_empresa: "comercio", complexidade: "alta", valor_a_partir_centavos: 60000 }];
    expect(valorSugerido("simples", "comercio", "alta", padroes)).toEqual({ valor: 600, origem: "tabela" });
  });

  it("tom: garantias da contratada vêm antes dos compromissos do cliente, foco em contabilidade especializada", () => {
    const d = base();
    const t = textoDe(montarContrato(d));
    expect(t).toContain("O QUE A CONTRATADA GARANTE");
    expect(t).toContain("CONTABILIDADE ESPECIALIZADA");
    expect(t).not.toContain("ERRO NOSSO");
    expect(t).toContain("3.1. RESPONSABILIDADE.");
    expect(t).toContain("Não há fidelidade mínima");
    expect(t.indexOf("COMPROMISSOS DA CONTRATADA")).toBeLessThan(t.indexOf("COMPROMISSOS DA CONTRATANTE"));
    // a garantia de custear multas por erro próprio continua, só como item da cláusula 3
    const blocos = montarContrato(d);
    expect(blocos.some((b) => b.t === "barra" && b.rotulo === "3.1. RESPONSABILIDADE.")).toBe(true);
    expect(blocos.some((b) => b.t === "alerta" && (b.rotulo || "").startsWith("3.1"))).toBe(false);
  });

  it("faturamento acima da faixa: degrau automático, ou negociação se zerado", () => {
    const d = base();
    let t = textoDe(montarContrato(d));
    expect(t).toContain("R$ 100,00 à mensalidade a cada R$ 50.000,00, ou fração, de faturamento excedente");
    d.honorarios.faixaAdicionalValor = 0;
    t = textoDe(montarContrato(d));
    expect(t).toContain("Não há aumento automático");
  });

  it("13º é fixo no valor-base, com ou sem empregados, em duas parcelas configuráveis", () => {
    const d = base();
    let t = textoDe(montarContrato(d));
    expect(t).toContain("fixo e igual ao valor-base da mensalidade (R$ 550,00");
    expect(t).toContain("com ou sem empregados");
    expect(t.indexOf("Os honorários mensais remuneram toda a rotina")).toBeLessThan(t.indexOf("13º honorário, fixo"));
    d.honorarios.decimoParcela1 = "20/11";
    d.honorarios.decimoParcela2 = "15/12";
    t = textoDe(montarContrato(d));
    expect(t).toContain("vencimentos em 20/11 e 15/12");
  });

  it("regras parametrizáveis entram no texto (prazos, limites e multas)", () => {
    const d = base();
    d.prazos.prazoRespostaDiasUteis = 2;
    d.prazos.transicaoDiasUteis = 15;
    d.prazos.diaDocsFinanceiros = 7;
    d.prazos.balancoDias = 45;
    d.honorarios.retroativoDias = 120;
    d.honorarios.inadimplenciaDias = 15;
    d.vigencia.correcaoDias = 20;
    d.vigencia.multaAvisoMensalidades = 3;
    d.vigencia.multaInfracaoMensalidades = 2;
    const t = textoDe(montarContrato(d));
    expect(t).toContain("em até 2 dias úteis, por e-mail");
    expect(t).toContain("em até 15 dias úteis do término");
    expect(t).toContain("até 7 dias corridos após o fim do mês");
    expect(t).toContain("até 45 dias após o recebimento");
    expect(t).toContain("mais de 120 dias de atraso");
    expect(t).toContain("regularizar em 15 dias");
    expect(t).toContain("prazo de 20 dias corridos para correção");
    expect(t).toContain("limitada a 3 mensalidades");
    expect(t).toContain("multa de 2 mensalidades vigentes");
  });

  it("mesclarDados: padrões e cadastro sobrescrevem só o que trazem", () => {
    const base0 = dadosPadrao();
    const padroes = { contratada: { endereco: "Rua X, 1" }, honorarios: { multaPct: 3, meioPagamento: "" }, vigencia: { avisoPrevioDias: 30 } };
    const m1 = mesclarDados(base0, padroes);
    expect(m1.contratada.endereco).toBe("Rua X, 1");
    expect(m1.contratada.razao).toBe(base0.contratada.razao);
    expect(m1.honorarios.multaPct).toBe(3);
    expect(m1.honorarios.meioPagamento).toBe(base0.honorarios.meioPagamento);
    expect(m1.vigencia.avisoPrevioDias).toBe(30);
    const m2 = mesclarDados(m1, { contratante: { razao: "EMPRESA Y", cnpj: "00.000.000/0001-00" }, honorarios: { valorMensal: 480 } });
    expect(m2.contratante.razao).toBe("EMPRESA Y");
    expect(m2.honorarios.valorMensal).toBe(480);
    expect(m2.honorarios.multaPct).toBe(3);
    expect(mesclarDados(base0, null)).toEqual(base0);
    expect(cadastroCompleto({ contratante: { razao: "A", cnpj: "1", endereco: "r", repNome: "n", repCpf: "c" } })).toBe(true);
    expect(cadastroCompleto({ contratante: { razao: "A" } })).toBe(false);
  });

  it("contratação parcial: só a área fiscal, com aviso do que fica de fora", () => {
    const d = base();
    d.objeto.areaContabil = false;
    d.objeto.areaPessoal = false;
    const blocos = montarContrato(d);
    const t = textoDe(blocos);
    const cartoes = blocos.find((b) => b.t === "cartoes") as { t: "cartoes"; colunas: Array<{ titulo: string }> };
    expect(cartoes.colunas.map((c) => c.titulo)).toEqual(["FISCAL"]);
    expect(t).toContain("ÁREAS NÃO CONTRATADAS.");
    expect(t).toContain("abrange apenas a área fiscal");
    expect(t).toContain("área contábil e de departamento pessoal");
    expect(t).toContain("fora do objeto e da responsabilidade da CONTRATADA");
    expect(t).toContain("basta entrar em contato com a CONTRATADA");
    expect(t).not.toContain("5.2. EMPREGADOS ADICIONAIS.");
    expect(t).toContain("5.2. 13º HONORÁRIO.");
    // pacote completo: nada disso aparece
    const completo = textoDe(montarContrato(base()));
    expect(completo).not.toContain("ÁREAS NÃO CONTRATADAS");
    expect(completo).toContain("5.2. EMPREGADOS ADICIONAIS.");
  });

  it("campo vazio vira [CAMPO] destacado, nunca texto em branco", () => {
    const d = base();
    d.contratada.endereco = "";
    const t = textoDe(montarContrato(d));
    expect(t).toContain("[ENDEREÇO COMPLETO DA CONTRATADA]");
    expect(camposPendentes(d)).toContain("Endereço da contratada");
  });

  it("sem anexo e sem cláusula da proposta; 8.x fecha sem buraco", () => {
    const t = textoDe(montarContrato(base()));
    expect(t).not.toContain("Anexo");
    expect(t).not.toContain("ANEXO");
    expect(t).not.toContain("PROPOSTA.");
    expect(t).toContain("8.2. TOLERÂNCIA E CESSÃO.");
    expect(t).toContain("8.5. FORO.");
    expect(t).toContain("fogem da rotina mensal");
    expect(t).toContain("12 apurações e declarações mensais do Simples Nacional (PGDAS-D)");
    expect(t).not.toContain("proporcional aos dias de vigência");
    expect(t).not.toContain("cobrança proporcional por fração");
    expect(t).toContain("mais de 90 dias de atraso");
    expect(t).toContain("pela variação acumulada do IPCA (IBGE)");
    expect(t).not.toContain("por acordo escrito entre as partes");
  });
});

describe("normalizarDados", () => {
  it("completa chaves ausentes de um JSON antigo sem perder o que existe", () => {
    const d = normalizarDados({ contratante: { razao: "X" }, honorarios: { valorMensal: 900 } });
    expect(d.contratante.razao).toBe("X");
    expect(d.contratante.cnpj).toBe("");
    expect(d.honorarios.valorMensal).toBe(900);
    expect(d.honorarios.vencimentoDia).toBe(15);
    expect(d.vigencia.avisoPrevioDias).toBe(60);
  });
});
