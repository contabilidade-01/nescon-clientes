import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { maskCNPJ, maskCPF } from "@/lib/masks";
import type { AdmissionDados } from "@/lib/admissionFicha";

type Payload = {
  empresaNome: string;
  empresaCnpj: string;
  contatoEmail?: string | null;
  contatoTelefone?: string | null;
  dados: AdmissionDados;
};

function line(label: string, value: string): string[] {
  return [label, value?.trim() ? value : "—"];
}

function simNao(v: boolean) {
  return v ? "Sim" : "Não";
}

/**
 * Ficha A4 a partir do JSON salvo. Helvetica integrada (mesmo critério do holerite avulso).
 */
export async function downloadAdmissionPdf(p: Payload): Promise<void> {
  const d = p.dados;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("FICHA DE REGISTRO DE FUNCIONÁRIOS", pageW / 2, y, { align: "center" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Nescon Contabilidade — admissão", pageW / 2, y, { align: "center" });
  y += 8;

  const cnpj = maskCNPJ(p.empresaCnpj.replace(/\D/g, ""));
  const sections: Array<{ title: string; rows: string[][] }> = [
    {
      title: "Empresa",
      rows: [
        line("Razão social", p.empresaNome),
        line("CNPJ", cnpj),
        line("E-mail", p.contatoEmail || ""),
        line("Telefone", p.contatoTelefone || ""),
      ],
    },
    {
      title: "Documentos (checklist)",
      rows: [
        line("CTPS digital", simNao(d.docCtps)),
        line("ASO admissional", simNao(d.docAso)),
        line("Cópia do CPF", simNao(d.docCpf)),
        line("Cópia da identidade", simNao(d.docRg)),
        line("Comprovante de residência", simNao(d.docComprovante)),
        line("Cadastro PIS", simNao(d.docPis)),
        line("Foto 3x4", simNao(d.docFoto)),
        line("Reservista (cópia)", simNao(d.docReservistaCopia)),
        line("Certidão civil", simNao(d.docCertidaoCivil)),
        line("CTPS foto e verso", simNao(d.docCopias)),
        line("Possui filhos < 14 ou deficiência", simNao(d.temFilhos)),
        line("Filho deficiente", simNao(d.filhoDeficiente)),
        line("Certidão de nascimento (filhos)", simNao(d.filhoCertidao)),
        line("Cartão de vacina (< 5 anos)", simNao(d.filhoVacina)),
        line("Regularidade escolar (> 7 anos)", simNao(d.filhoEscolaridade)),
      ],
    },
    {
      title: "Dados cadastrais",
      rows: [
        line("Nome", d.nome),
        line("Sexo", d.sexo),
        line("Endereço", d.endereco),
        line("Cidade", d.cidade),
        line("CEP", d.cep),
        line("Nacionalidade", d.nacionalidade),
        line("Data de nascimento", d.nascimento),
        line("Identidade", d.identidade),
        line("Órgão emissor", d.identidadeOrgao),
        line("Local de nascimento", d.localNascimento),
        line("Data de emissão (identidade)", d.identidadeEmissao),
        line("Telefone", d.telefone),
        line("CPF", d.cpf ? maskCPF(d.cpf) : ""),
        line("Carteira de reservista", `${d.reservista}  Cat. ${d.reservistaCategoria}  UF ${d.reservistaUf}`),
        line("CTPS digital", `${d.ctpsNumero}  Série ${d.ctpsSerie}  UF ${d.ctpsUf}  Emissão ${d.ctpsEmissao}`),
        line("PIS/PASEP", d.pis),
        line("Filiação — pai", d.pai),
        line("Filiação — mãe", d.mae),
        line("Estado civil", d.estadoCivil),
        line("Grau de instrução", `${d.grauInstrucao} ${d.grauCompleto}`.trim()),
        line("Cor/raça", d.corRaca),
      ],
    },
    {
      title: "Informações do empregador",
      rows: [
        line("1º emprego", d.primeiroEmprego === "primeiro" ? "Sim" : d.primeiroEmprego === "outro" ? "Já teve outro" : ""),
        line("Data de admissão", d.dataAdmissao),
        line("Salário", d.salario),
        line("Função", d.funcao),
        line("Carga horária mensal", d.cargaMensal),
        line("Carga horária semanal", d.cargaSemanal),
        line("Dia de folga", d.diaFolga),
        line("Contrato de experiência", d.contratoExperiencia),
        line("Vale-transporte", d.valeTransporte === "sim" ? "SIM — 6% do salário base (CLT)" : d.valeTransporte === "nao" ? "NÃO" : ""),
        line("Horário entrada", d.horarioEntrada),
        line("Horário saída", d.horarioSaida),
        line("Intervalo", d.intervalo),
        line("Observação da jornada", d.jornadaObs),
        line("Data do ASO", d.asoData),
      ],
    },
  ];

  type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };
  const d2 = doc as DocWithAutoTable;

  for (const sec of sections) {
    autoTable(doc, {
      startY: y,
      theme: "plain",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 1.2 },
      columnStyles: { 0: { cellWidth: 58, fontStyle: "bold" }, 1: { cellWidth: pageW - margin * 2 - 58 } },
      head: [[{ content: sec.title, colSpan: 2, styles: { fontStyle: "bold", fontSize: 10, fillColor: [240, 240, 240] } }]],
      body: sec.rows,
      margin: { left: margin, right: margin },
    });
    y = (d2.lastAutoTable?.finalY || y) + 4;
  }

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Nescon Contabilidade • CNPJ 35.736.034/0001-23", pageW / 2, pageH - 10, { align: "center" });
  doc.text("Valores e dados informados pelo solicitante — conferência do DP.", pageW / 2, pageH - 6, { align: "center" });

  const safe = (d.nome || "funcionario").replace(/\s+/g, "_").replace(/[^\w\-]/gi, "");
  doc.save(`ficha_admissao_${safe}.pdf`);
}
