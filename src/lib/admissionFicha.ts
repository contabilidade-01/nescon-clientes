export type AdmissionStatus = "novo" | "em_andamento" | "concluido";
export type AdmissionOrigem = "portal" | "publico_cliente" | "publico_externo";

export type AdmissionDados = {
  docLivro: boolean;
  docCtps: boolean;
  docAso: boolean;
  docFoto: boolean;
  docCopias: boolean;
  docPis: boolean;
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
    docPis: false,
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
      intervalo: "1h",
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
      intervalo: "1h",
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
      intervalo: "1h",
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
      intervalo: "1h",
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
