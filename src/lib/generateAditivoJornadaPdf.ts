import { jsPDF } from "jspdf";

/**
 * Termo aditivo ao contrato de trabalho para a mudança de jornada da EC 141/2026.
 *
 * Gerado no navegador (jsPDF, como os outros PDFs). É um modelo: o Departamento Pessoal
 * revisa antes da assinatura, e a alteração também é lançada na folha (eSocial S-2206).
 * Cláusulas: nova jornada a partir da data, manutenção do salário (a emenda proíbe
 * redução), fundamento (art. 468 da CLT: alteração por mútuo consentimento e sem
 * prejuízo) e permanência das demais cláusulas.
 */
export type AditivoJornadaDados = {
  empresaNome: string;
  empresaCnpj: string;
  funcionarioNome: string;
  funcionarioCpf: string;
  /** Jornada anterior em texto livre ("44h semanais, 6x1"); opcional. */
  jornadaAnterior?: string;
  inicio: string; // YYYY-MM-DD
  cargaSemanal: string; // "40"
  escala: string; // "5x2"
  folga: string;
  entrada: string;
  saida: string;
  intervalo: string; // "1 hora"
  cidade: string;
  dataAssinatura: string; // YYYY-MM-DD
  /** Ampliação diária por acordo/convenção (42h em 5 dias, art. 7º da EC). */
  comAcordo?: boolean;
};

const dataBR = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "___/___/______");
const cnpjFmt = (v: string) =>
  v.replace(/\D/g, "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const cpfFmt = (v: string) => v.replace(/\D/g, "").replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

/** Cláusulas em texto, separadas do desenho do PDF para dar para testar. */
export function clausulasAditivo(d: AditivoJornadaDados): Array<{ titulo: string; texto: string }> {
  const carga = d.cargaSemanal.replace(".", ",");
  const horario = d.entrada && d.saida ? `das ${d.entrada} às ${d.saida}, com intervalo de ${d.intervalo || "1 hora"} para refeição e descanso` : "conforme escala";
  const escalaTxt = d.escala === "12x36" ? "em regime de 12 horas de trabalho por 36 horas de descanso" : `em escala ${d.escala}`;
  return [
    {
      titulo: "CLÁUSULA PRIMEIRA – DA NOVA JORNADA",
      texto:
        `A partir de ${dataBR(d.inicio)}, a jornada de trabalho do(a) EMPREGADO(A) passa a ser de ${carga} (${carga}) horas semanais, ` +
        `${escalaTxt}, ${horario}, com folga em: ${d.folga || "conforme escala"}` +
        (d.jornadaAnterior ? `, em substituição à jornada anterior (${d.jornadaAnterior}).` : "."),
    },
    {
      titulo: "CLÁUSULA SEGUNDA – DO FUNDAMENTO",
      texto:
        "A alteração adequa o contrato à Emenda Constitucional nº 141/2026, que reduziu a duração do trabalho normal e " +
        "assegurou dois repousos semanais remunerados, e é feita por mútuo consentimento, sem prejuízo ao(à) EMPREGADO(A), " +
        "nos termos do art. 468 da Consolidação das Leis do Trabalho." +
        (d.comAcordo
          ? " A distribuição da jornada observa o acordo ou a convenção coletiva aplicável, que autoriza a ampliação da jornada diária."
          : ""),
    },
    {
      titulo: "CLÁUSULA TERCEIRA – DO SALÁRIO",
      texto:
        "A redução da jornada não implica redução do salário. O(A) EMPREGADO(A) mantém a remuneração mensal que recebe " +
        "na data deste termo, com os reajustes previstos em lei e em norma coletiva.",
    },
    {
      titulo: "CLÁUSULA QUARTA – DAS DEMAIS CONDIÇÕES",
      texto: "Permanecem inalteradas as demais cláusulas e condições do contrato de trabalho que não conflitem com este termo.",
    },
  ];
}

export function gerarAditivoJornadaPdf(d: AditivoJornadaDados): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margem = 20;
  const largura = 210 - margem * 2;
  let y = 22;

  const paragrafo = (txt: string, opts: { negrito?: boolean; tamanho?: number; centro?: boolean; espaco?: number } = {}) => {
    doc.setFont("helvetica", opts.negrito ? "bold" : "normal");
    doc.setFontSize(opts.tamanho ?? 10.5);
    const linhas = doc.splitTextToSize(txt, largura) as string[];
    for (const l of linhas) {
      if (y > 275) {
        doc.addPage();
        y = 22;
      }
      doc.text(l, opts.centro ? 105 : margem, y, opts.centro ? { align: "center" } : undefined);
      y += (opts.tamanho ?? 10.5) * 0.48;
    }
    y += opts.espaco ?? 3;
  };

  paragrafo("TERMO ADITIVO AO CONTRATO DE TRABALHO", { negrito: true, tamanho: 13, centro: true, espaco: 1 });
  paragrafo("Alteração de jornada de trabalho", { tamanho: 10.5, centro: true, espaco: 6 });

  paragrafo(
    `EMPREGADOR: ${d.empresaNome.toUpperCase()}, inscrito no CNPJ sob o nº ${cnpjFmt(d.empresaCnpj)}.`,
    { espaco: 1.5 },
  );
  paragrafo(`EMPREGADO(A): ${d.funcionarioNome.toUpperCase()}, inscrito(a) no CPF sob o nº ${cpfFmt(d.funcionarioCpf)}.`, {
    espaco: 4,
  });
  paragrafo(
    "As partes acima identificadas resolvem, de comum acordo, aditar o contrato de trabalho entre elas mantido, nas condições a seguir.",
    { espaco: 4 },
  );

  for (const c of clausulasAditivo(d)) {
    paragrafo(c.titulo, { negrito: true, espaco: 1 });
    paragrafo(c.texto, { espaco: 4 });
  }

  paragrafo("E, por estarem de acordo, assinam o presente termo em duas vias de igual teor.", { espaco: 6 });
  paragrafo(`${d.cidade || "________________"}, ${dataBR(d.dataAssinatura)}.`, { espaco: 18 });

  if (y > 240) {
    doc.addPage();
    y = 40;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.line(margem, y, margem + 75, y);
  doc.line(115, y, 190, y);
  doc.text("EMPREGADOR", margem + 37.5, y + 5, { align: "center" });
  doc.text("EMPREGADO(A)", 152.5, y + 5, { align: "center" });
  doc.setFontSize(8.5);
  doc.text(d.empresaNome.toUpperCase().slice(0, 45), margem + 37.5, y + 9.5, { align: "center" });
  doc.text(d.funcionarioNome.toUpperCase().slice(0, 45), 152.5, y + 9.5, { align: "center" });

  return doc;
}

export function baixarAditivoJornadaPdf(d: AditivoJornadaDados) {
  const slug = d.funcionarioNome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();
  gerarAditivoJornadaPdf(d).save(`aditivo_jornada_${slug}_${d.inicio}.pdf`);
}
