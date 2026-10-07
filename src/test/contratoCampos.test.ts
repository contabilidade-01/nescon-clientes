/**
 * A IA só devolve um mapa de campos; quem decide o que entra é este módulo. Aditivo e
 * perfil geram texto de documento assinado, então o de/para e a sugestão são testados.
 */
import { describe, it, expect } from "vitest";
import { dadosPadrao, textoPlano, type Bloco, type ContratoDados } from "../lib/contratoModelo";
import {
  CAMPOS,
  aplicarAtualizacoes,
  alteracoesEntre,
  camadasDados,
  camposParaIa,
  diffParcial,
  dadosDoAditivo,
  estadoParaIa,
  montarAditivo,
  normalizarAditivo,
  pendentesAditivo,
  reajustar,
  sugerirPreset,
  validarValor,
  campoDef,
  type AditivoDados,
  type ContratoPreset,
} from "../lib/contratoCampos";

function base(): ContratoDados {
  const d = dadosPadrao();
  d.contratante.razao = "BQRB OTICAS LTDA";
  d.contratante.cnpj = "68.972.725/0001-85";
  d.contratante.endereco = "Rua A, 1, Jundiaí/SP";
  d.contratante.repNome = "MARIA";
  d.contratante.repCpf = "111.111.111-11";
  d.honorarios.valorMensal = 450;
  return d;
}

function textoDe(blocos: Bloco[]): string {
  return blocos
    .map((b) => {
      switch (b.t) {
        case "clausula":
        case "par":
        case "parte":
        case "data":
          return textoPlano(b.texto);
        case "secao":
          return b.titulo;
        case "resumo":
          return b.itens.map((i) => `${i.titulo} ${i.texto}`).join(" ");
        default:
          return "";
      }
    })
    .join("\n");
}

describe("catálogo de campos", () => {
  it("toda chave existe em ContratoDados", () => {
    const d = dadosPadrao() as unknown as Record<string, Record<string, unknown>>;
    for (const c of CAMPOS) {
      const [s, k] = c.chave.split(".");
      expect(d[s], c.chave).toBeDefined();
      expect(k in d[s], c.chave).toBe(true);
    }
  });

  it("a IA não vê nem recebe CPF, endereço, e-mail e telefone", () => {
    const chaves = camposParaIa("contrato").map((c) => c.chave);
    for (const proibido of ["contratante.repCpf", "contratante.endereco", "contratante.email", "contratante.telefone", "contratante.cnpj"]) {
      expect(chaves).not.toContain(proibido);
    }
    expect(Object.keys(estadoParaIa(base(), "contrato"))).not.toContain("contratante.repCpf");
  });

  it("no aditivo a IA só vê campos aditiváveis", () => {
    const chaves = camposParaIa("aditivo").map((c) => c.chave);
    expect(chaves).toContain("honorarios.valorMensal");
    expect(chaves).not.toContain("vigencia.dataInicio");
    expect(chaves).not.toContain("objeto.modelo");
  });
});

describe("validarValor / aplicarAtualizacoes", () => {
  it("rejeita número fora do limite e tipo errado, aceita pt-BR", () => {
    const valor = campoDef("honorarios.valorMensal")!;
    expect(validarValor(valor, 999999).ok).toBe(false);
    expect(validarValor(valor, "abc").ok).toBe(false);
    expect(validarValor(valor, "1.250,50")).toEqual({ ok: true, valor: 1250.5 });
    expect(validarValor(valor, "450.5")).toEqual({ ok: true, valor: 450.5 });
    expect(validarValor(campoDef("honorarios.vencimentoDia")!, 10.5).ok).toBe(false);
    expect(validarValor(campoDef("honorarios.decimoParcela1")!, "25/11").ok).toBe(true);
    expect(validarValor(campoDef("honorarios.decimoParcela1")!, "natal").ok).toBe(false);
    expect(validarValor(campoDef("honorarios.primeiraCobranca")!, "2026-13-45").ok).toBe(false);
  });

  it("aplica o válido, ignora desconhecido/proibido e avisa", () => {
    const r = aplicarAtualizacoes(
      base(),
      {
        "honorarios.valorMensal": 500,
        "honorarios.vencimentoDia": 10,
        "contratante.repCpf": "222.222.222-22",
        "inexistente.campo": 1,
        "honorarios.multaPct": 50,
        "objeto.balancetes": "Mensais",
      },
      "contrato"
    );
    expect(r.dados.honorarios.valorMensal).toBe(500);
    expect(r.dados.honorarios.vencimentoDia).toBe(10);
    expect(r.dados.objeto.balancetes).toBe("mensal");
    expect(r.dados.contratante.repCpf).toBe("111.111.111-11");
    expect(r.dados.honorarios.multaPct).toBe(dadosPadrao().honorarios.multaPct);
    expect(r.aplicadas.map((a) => a.chave).sort()).toEqual(["honorarios.valorMensal", "honorarios.vencimentoDia", "objeto.balancetes"]);
    expect(r.avisos).toHaveLength(3);
  });

  it("não aplica nada com entrada que não é objeto", () => {
    expect(aplicarAtualizacoes(base(), null, "contrato").aplicadas).toHaveLength(0);
    expect(aplicarAtualizacoes(base(), [1, 2], "contrato").aplicadas).toHaveLength(0);
  });
});

describe("perfis", () => {
  const mk = (id: string, ordem: number, criterios: ContratoPreset["criterios"], ativo = true): ContratoPreset => ({
    id,
    nome: id,
    descricao: "",
    criterios,
    dados: {},
    ordem,
    ativo,
  });
  it("escolhe o mais específico que bate e ignora inativo e sem critério", () => {
    const d = base();
    d.objeto.enquadramento = "simples";
    d.objeto.tipoEmpresa = "comercio";
    d.objeto.complexidade = "media";
    const lista = [
      mk("generico", 0, {}),
      mk("simples", 1, { enquadramento: "simples" }),
      mk("comercio-media", 2, { enquadramento: "simples", tipoEmpresa: "comercio", complexidade: "media" }),
      mk("servico", 3, { tipoEmpresa: "servico" }),
      mk("inativo", 0, { enquadramento: "simples", tipoEmpresa: "comercio", complexidade: "media" }, false),
    ];
    expect(sugerirPreset(lista, d.objeto)?.id).toBe("comercio-media");
    expect(sugerirPreset([mk("generico", 0, {})], d.objeto)).toBeNull();
    expect(sugerirPreset([], d.objeto)).toBeNull();
  });

  it("camadas: cadastro vale mais que o perfil, mas zero do cadastro não apaga o valor do perfil", () => {
    const preset = mk("p", 0, { enquadramento: "simples" });
    preset.dados = { objeto: { tipoEmpresa: "comercio", complexidade: "media" }, honorarios: { valorMensal: 450, vencimentoDia: 10 } };
    const cadastro = {
      objeto: { tipoEmpresa: "servico" as const },
      honorarios: { valorMensal: 0, vencimentoDia: 20, faturamentoLimite: 80000 },
      contratante: { razao: "ACME" },
    };
    const d = camadasDados(dadosPadrao(), { padroes: { honorarios: { multaPct: 3 } }, preset, cadastro });
    expect(d.honorarios.valorMensal).toBe(450);
    expect(d.honorarios.vencimentoDia).toBe(20);
    expect(d.honorarios.faturamentoLimite).toBe(80000);
    expect(d.honorarios.multaPct).toBe(3);
    expect(d.objeto.tipoEmpresa).toBe("comercio");
    expect(d.contratante.razao).toBe("ACME");
    // Sem perfil escolhido, a classificação do cadastro vale.
    expect(camadasDados(dadosPadrao(), { cadastro }).objeto.tipoEmpresa).toBe("servico");
  });

  it("diffParcial guarda só o que mudou, inclusive texto esvaziado", () => {
    const a = base();
    const b = { ...a, honorarios: { ...a.honorarios, valorMensal: 600 }, contratante: { ...a.contratante, email: "" } };
    a.contratante.email = "x@y.com";
    expect(diffParcial(a, b)).toEqual({ honorarios: { valorMensal: 600 }, contratante: { email: "" } });
    expect(diffParcial(a, b, ["honorarios"])).toEqual({ honorarios: { valorMensal: 600 } });
  });
});

describe("aditivo", () => {
  function aditivo(mut: (d: ContratoDados) => ContratoDados, extra: Partial<AditivoDados> = {}): AditivoDados {
    const b = base();
    return normalizarAditivo({
      numero: 1,
      paiId: "p1",
      paiTitulo: "Contrato X",
      paiAssinadoEm: "2026-03-10T12:00:00Z",
      base: b,
      novo: diffParcial(b, mut(b)),
      efeito: "2027-01-01",
      motivo: "",
      ...extra,
    });
  }

  it("reajuste de 10% gera de/para com valor por extenso e ratificação", () => {
    const ad = aditivo((d) => reajustar(d, 10));
    expect(dadosDoAditivo(ad).honorarios.valorMensal).toBe(495);
    const t = textoDe(montarAditivo(ad));
    expect(t).toContain("Honorário mensal: passa de R$ 450,00 (quatrocentos e cinquenta reais) para R$ 495,00 (quatrocentos e noventa e cinco reais)");
    expect(t).toContain("a partir de 1 de janeiro de 2027");
    expect(t).toContain("Permanecem inalteradas e ratificadas todas as demais cláusulas");
    expect(t).toContain("assinado em 10 de março de 2026");
    expect(t).not.toMatch(/\[[A-ZÀ-Ú ]+\]/);
  });

  it("só lista o que mudou e ignora campos não aditiváveis", () => {
    const ad = aditivo((d) => {
      const x = reajustar(d, 0);
      return { ...x, honorarios: { ...x.honorarios, vencimentoDia: 5 }, vigencia: { ...x.vigencia, foro: "Outra/SP" } };
    });
    const alts = alteracoesEntre(ad.base, dadosDoAditivo(ad));
    expect(alts.map((a) => a.def.chave)).toEqual(["honorarios.vencimentoDia"]);
    const t = textoDe(montarAditivo(ad));
    expect(t).toContain("Dia de vencimento da mensalidade: passa de dia 15 para dia 5");
    expect(t).not.toContain("Outra/SP");
  });

  it("13º vira cobrado/não cobrado e sem alteração aparece como pendência", () => {
    const ad = aditivo((d) => ({ ...d, honorarios: { ...d.honorarios, decimoTerceiro: false } }));
    expect(textoDe(montarAditivo(ad))).toContain("13º honorário: passa de cobrado para não cobrado");
    const vazio = aditivo((d) => d, { efeito: "" });
    expect(pendentesAditivo(vazio)).toEqual(["Nenhuma alteração feita", "Data de início da alteração"]);
    expect(textoDe(montarAditivo(vazio))).toContain("[NENHUMA ALTERAÇÃO INFORMADA]");
  });

  it("reajuste dos extras só quando pedido", () => {
    const d = base();
    d.honorarios.valorFuncAdicional = 40;
    expect(reajustar(d, 10).honorarios.valorFuncAdicional).toBe(40);
    expect(reajustar(d, 10, { extras: true }).honorarios.valorFuncAdicional).toBe(44);
  });

  it("campo esvaziado no aditivo é preservado", () => {
    const b = base();
    b.contratante.email = "a@b.com";
    const ad = normalizarAditivo({ numero: 1, base: b, novo: diffParcial(b, { ...b, contratante: { ...b.contratante, email: "" } }) });
    expect(dadosDoAditivo(ad).contratante.email).toBe("");
  });
});
