/**
 * Regras de domínio das guias do G-Click no portal.
 *
 * O caso que mais importa: retificação. No G-Click ela cria uma atividade NOVA com o
 * mesmo nome — se a identidade fosse o id da atividade, o cliente veria a guia antiga
 * e a corrigida lado a lado.
 */
import { describe, it, expect } from "vitest";
import {
  classificar,
  categoriaDe,
  chaveDocumento,
  extrairGuiasPendentes,
  rangeCompetencia,
  ultimasCompetencias,
} from "../../api/src/gclick/guides.js";

const tarefa = {
  id: "4.10216",
  nome: "FGTS",
  clienteInscricao: "35.736.034/0001-23",
  clienteApelido: "NESCON",
  dataVencimento: "2026-07-20",
  status: "A",
};

const atividade = (over: Record<string, unknown> = {}) => ({
  id: "1",
  nome: "Anexar guia FGTS",
  respondida: true,
  respondidaEm: "2026-07-10 09:00",
  arquivos: [{ nome: "fgts.pdf", url: "https://s3/fgts.pdf" }],
  ...over,
});

describe("classificação de tipos", () => {
  it("reconhece as guias fiscais", () => {
    expect(classificar("FGTS")?.codigo).toBe("FGTS");
    expect(classificar("INSS")?.codigo).toBe("INSS");
    expect(classificar("DAS Simples")?.codigo).toBe("DAS");
  });

  it("reconhece folha e marca que não tem vencimento", () => {
    const recibo = classificar("Anexar recibo de pagamento");
    expect(recibo?.codigo).toBe("RECIBO_PAGTO");
    expect(recibo?.temVencimento).toBe(false);

    // O matcher tem parênteses literais — precisa estar escapado no regex.
    expect(classificar("Anexar Folha de Pagamento (Extrato)")?.codigo).toBe("EXTRATO_FOLHA");
  });

  it("o nome mais específico ganha do genérico", () => {
    // Obrigação "FGTS, DCTF Web" não pode fazer a atividade DCTF virar FGTS.
    expect(classificar("DCTF Web", "FGTS, DCTF Web")?.codigo).toBe("DCTF_WEB");
  });

  it("sem correspondência devolve null e cai em 'outro'", () => {
    expect(classificar("documento qualquer")).toBeNull();
    expect(categoriaDe(undefined)).toBe("outro");
  });

  it("separa guia de folha", () => {
    expect(categoriaDe("FGTS")).toBe("guia");
    expect(categoriaDe("EXTRATO_FOLHA")).toBe("folha");
  });
});

describe("identidade do documento", () => {
  it("não depende do id da atividade e ignora caixa/espaços", () => {
    expect(chaveDocumento("4.1", "Anexar guia FGTS")).toBe(
      chaveDocumento("4.1", "  anexar GUIA fgts  ")
    );
  });

  it("difere entre tarefas", () => {
    expect(chaveDocumento("4.1", "Guia")).not.toBe(chaveDocumento("4.2", "Guia"));
  });
});

describe("versionamento (retificação)", () => {
  it("devolve só a versão mais recente", () => {
    const guias = extrairGuiasPendentes(tarefa, [
      atividade({ id: "1", respondidaEm: "2026-07-10 09:00", arquivos: [{ nome: "v1.pdf", url: "u1" }] }),
      atividade({ id: "2", respondidaEm: "2026-07-15 14:30", arquivos: [{ nome: "v2.pdf", url: "u2" }] }),
    ]);

    expect(guias).toHaveLength(1);
    expect(guias[0].arquivoNome).toBe("v2.pdf");
    expect(guias[0].atividadeId).toBe("2");
    expect(guias[0].ehRetificada).toBe(true);
    expect(guias[0].numVersoes).toBe(2);
  });

  it("a chave da versão retificada é a MESMA da original (atualiza, não duplica)", () => {
    const original = extrairGuiasPendentes(tarefa, [atividade({ id: "1" })]);
    const retificada = extrairGuiasPendentes(tarefa, [
      atividade({ id: "1" }),
      atividade({ id: "2", respondidaEm: "2026-07-15 14:30" }),
    ]);
    expect(retificada[0].chave).toBe(original[0].chave);
    expect(retificada[0].atividadeId).not.toBe(original[0].atividadeId);
  });

  it("documentos diferentes na mesma tarefa continuam separados", () => {
    const guias = extrairGuiasPendentes(tarefa, [
      atividade({ id: "1", nome: "Anexar guia FGTS" }),
      atividade({ id: "2", nome: "Anexar recibo de pagamento" }),
    ]);
    expect(guias).toHaveLength(2);
    expect(new Set(guias.map((g) => g.chave)).size).toBe(2);
  });

  it("ignora atividade sem arquivo ou não respondida", () => {
    const guias = extrairGuiasPendentes(tarefa, [
      atividade({ id: "1", arquivos: [] }),
      atividade({ id: "2", nome: "Outra", respondida: false }),
    ]);
    expect(guias).toHaveLength(0);
  });

  it("normaliza o CNPJ e extrai a competência do vencimento", () => {
    const [g] = extrairGuiasPendentes(tarefa, [atividade()]);
    expect(g.cnpj).toBe("35736034000123");
    expect(g.competencia).toBe("2026-07");
  });

  it("empate no respondidaEm resolve pelo id (determinístico)", () => {
    const guias = extrairGuiasPendentes(tarefa, [
      atividade({ id: "a", respondidaEm: "2026-07-10 09:00", arquivos: [{ nome: "a.pdf", url: "u" }] }),
      atividade({ id: "b", respondidaEm: "2026-07-10 09:00", arquivos: [{ nome: "b.pdf", url: "u" }] }),
    ]);
    expect(guias[0].arquivoNome).toBe("b.pdf");
  });
});

describe("janelas de competência", () => {
  it("cobre o mês inteiro, inclusive fevereiro bissexto", () => {
    expect(rangeCompetencia("2026-07")).toEqual({ inicio: "2026-07-01", fim: "2026-07-31" });
    expect(rangeCompetencia("2026-02")).toEqual({ inicio: "2026-02-01", fim: "2026-02-28" });
    expect(rangeCompetencia("2024-02").fim).toBe("2024-02-29");
  });

  it("lista as competências da mais recente para a mais antiga, virando o ano", () => {
    const comps = ultimasCompetencias(3);
    expect(comps).toHaveLength(3);
    expect(comps.every((c) => /^\d{4}-\d{2}$/.test(c))).toBe(true);
    expect([...comps].sort().reverse()).toEqual(comps);
  });
});
