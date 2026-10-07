/**
 * Gera um PDF de amostra em disco para conferência visual (não valida nada além de
 * "o gerador roda sem lançar"). Caminho de saída: CONTRATO_PDF_AMOSTRA (env); sem a
 * variável, o teste só confere que o PDF tem mais de uma página.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { montarContrato, normalizarDados, tituloContrato } from "../lib/contratoModelo";
import { gerarContratoPdf } from "../lib/generateContratoPdf";

describe("gerarContratoPdf", () => {
  it("gera um PDF com várias páginas a partir do modelo", () => {
    const seed = JSON.parse(readFileSync(path.resolve(process.cwd(), "api/src/seeds/contrato-bqrb.json"), "utf8"));
    const d = normalizarDados(seed.dados);
    const blocos = montarContrato(d);
    const pdf = gerarContratoPdf(blocos, {
      titulo: tituloContrato(d),
      rodapeEsquerda: [d.contratada.razao, `CNPJ ${d.contratada.cnpj}`],
      rodapeDireita: [d.contratada.respTecnico, `Contador · ${d.contratada.crcRt}`],
    });
    expect(pdf.getNumberOfPages()).toBeGreaterThan(3);
    // contrato da cliente sai em texto corrido: nenhum [CAMPO] nas partes
    const texto = JSON.stringify(blocos);
    expect(texto).not.toMatch(/\[(CNPJ|RAZÃO|ENDEREÇO|REPRESENTANTE|E-MAIL|REGIME|DIA E HORÁRIO|DATA DA PRIMEIRA)/);
    const out = process.env.CONTRATO_PDF_AMOSTRA;
    if (out) writeFileSync(out, Buffer.from(pdf.output("arraybuffer")));

    // versão MEI, só para conferência visual
    const outMei = process.env.CONTRATO_PDF_AMOSTRA_MEI;
    if (outMei) {
      const m = normalizarDados({ ...seed.dados, objeto: { ...seed.dados.objeto, modelo: "mei", enquadramento: "mei", funcionariosIncluidos: 1 } });
      m.contratante = { ...m.contratante, razao: "MARIA ISABEL QUEIROZ CARO QUINTILIANO 35024716817", tipoSocietario: "", nire: "", repQualificacao: "brasileira, empresária" };
      m.honorarios = { ...m.honorarios, valorMensal: 120 };
      const pm = gerarContratoPdf(montarContrato(m), { titulo: tituloContrato(m), rodapeEsquerda: [m.contratada.razao], rodapeDireita: [m.contratada.respTecnico] });
      writeFileSync(outMei, Buffer.from(pm.output("arraybuffer")));
    }
  });
});
