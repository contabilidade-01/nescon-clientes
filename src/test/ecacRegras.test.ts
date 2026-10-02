/**
 * Cobrança de pendências do e-CAC — regras puras.
 *
 * O que a revisão do plano exigiu que fosse provado sem banco:
 *  - só débito VÁLIDO e EM ATRASO vira cobrança; relatório velho não abre ciclo;
 *  - a máquina de estados: aviso → lembrete → cobrança 1 → cobrança 2 → escalada, com
 *    o desvio "recalculou → regera em N dias úteis" e o fecho "relatório novo sem débito";
 *  - teto de mensagens por canal e de regerações por ciclo;
 *  - as mensagens dizem QUAIS tributos, competências, vencimentos e valores;
 *  - junção por CNPJ com 14 dígitos.
 */
import { describe, it, expect } from "vitest";
import {
  cnpjChave,
  debitosCobraveis,
  debitosAVencer,
  vaiParaCliente,
  totalCobravel,
  espelhoDaEmpresa,
  deveAbrirCobranca,
  decidir,
  montarMensagem,
  somarDiasUteis,
  diasUteisEntre,
  CFG_PADRAO,
} from "../../api/src/ecacRegras.js";

const debitoAtraso = {
  tipo: "SN", receita: "SIMPLES NAC.", periodo_apuracao: "07/2026", periodo_aaaamm: "202607",
  data_vencimento: "2026-08-20", valor_original: 500, saldo_devedor_total: 515.5,
  situacao: "DEVEDOR", em_atraso: true, valido: true, motivos: [], guia: "SN", recalculo_disponivel: true,
};
const debitoAVencer = { ...debitoAtraso, periodo_apuracao: "09/2026", periodo_aaaamm: "202609", data_vencimento: "2026-10-20", saldo_devedor_total: 300, situacao: "A ANALISAR-A VENCER", em_atraso: false };
const fantasma = { ...debitoAtraso, periodo_apuracao: "01/0001", periodo_aaaamm: null, data_vencimento: null, saldo_devedor_total: 0, valido: false, motivos: ["valor zerado"], em_atraso: false };
const inss = { ...debitoAtraso, tipo: "INSS", receita: "1138-01 - CP-SEGURADOS", periodo_apuracao: "06/2026", periodo_aaaamm: "202606", data_vencimento: "2026-07-20", saldo_devedor_total: 1200, guia: "DCTFWEB", recalculo_disponivel: false };

const maed = { ...debitoAtraso, tipo: "MAED", receita: "2203-01 - MAED", periodo_apuracao: "03/2026", periodo_aaaamm: "202603", data_vencimento: "2026-04-30", saldo_devedor_total: 200, guia: "DARF" };

const empresaEcac = {
  cnpj: "11.222.333/0001-81", razao_social: "ALFA", ativo: true,
  relatorio: { id: 41, data_hora: "2026-09-25T03:10:00", situacao: "ATIVA" },
  relatorio_recente: true,
  debitos: [debitoAtraso, debitoAVencer, fantasma, inss],
  omissoes: [], parcelamento: null, pgfn: "Inscrição 80 1 26 000123-45",
};

describe("junção e leitura", () => {
  it("CNPJ vira chave de 14 dígitos; CPF e lixo não", () => {
    expect(cnpjChave("11.222.333/0001-81")).toBe("11222333000181");
    expect(cnpjChave("11222333000181")).toBe("11222333000181");
    expect(cnpjChave("123.456.789-09")).toBeNull();
    expect(cnpjChave("")).toBeNull();
  });

  it("só válido e em atraso é cobrável, ordenado por vencimento", () => {
    const c = debitosCobraveis([debitoAtraso, debitoAVencer, fantasma, inss]);
    expect(c.map((d) => d.periodo_apuracao)).toEqual(["06/2026", "07/2026"]);
    expect(totalCobravel([debitoAtraso, debitoAVencer, fantasma, inss])).toBe(1715.5);
  });

  it("espelho resume a empresa e só abre cobrança com relatório do ciclo", () => {
    const e = espelhoDaEmpresa(empresaEcac)!;
    expect(e.cnpj).toBe("11222333000181");
    expect(e.relatorio_id).toBe(41);
    expect(e.qtd_atraso).toBe(2);
    expect(e.qtd_a_vencer).toBe(1);
    expect(e.qtd_invalidos).toBe(1);
    expect(deveAbrirCobranca(e)).toBe(true);
    expect(deveAbrirCobranca(espelhoDaEmpresa({ ...empresaEcac, relatorio_recente: false }))).toBe(false);
    expect(deveAbrirCobranca(espelhoDaEmpresa({ ...empresaEcac, debitos: [debitoAVencer, fantasma] }))).toBe(false);
    expect(espelhoDaEmpresa({ ...empresaEcac, relatorio: null })).toBeNull();
  });
});

describe("MAED não vai para o cliente", () => {
  it("fica fora dos cobráveis, do total e dos a vencer", () => {
    expect(debitosCobraveis([debitoAtraso, maed]).map((d) => d.tipo)).toEqual(["SN"]);
    expect(totalCobravel([debitoAtraso, maed])).toBe(515.5);
    expect(debitosAVencer([{ ...maed, em_atraso: false }])).toEqual([]);
  });

  it("também quando vem como OUTROS com MAED na receita", () => {
    expect(vaiParaCliente({ ...maed, tipo: "OUTROS" })).toBe(false);
    expect(vaiParaCliente(inss)).toBe(true);
  });

  it("empresa só com MAED em atraso não abre cobrança", () => {
    const e = espelhoDaEmpresa({ ...empresaEcac, debitos: [maed, maed] })!;
    expect(e.qtd_atraso).toBe(0);
    expect(deveAbrirCobranca(e)).toBe(false);
  });

  it("a mensagem não cita a MAED", () => {
    const m = montarMensagem({
      etapa: "notificado",
      empresa: { name: "OJOTA" },
      debitos: [debitoAtraso, maed],
      relatorio_data: "2026-10-02",
      escritorio: { nome: "Nescon" },
    });
    expect(JSON.stringify(m)).not.toMatch(/MAED|Multa por atraso/);
  });
});

describe("dias úteis", () => {
  it("pula fim de semana e feriado nacional", () => {
    expect(somarDiasUteis("2026-09-29", 5)).toBe("2026-10-06");
    expect(somarDiasUteis("2026-04-17", 1)).toBe("2026-04-20"); // sexta → segunda
    expect(somarDiasUteis("2026-04-20", 1)).toBe("2026-04-22"); // 21/04 Tiradentes
    expect(diasUteisEntre("2026-09-25", "2026-09-28")).toBe(1);
  });
});

describe("máquina de estados", () => {
  const base = { estado: "aberta", estado_desde: "2026-09-28", relatorio_id: 41, regeracoes: 0, emails: 0, whatsapps: 0, regeracao_pedida_em: null };
  const atual = { relatorio_id: 41, qtd_atraso: 2 };

  it("aberta → primeiro aviso nos dois canais", () => {
    const d = decidir({ cobranca: base, pendenciaAtual: atual, hoje: "2026-09-28" });
    expect(d).toMatchObject({ acao: "enviar", etapa: "notificado", canais: ["email", "whatsapp"], estado: "notificado" });
  });

  it("notificado: espera N dias úteis, depois lembrete (sem regerar)", () => {
    const cb = { ...base, estado: "notificado", estado_desde: "2026-09-28" };
    expect(decidir({ cobranca: cb, pendenciaAtual: atual, hoje: "2026-10-02" }).acao).toBe("aguardar");
    const d = decidir({ cobranca: cb, pendenciaAtual: atual, hoje: "2026-10-05" });
    expect(d).toMatchObject({ acao: "enviar", etapa: "lembrete", estado: "lembrete" });
  });

  it("recalculou → agenda regeração e espera; regerado sem débito → quitado", () => {
    const cb = { ...base, estado: "notificado", estado_desde: "2026-09-28" };
    const d = decidir({ cobranca: cb, pendenciaAtual: atual, recalculou: true, hoje: "2026-09-30" });
    expect(d).toMatchObject({ acao: "agendar_regeracao", estado: "aguardando_regeracao", dias_uteis: CFG_PADRAO.dias_regeracao });

    const esperando = { ...cb, estado: "aguardando_regeracao", estado_desde: "2026-09-30", regeracao_pedida_em: "2026-09-30", regeracoes: 1 };
    expect(decidir({ cobranca: esperando, pendenciaAtual: atual, hoje: "2026-10-02" }).acao).toBe("aguardar");
    expect(decidir({ cobranca: esperando, pendenciaAtual: atual, hoje: "2026-10-08" }).acao).toBe("consultar");
    // regeração nunca chegou (teto/procuração lá): não fica preso — lembra
    expect(decidir({ cobranca: esperando, pendenciaAtual: atual, hoje: "2026-10-16" })).toMatchObject({ acao: "enviar", etapa: "lembrete" });

    const quitado = decidir({ cobranca: esperando, pendenciaAtual: { relatorio_id: 42, qtd_atraso: 0 }, hoje: "2026-10-08" });
    expect(quitado).toMatchObject({ acao: "enviar", etapa: "quitado", canais: ["email"], estado: "quitado" });
  });

  it("regerado ainda com débito → cobrança 1 por e-mail; depois cobrança 2 por WhatsApp; depois escala", () => {
    const esperando = { ...base, estado: "aguardando_regeracao", estado_desde: "2026-09-30", regeracao_pedida_em: "2026-09-30", regeracoes: 1 };
    const c1 = decidir({ cobranca: esperando, pendenciaAtual: { relatorio_id: 42, qtd_atraso: 1 }, hoje: "2026-10-08" });
    expect(c1).toMatchObject({ acao: "enviar", etapa: "cobranca_1", canais: ["email"], estado: "cobranca_1" });

    const emC1 = { ...base, estado: "cobranca_1", estado_desde: "2026-10-08", relatorio_id: 42, emails: 2, whatsapps: 1 };
    expect(decidir({ cobranca: emC1, pendenciaAtual: { relatorio_id: 42, qtd_atraso: 1 }, hoje: "2026-10-09" }).acao).toBe("aguardar");
    const c2 = decidir({ cobranca: emC1, pendenciaAtual: { relatorio_id: 42, qtd_atraso: 1 }, hoje: "2026-10-14" });
    expect(c2).toMatchObject({ acao: "enviar", etapa: "cobranca_2", canais: ["whatsapp"], estado: "cobranca_2" });

    const emC2 = { ...emC1, estado: "cobranca_2", estado_desde: "2026-10-14", whatsapps: 2 };
    expect(decidir({ cobranca: emC2, pendenciaAtual: { relatorio_id: 42, qtd_atraso: 1 }, hoje: "2026-10-20" })).toMatchObject({ acao: "escalar", estado: "escalado" });
  });

  it("relatório novo sem débito encerra em QUALQUER estado; já cobrando adota o novo relatório", () => {
    for (const estado of ["notificado", "lembrete", "cobranca_1", "cobranca_2"]) {
      const d = decidir({ cobranca: { ...base, estado, estado_desde: "2026-09-28" }, pendenciaAtual: { relatorio_id: 42, qtd_atraso: 0 }, hoje: "2026-10-01" });
      expect(d.estado, estado).toBe("quitado");
    }
    const d = decidir({ cobranca: { ...base, estado: "cobranca_1", estado_desde: "2026-09-28" }, pendenciaAtual: { relatorio_id: 42, qtd_atraso: 1 }, hoje: "2026-10-01" });
    expect(d.acao).toBe("adotar_relatorio");
  });

  it("tetos: limite de regerações e de mensagens por canal", () => {
    const cheio = { ...base, estado: "lembrete", estado_desde: "2026-09-28", regeracoes: CFG_PADRAO.max_regeracoes };
    expect(decidir({ cobranca: cheio, pendenciaAtual: atual, recalculou: true, hoje: "2026-09-30" }).acao).toBe("aguardar");

    const semEmail = { ...base, estado: "notificado", estado_desde: "2026-09-28", emails: CFG_PADRAO.max_msgs_canal };
    const d = decidir({ cobranca: semEmail, pendenciaAtual: atual, hoje: "2026-10-06" });
    expect(d.etapa).toBe("lembrete");
    expect(d.canais).toEqual(["whatsapp"]);
  });

  it("estados terminais não fazem nada", () => {
    for (const estado of ["quitado", "escalado", "encerrado"]) {
      expect(decidir({ cobranca: { ...base, estado }, pendenciaAtual: { relatorio_id: 99, qtd_atraso: 5 }, recalculou: true, hoje: "2026-12-01" }).acao).toBe("nada");
    }
  });
});

describe("mensagens", () => {
  const ctx = {
    empresa: { name: "ALFA COMÉRCIO LTDA" },
    debitos: [debitoAtraso, inss, debitoAVencer, fantasma],
    relatorio_data: "2026-09-25T03:10:00",
    pgfn: "Inscrição 80 1 26 000123-45",
    link: "https://app.exemplo.com/api/ecac/r/abc",
    pixel: "https://app.exemplo.com/api/ecac/abriu/abc.gif",
    escritorio: { nome: "Nescon", whatsapp: "(11) 94862-6605", email: "contato@nescon.com" },
  };

  it("aviso inicial diz quais tributos, competências, vencimentos e valores — e o tom certo", () => {
    const m = montarMensagem({ ...ctx, etapa: "notificado" });
    expect(m.assunto).toContain("2 guias em aberto");
    for (const trecho of ["Simples Nacional", "07/2026", "20/08/2026", "R$ 515,50", "INSS", "06/2026", "R$ 1.200,00", "R$ 1.715,50"]) {
      expect(m.texto).toContain(trecho);
      expect(m.html).toContain(trecho);
    }
    expect(m.texto).not.toContain("competência 09/2026"); // a vencer não entra
    expect(m.texto).not.toContain("01/0001"); // fantasma não entra
    expect(m.texto).toContain("Nosso trabalho é manter a sua empresa em dia");
    expect(m.texto).toContain("Se já pagou, desconsidere");
    expect(m.texto).toContain("Dívida Ativa");
    expect(m.html).toContain('href="https://app.exemplo.com/api/ecac/r/abc"');
    expect(m.html).toContain("abriu/abc.gif");
    expect(m.whatsapp).toContain("R$ 1.715,50");
    expect(m.whatsapp).toContain("Se já pagou");
    expect(m.whatsapp.length).toBeLessThan(600);
  });

  it("lembrete e cobranças têm o canal certo e continuam listando os valores", () => {
    const l = montarMensagem({ ...ctx, etapa: "lembrete" });
    expect(l.texto).toContain("lembrar");
    expect(l.whatsapp).toContain("R$ 1.715,50");

    const c1 = montarMensagem({ ...ctx, etapa: "cobranca_1" });
    expect(c1.texto).toContain("continuam em aberto");
    expect(c1.texto).toContain("parcelamento");
    expect(c1.whatsapp).toBeNull();

    const c2 = montarMensagem({ ...ctx, etapa: "cobranca_2" });
    expect(c2.html).toBeNull();
    expect(c2.whatsapp).toContain("Simples Nacional 07/2026 (R$ 515,50)");
    expect(c2.whatsapp).toContain("dívida ativa");

    const q = montarMensagem({ ...ctx, etapa: "quitado" });
    expect(q.texto).toContain("Boa notícia");
    expect(() => montarMensagem({ ...ctx, etapa: "xyz" })).toThrow();
  });

  it("escapa HTML vindo do relatório", () => {
    const m = montarMensagem({ ...ctx, etapa: "notificado", empresa: { name: "<script>x</script>" } });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });
});
