export type AdmissionStatus = "novo" | "em_andamento" | "concluido";
export type AdmissionOrigem = "portal" | "publico_cliente" | "publico_externo";

export type AdmissionDados = {
  docLivro: boolean;
  docCtps: boolean;
  docAso: boolean;
  docFoto: boolean;
  docCopias: boolean;
  docCpf: boolean;
  docRg: boolean;
  docComprovante: boolean;
  docTitulo: boolean;
  docCertidaoCivil: boolean;
  docReservistaCopia: boolean;
  docPis: boolean;
  sexo: string;
  temFilhos: boolean;
  filhoDeficiente: boolean;
  filhoCertidao: boolean;
  filhoVacina: boolean;
  filhoEscolaridade: boolean;
  nome: string;
  endereco: string;
  cidade: string;
  cep: string;
  nacionalidade: string;
  nascimento: string;
  identidade: string;
  identidadeOrgao: string;
  /** Local de atendimento (mesmo campo gravado na ficha). */
  identidadeLocal: string;
  identidadeEmissao: string;
  telefone: string;
  cpf: string;
  titulo: string;
  tituloZona: string;
  tituloSecao: string;
  tituloUf: string;
  reservista: string;
  reservistaCategoria: string;
  reservistaUf: string;
  ctpsNumero: string;
  ctpsSerie: string;
  ctpsUf: string;
  ctpsEmissao: string;
  pis: string;
  pai: string;
  mae: string;
  estadoCivil: string;
  conjuge: string;
  grauInstrucao: string;
  grauCompleto: string;
  corRaca: string;
  primeiroEmprego: string;
  dataAdmissao: string;
  salario: string;
  funcao: string;
  cargaMensal: string;
  cargaSemanal: string;
  diaFolga: string;
  contratoExperiencia: string;
  valeTransporte: string;
  horarioEntrada: string;
  horarioSaida: string;
  intervalo: string;
  jornadaObs: string;
  jornadaPreset: string;
  asoData: string;
};

export type AdmissionAnexo = { id: string; file_name: string; created_at: string };

export type AdmissionDetail = {
  id: string;
  company_id: string | null;
  origem: AdmissionOrigem;
  status: AdmissionStatus;
  empresa_cnpj: string;
  empresa_nome: string;
  contato_email: string | null;
  contato_telefone: string | null;
  dados: AdmissionDados;
  created_at: string;
  updated_at: string;
  anexos: AdmissionAnexo[];
  edit_token?: string;
};

export type AdmissionListItem = {
  id: string;
  company_id: string | null;
  origem: AdmissionOrigem;
  status: AdmissionStatus;
  empresa_cnpj: string;
  empresa_nome: string;
  contato_email: string | null;
  contato_telefone: string | null;
  funcionario_nome: string;
  created_at: string;
  updated_at: string;
  anexos_count: number;
};

export function emptyAdmissionDados(): AdmissionDados {
  return {
    docLivro: false,
    docCtps: false,
    docAso: false,
    docFoto: false,
    docCopias: false,
    docCpf: false,
    docRg: false,
    docComprovante: false,
    docTitulo: false,
    docCertidaoCivil: false,
    docReservistaCopia: false,
    docPis: false,
    sexo: "",
    temFilhos: false,
    filhoDeficiente: false,
    filhoCertidao: false,
    filhoVacina: false,
    filhoEscolaridade: false,
    nome: "",
    endereco: "",
    cidade: "",
    cep: "",
    nacionalidade: "Brasileira",
    nascimento: "",
    identidade: "",
    identidadeOrgao: "",
    identidadeLocal: "",
    identidadeEmissao: "",
    telefone: "",
    cpf: "",
    titulo: "",
    tituloZona: "",
    tituloSecao: "",
    tituloUf: "",
    reservista: "",
    reservistaCategoria: "",
    reservistaUf: "",
    ctpsNumero: "",
    ctpsSerie: "",
    ctpsUf: "",
    ctpsEmissao: "",
    pis: "",
    pai: "",
    mae: "",
    estadoCivil: "",
    conjuge: "",
    grauInstrucao: "",
    grauCompleto: "",
    corRaca: "",
    primeiroEmprego: "",
    dataAdmissao: "",
    salario: "",
    funcao: "",
    cargaMensal: "",
    cargaSemanal: "",
    diaFolga: "",
    contratoExperiencia: "90 dias",
    valeTransporte: "",
    horarioEntrada: "",
    horarioSaida: "",
    intervalo: "",
    jornadaObs: "",
    jornadaPreset: "",
    asoData: "",
  };
}

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const OPCOES = {
  nacionalidade: ["Brasileira", "Brasileira naturalizada", "Estrangeira"],
  sexo: ["Masculino", "Feminino", "Não informado"],
  identidadeOrgao: ["SSP", "DETRAN", "IFP", "Polícia Federal", "Cartório", "Outros"],
  estadoCivil: ["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Separado(a)", "Viúvo(a)"],
  corRaca: ["Branca", "Preta", "Parda", "Amarela", "Indígena", "Não informado"],
  grauInstrucao: [
    "Analfabeto",
    "Até o 5º ano incompleto",
    "5º ano completo do ensino fundamental",
    "Do 6º ao 9º ano do fundamental incompleto",
    "Ensino fundamental completo",
    "Ensino médio incompleto",
    "Ensino médio completo",
    "Educação superior incompleta",
    "Educação superior completa",
    "Pós-graduação / mestrado / doutorado",
  ],
  contratoExperiencia: ["30 dias", "45 dias", "90 dias", "Sem contrato de experiência"],
  diaFolga: [
    "Domingo",
    "Sábado",
    "Sábado e domingo",
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "1 dia na semana (escala)",
    "Conforme escala 12x36",
    "Folga variável",
  ],
  intervalo: ["15 minutos", "1 hora", "2 horas", "Sem intervalo"],
  reservistaCategoria: ["1ª categoria", "2ª categoria", "3ª categoria", "Dispensado"],
} as const;

export type JornadaPresetId = "comercial44" | "6x1" | "12x36" | "40h" | "personalizado";

export const JORNADA_PRESETS: Array<{
  id: JornadaPresetId;
  label: string;
  fields: Partial<AdmissionDados>;
}> = [
  {
    id: "comercial44",
    label: "Comercial 44h",
    fields: {
      jornadaPreset: "comercial44",
      cargaMensal: "220",
      cargaSemanal: "44",
      diaFolga: "Domingo",
      horarioEntrada: "08:00",
      horarioSaida: "18:00",
      intervalo: "1 hora",
      jornadaObs: "Segunda a sexta 8h + sábado 4h (44h semanais).",
    },
  },
  {
    id: "6x1",
    label: "44h 6x1",
    fields: {
      jornadaPreset: "6x1",
      cargaMensal: "220",
      cargaSemanal: "44",
      diaFolga: "1 dia na semana (escala)",
      horarioEntrada: "08:00",
      horarioSaida: "17:20",
      intervalo: "1 hora",
      jornadaObs: "Escala 6x1 — 44 horas semanais.",
    },
  },
  {
    id: "12x36",
    label: "12x36",
    fields: {
      jornadaPreset: "12x36",
      cargaMensal: "180",
      cargaSemanal: "36",
      diaFolga: "Conforme escala 12x36",
      horarioEntrada: "07:00",
      horarioSaida: "19:00",
      intervalo: "1 hora",
      jornadaObs: "Jornada 12x36 (12h de trabalho / 36h de descanso).",
    },
  },
  {
    id: "40h",
    label: "40h semanais",
    fields: {
      jornadaPreset: "40h",
      cargaMensal: "200",
      cargaSemanal: "40",
      diaFolga: "Sábado e domingo",
      horarioEntrada: "08:00",
      horarioSaida: "17:00",
      intervalo: "1 hora",
      jornadaObs: "Segunda a sexta, 8h/dia (40h semanais).",
    },
  },
  {
    id: "personalizado",
    label: "Personalizado",
    fields: {
      jornadaPreset: "personalizado",
      cargaMensal: "",
      cargaSemanal: "",
      diaFolga: "",
      horarioEntrada: "",
      horarioSaida: "",
      intervalo: "",
      jornadaObs: "",
    },
  },
];

export const ORIGEM_LABEL: Record<AdmissionOrigem, string> = {
  portal: "Portal (logado)",
  publico_cliente: "Público — cliente",
  publico_externo: "Público — fora da carteira",
};

export const STATUS_LABEL: Record<AdmissionStatus, string> = {
  novo: "Novo",
  em_andamento: "Em andamento",
  concluido: "Concluído",
};

/** Rótulos da ficha — o campo `identidadeLocal` é o local de atendimento. */
export const DADOS_FIELD_LABELS: Record<keyof AdmissionDados, string> = {
  docLivro: "Livro / ficha de registro",
  docCtps: "CTPS",
  docAso: "ASO admissional",
  docFoto: "Foto 3x4",
  docCopias: "CTPS foto e verso (cópia)",
  docCpf: "Cópia do CPF",
  docRg: "Cópia da identidade (RG/CNH)",
  docComprovante: "Comprovante de residência com CEP",
  docTitulo: "Cópia do título de eleitor",
  docCertidaoCivil: "Certidão de casamento ou nascimento",
  docReservistaCopia: "Cópia da carteira de reservista",
  docPis: "Cadastro PIS",
  sexo: "Sexo",
  temFilhos: "Filhos < 14 ou deficiência",
  filhoDeficiente: "Filho com deficiência",
  filhoCertidao: "Certidão de nascimento (filhos)",
  filhoVacina: "Cartão de vacina",
  filhoEscolaridade: "Regularidade escolar",
  nome: "Nome",
  endereco: "Endereço",
  cidade: "Cidade",
  cep: "CEP",
  nacionalidade: "Nacionalidade",
  nascimento: "Data de nascimento",
  identidade: "Identidade",
  identidadeOrgao: "Órgão emissor",
  identidadeLocal: "Local de atendimento",
  identidadeEmissao: "Data de emissão (identidade)",
  telefone: "Telefone",
  cpf: "CPF",
  titulo: "Título de eleitor",
  tituloZona: "Zona",
  tituloSecao: "Seção",
  tituloUf: "UF título",
  reservista: "Carteira de reservista",
  reservistaCategoria: "Categoria reservista",
  reservistaUf: "UF reservista",
  ctpsNumero: "CTPS digital — número",
  ctpsSerie: "Série CTPS",
  ctpsUf: "UF CTPS",
  ctpsEmissao: "Data emissão CTPS",
  pis: "PIS/PASEP",
  pai: "Filiação — pai",
  mae: "Filiação — mãe",
  estadoCivil: "Estado civil",
  conjuge: "Cônjuge",
  grauInstrucao: "Grau de instrução",
  grauCompleto: "Completo / incompleto",
  corRaca: "Cor/raça",
  primeiroEmprego: "1º emprego",
  dataAdmissao: "Data de admissão",
  salario: "Salário",
  funcao: "Função",
  cargaMensal: "Carga horária mensal",
  cargaSemanal: "Carga horária semanal",
  diaFolga: "Dia de folga",
  contratoExperiencia: "Contrato de experiência",
  valeTransporte: "Vale-transporte",
  horarioEntrada: "Horário de entrada",
  horarioSaida: "Horário de saída",
  intervalo: "Intervalo",
  jornadaObs: "Observação da jornada",
  jornadaPreset: "Modelo de jornada",
  asoData: "Data do ASO",
};

export function formatAdmissionField(key: keyof AdmissionDados, dados: AdmissionDados): string {
  const v = dados[key];
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (key === "primeiroEmprego") {
    if (v === "primeiro") return "É 1º emprego";
    if (v === "outro") return "Já teve outro emprego";
  }
  if (key === "valeTransporte") {
    if (v === "sim") return "SIM — 6% do salário base (CLT)";
    if (v === "nao") return "NÃO";
  }
  if (key === "grauCompleto") {
    if (v === "completo") return "Completo";
    if (v === "incompleto") return "Incompleto / cursando";
  }
  const s = String(v || "").trim();
  return s || "—";
}

/** Documentos da nossa listagem que a admissão CLT/eSocial/NR-7 realmente exige. */
export const DOCS_OBRIGATORIOS: Array<{ key: keyof AdmissionDados; label: string }> = [
  { key: "docLivro", label: "Livro ou ficha de registro" },
  { key: "docCtps", label: "CTPS digital" },
  { key: "docAso", label: "ASO admissional" },
  { key: "docCpf", label: "Cópia do CPF" },
  { key: "docRg", label: "Cópia da identidade" },
  { key: "docComprovante", label: "Comprovante de residência com CEP" },
  { key: "docPis", label: "Cadastro do PIS" },
];

export function admissionSaveErrors(dados: AdmissionDados): string | null {
  if (dados.nome.trim().length < 2) return "Informe o nome do funcionário.";
  if (dados.cpf.replace(/\D/g, "").length !== 11) return "CPF do funcionário é obrigatório.";
  if (!dados.nascimento) return "Data de nascimento é obrigatória.";
  if (!dados.identidade.trim()) return "Número da identidade é obrigatório.";
  if (!dados.endereco.trim() || !dados.cidade.trim() || dados.cep.replace(/\D/g, "").length !== 8) {
    return "Endereço, cidade e CEP são obrigatórios.";
  }
  if (!dados.nacionalidade.trim()) return "Nacionalidade é obrigatória.";
  if (!dados.estadoCivil.trim()) return "Estado civil é obrigatório.";
  if (!dados.grauInstrucao.trim()) return "Grau de instrução é obrigatório.";
  if (!dados.corRaca.trim()) return "Declaração de cor/raça é obrigatória (eSocial).";
  if (!dados.dataAdmissao) return "Data de admissão é obrigatória.";
  if (!dados.salario.trim() || !dados.funcao.trim()) return "Salário e função são obrigatórios.";
  if (!dados.asoData) return "Data do ASO (exame admissional) é obrigatória.";
  if (!dados.primeiroEmprego) return "Informe se é o 1º emprego.";
  if (!dados.valeTransporte) return "Informe se haverá desconto de vale-transporte.";
  const faltaDoc = DOCS_OBRIGATORIOS.find((d) => dados[d.key] !== true);
  if (faltaDoc) return `Marque o documento obrigatório: ${faltaDoc.label}.`;
  if (dados.temFilhos && !dados.filhoCertidao) {
    return "Com filhos menores ou com deficiência, a certidão de nascimento é obrigatória.";
  }
  return null;
}

export function mergeAdmissionDados(raw: unknown): AdmissionDados {
  const base = emptyAdmissionDados();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(base) as (keyof AdmissionDados)[]) {
    if (typeof base[key] === "boolean") {
      (base as unknown as Record<string, unknown>)[key] = o[key] === true;
    } else if (typeof o[key] === "string") {
      (base as unknown as Record<string, unknown>)[key] = o[key];
    }
  }
  return base;
}
