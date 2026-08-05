/**
 * Regras do alerta: o que se marca sozinho, o que é só sugestão, e o texto que chega
 * no WhatsApp do cliente.
 *
 * A fronteira entre automática e sugerida é o ponto sensível: marcar sozinho um tributo
 * que a empresa não recolhe faz o cliente receber cobrança de algo que não deve, e o
 * canal inteiro perde credibilidade.
 */
import { describe, it, expect } from "vitest";
import {
  decidirAutomaticas,
  sugerirPorEntregas,
  textoDaEvidencia,
  montarMensagemAlerta,
} from "../../api/src/alertasRegras.js";

const codigos = (lista: { codigo: string }[]) => lista.map((x) => x.codigo).sort();

describe("decidirAutomaticas", () => {
  it("com funcionário: FGTS, INSS da DCTF Web e o prazo do salário", () => {
    const r = decidirAutomaticas({ temFuncionario: true });
    expect(codigos(r)).toEqual(["FGTS", "INSS_DCTFWEB", "SALARIO"]);
  });

  it("só pró-labore: INSS sim, FGTS e salário não", () => {
    const r = decidirAutomaticas({ temFuncionario: false, temProLabore: true });
    expect(codigos(r)).toEqual(["INSS_DCTFWEB"]);
  });

  it("DAS no portal marca o Simples", () => {
    const r = decidirAutomaticas({ temDasNoPortal: true });
    expect(codigos(r)).toEqual(["DAS"]);
  });

  it("empresa sem folha e sem DAS não recebe marcação nenhuma", () => {
    expect(decidirAutomaticas({})).toEqual([]);
  });

  it("o motivo acompanha a marcação, para a tela explicar o que ninguém clicou", () => {
    const [primeira] = decidirAutomaticas({ temFuncionario: true });
    expect(primeira.motivo).toMatch(/funcionário/);
  });

  it("pró-labore e funcionário juntos: o motivo cita o funcionário", () => {
    const r = decidirAutomaticas({ temFuncionario: true, temProLabore: true });
    const inss = r.find((x: { codigo: string }) => x.codigo === "INSS_DCTFWEB");
    expect(inss?.motivo).toMatch(/funcionário/);
  });
});

describe("sugerirPorEntregas", () => {
  const entregas = [
    { doc_type: "ICMS", title: "ICMS Comércio", competencia: "2026-06" },
    { doc_type: "ICMS", title: "ICMS Comércio", competencia: "2026-07" },
    { doc_type: "ISS", title: "ISS Uberlândia", competencia: "2026-07" },
  ];

  it("sugere o que aparece nas guias, com quantas vezes e a última competência", () => {
    const r = sugerirPorEntregas(entregas, []);
    expect(codigos(r)).toEqual(["ICMS", "ISS_UBERLANDIA"]);
    const icms = r.find((x: { codigo: string }) => x.codigo === "ICMS");
    expect(icms.ocorrencias).toBe(2);
    expect(icms.ultima_competencia).toBe("2026-07");
  });

  it("não sugere o que já foi decidido — nem o que foi recusado", () => {
    const r = sugerirPorEntregas(entregas, ["ICMS"]);
    expect(codigos(r)).toEqual(["ISS_UBERLANDIA"]);
  });

  it("não sugere o que a regra já marca sozinha", () => {
    const r = sugerirPorEntregas([{ doc_type: "FGTS", title: "FGTS", competencia: "2026-07" }], []);
    expect(r).toEqual([]);
  });

  it("reconhece pelo título quando o G-Click não classifica o tipo", () => {
    const r = sugerirPorEntregas([{ doc_type: null, title: "DARF COFINS 2172", competencia: "2026-07" }], []);
    expect(codigos(r)).toEqual(["COFINS"]);
  });

  it("ordena pelo que aparece mais — o mais provável primeiro", () => {
    const r = sugerirPorEntregas(entregas, []);
    expect(r[0].codigo).toBe("ICMS");
  });

  it("evidência legível para a tela", () => {
    const r = sugerirPorEntregas(entregas, []);
    expect(textoDaEvidencia(r[0])).toBe("2 guias encontradas no portal, a última em 2026-07.");
  });
});

describe("montarMensagemAlerta", () => {
  const base = {
    empresaNome: "RESTAURANTE DO QUEIJEIRO",
    hoje: "2026-08-19",
    portalUrl: "https://portal.exemplo.br/",
  };

  it("junta tudo do mesmo dia numa mensagem só", () => {
    const texto = montarMensagemAlerta({
      ...base,
      itens: [
        { codigo: "FGTS", nome: "FGTS", vencimento: "2026-08-20", observacao: null, temGuiaNoPortal: true },
        { codigo: "DAS", nome: "Simples Nacional (DAS)", vencimento: "2026-08-20", observacao: null, temGuiaNoPortal: true },
      ],
    })!;
    expect(texto).toContain("Vence amanhã (20/08)");
    expect(texto).toContain("• FGTS");
    expect(texto).toContain("• Simples Nacional (DAS)");
    // Uma mensagem, não duas: o link aparece uma vez só.
    expect(texto.match(/portal\.exemplo/g)).toHaveLength(1);
  });

  it("diz 'hoje' quando o vencimento é no próprio dia", () => {
    const texto = montarMensagemAlerta({
      ...base,
      hoje: "2026-12-05",
      itens: [
        {
          codigo: "SALARIO",
          nome: "Salário — limite de pagamento",
          vencimento: "2026-12-05",
          observacao: "O 5º dia útil cai num sábado: o salário tem de ser pago em dinheiro, porque não há compensação bancária.",
          temGuiaNoPortal: false,
        },
      ],
    })!;
    expect(texto).toContain("Vence hoje (05/12)");
    expect(texto).toContain("⚠️");
    expect(texto).toContain("dinheiro");
  });

  it("sem guia no portal, não manda o cliente ao portal à toa", () => {
    const texto = montarMensagemAlerta({
      ...base,
      itens: [
        { codigo: "SALARIO", nome: "Salário", vencimento: "2026-08-19", observacao: null, temGuiaNoPortal: false },
      ],
    })!;
    expect(texto).not.toContain("portal.exemplo");
  });

  it("o incentivo entra por último, depois de tudo que interessa", () => {
    const texto = montarMensagemAlerta({
      ...base,
      itens: [
        { codigo: "FGTS", nome: "FGTS", vencimento: "2026-08-20", observacao: null, temGuiaNoPortal: true },
      ],
      incentivo: "Sabia que dá para ver as férias de cada funcionário no portal?",
    })!;
    const linhas = texto.split("\n").filter(Boolean);
    expect(linhas[linhas.length - 1]).toMatch(/Sabia que/);
    expect(texto.indexOf("FGTS")).toBeLessThan(texto.indexOf("Sabia que"));
  });

  it("sem incentivo a mensagem termina no assunto dela", () => {
    const texto = montarMensagemAlerta({
      ...base,
      itens: [
        { codigo: "FGTS", nome: "FGTS", vencimento: "2026-08-20", observacao: null, temGuiaNoPortal: true },
      ],
    })!;
    expect(texto.trim().endsWith("https://portal.exemplo.br/")).toBe(true);
  });

  it("datas diferentes viram lista com a data em cada linha", () => {
    const texto = montarMensagemAlerta({
      ...base,
      itens: [
        { codigo: "FGTS", nome: "FGTS", vencimento: "2026-08-20", observacao: null, temGuiaNoPortal: true },
        { codigo: "COFINS", nome: "COFINS", vencimento: "2026-08-25", observacao: null, temGuiaNoPortal: false },
      ],
    })!;
    expect(texto).toContain("Vencimentos próximos");
    expect(texto).toContain("• FGTS — 20/08");
    expect(texto).toContain("• COFINS — 25/08");
  });

  it("sem itens não existe mensagem", () => {
    expect(montarMensagemAlerta({ ...base, itens: [] })).toBeNull();
  });
});
