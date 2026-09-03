import type { CompanyToolAccess } from "@/lib/companyTools";
import type { AdminAreaAccess } from "@/lib/adminAreas";

const rawApiBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || "/api";
const API_BASE = rawApiBase.replace(/\/+$/, "") || "/api";

function normalizeResponseText(text: string): string {
  return text.replace(/^\uFEFF/, "").trimStart();
}

/** JSON válido nunca começa por '<' após trim; HTML/XML quase sempre sim. */
function isProbablyHtmlBody(text: string, contentType: string): boolean {
  if (/text\/html/i.test(contentType)) return true;
  const t = normalizeResponseText(text);
  return t.startsWith("<");
}

/**
 * Evita "Unexpected token '<'" quando o host devolve index.html (SPA) em vez da API.
 * Comum em produção só com front: sem VITE_API_URL o browser pede /api no mesmo domínio e recebe HTML.
 */
async function parseResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const ct = res.headers.get("content-type") || "";
  const hint = import.meta.env.VITE_API_URL
    ? " Confirme se VITE_API_URL está correto e se a API está acessível."
    : " Defina VITE_API_URL no build (URL público da API Node, terminando em /api, ex.: https://api.seudominio.com/api) ou use um proxy que encaminhe /api para o backend.";

  if (isProbablyHtmlBody(text, ct)) {
    throw new Error(`A API não respondeu em JSON (foi recebido HTML).${hint}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    const head = normalizeResponseText(text).slice(0, 120).toLowerCase();
    if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<")) {
      throw new Error(`A API não respondeu em JSON (foi recebido HTML).${hint}`);
    }
    const msg = e instanceof Error ? e.message : "";
    if (/unexpected token.*</i.test(msg) || /not valid json/i.test(msg)) {
      throw new Error(`Resposta não é JSON válido.${hint}`);
    }
    throw new Error(normalizeResponseText(text).slice(0, 200) || "Resposta inválida do servidor.");
  }
}

/** Rotas públicas (login, recuperação de senha): sem Bearer e sem redirecionar em 401 */
async function publicRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await parseResponseJson<unknown>(res);
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return data as T;
}

function getToken(): string | null {
  try {
    const session = localStorage.getItem("company_session");
    if (!session) return null;
    const parsed = JSON.parse(session);
    return parsed.token || null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await parseResponseJson<unknown>(res);

  if (res.status === 401) {
    // Token expired - clear session and redirect to login
    localStorage.removeItem("company_session");
    window.location.href = "/login";
    throw new Error("Sessão expirada");
  }

  // A API passou a barrar quem está com a senha inicial (= CNPJ, que é público) em
  // TODAS as rotas, não só na tela. Se o usuário chegar aqui com esse estado, é porque
  // contornou a navegação — manda para a troca em vez de mostrar erro solto.
  if (res.status === 403 && (data as { code?: string })?.code === "MUST_CHANGE_PASSWORD") {
    if (window.location.pathname !== "/alterar-senha") window.location.href = "/alterar-senha";
    throw new Error("Troque a senha inicial antes de usar o sistema.");
  }

  // Modo manutenção: o servidor barra o cliente com 503 + code MAINTENANCE (o admin nunca
  // recebe isto). Guarda a mensagem e leva para a tela de manutenção.
  if (res.status === 503 && (data as { code?: string })?.code === "MAINTENANCE") {
    const msg = (data as { error?: string })?.error || "Portal em manutenção.";
    try {
      localStorage.setItem("maintenance_message", msg);
    } catch {
      /* localStorage indisponível: a página de manutenção usa o texto padrão */
    }
    if (window.location.pathname !== "/manutencao") window.location.href = "/manutencao";
    throw new Error(msg);
  }

  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return data as T;
}

/** Busca binária autenticada: `<a href>` não envia o Bearer, então o arquivo vem por fetch. */
async function requestBlob(path: string): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (res.status === 401) {
    localStorage.removeItem("company_session");
    window.location.href = "/login";
    throw new Error("Sessão expirada");
  }
  if (!res.ok) {
    throw new Error(res.status === 404 ? "Documento não encontrado" : `HTTP ${res.status}`);
  }
  return res.blob();
}

export type DeliverableCategory = "guia" | "boleto" | "folha" | "outro";
export type DeliverableStatus = "pending" | "paid";

export type Deliverable = {
  id: string;
  company_id: string;
  category: DeliverableCategory;
  doc_type: string | null;
  title: string;
  competencia: string | null;
  due_date: string | null;
  file_name: string;
  status: DeliverableStatus;
  paid_at: string | null;
  source: "gclick" | "manual" | "cora";
  /** Carga histórica: arquivo para consulta, nunca conta a pagar. */
  historico?: boolean;
  /** URL pública do PDF (ex: boletos Cora sem arquivo local). */
  pdf_url?: string | null;
  created_at: string;
};

export type PublicDeliverable = {
  category: DeliverableCategory;
  doc_type: string | null;
  title: string;
  competencia: string | null;
  due_date: string | null;
  status: DeliverableStatus;
  file_name: string;
  company_name: string;
};

export type LicenseType = "funcionamento" | "avcb_clcb" | "sanitaria";
/** Estado é sempre calculado a partir do vencimento — nunca vem gravado. */
export type LicenseStatus = "ativa" | "a_vencer" | "vencida" | "ausente";

/** Uma empresa × um tipo de licença: a licença vigente e o estado de hoje. */
export type LicenseItem = {
  company_id: string;
  name: string;
  cnpj: string;
  tipo: LicenseType;
  license_id: string | null;
  numero: string | null;
  orgao: string | null;
  emitida_em: string | null;
  vence_em: string | null;
  observacao: string | null;
  status: LicenseStatus;
  dias_restantes: number | null;
};

export type LicenseOverview = {
  dias_aviso: number;
  estabelecidas: number;
  nao_estabelecidas: number;
  por_status: Record<LicenseStatus, number>;
  por_tipo: Array<{ tipo: LicenseType } & Record<LicenseStatus, number>>;
};

export type CompanyWithLicenses = {
  id: string;
  name: string;
  cnpj: string;
  established: boolean;
  licencas: Array<{
    id: string;
    tipo: LicenseType;
    numero: string | null;
    orgao: string | null;
    emitida_em: string | null;
    vence_em: string;
    observacao: string | null;
    status: LicenseStatus;
  }>;
};

export type LicenseInput = {
  company_id: string;
  tipo: LicenseType;
  numero?: string | null;
  orgao?: string | null;
  emitida_em?: string | null;
  vence_em: string;
  observacao?: string | null;
};

export type AnnualTaxStatus = "pendente" | "enviado" | "confirmado";

export type AnnualTaxRow = {
  company_id: string;
  name: string;
  cnpj: string;
  status: AnnualTaxStatus;
  enviado_em: string | null;
  confirmado_em: string | null;
  observacao: string | null;
  atualizado_em: string | null;
};


export type GclickDecisao = "pendente" | "aceito" | "rejeitado";

/** Alerta aberto na fila: cliente novo (decisão) ou mudança de status (ciência). */
export type GclickPendencia = {
  id: string;
  cnpj: string;
  tipo: "novo_cliente" | "status_alterado";
  dados: {
    nome?: string | null;
    email?: string | null;
    phone?: string | null;
    status?: string | null;
    de?: string | null;
    para?: string | null;
  };
  criado_em: string;
  nome: string | null;
  status_gclick: string | null;
  decisao: GclickDecisao | null;
  company_id: string | null;
  /** Cadastro que a sincronização já criou sozinha, se houver. */
  empresa_existente_id: string | null;
  empresa_existente_nome: string | null;
};

export type GclickCliente = {
  cnpj: string;
  nome: string | null;
  email: string | null;
  phone: string | null;
  status_gclick: string | null;
  decisao: GclickDecisao;
  company_id: string | null;
  decidido_em: string | null;
  motivo_rejeicao: string | null;
  primeiro_visto_em: string;
  atualizado_em: string;
  empresa_existente_id: string | null;
  empresa_existente_nome: string | null;
};


export type VacationPeriod = {
  id: string;
  codigo: string | null;
  nome: string;
  admissao: string | null;
  ferias_vencidas: number;
  inicio_aquisitivo: string | null;
  fim_aquisitivo: string | null;
  inicio_gozo: string | null;
  limite_gozo: string | null;
  dias_acumulados: string | number;
  dias_gozados: string | number;
  /** Dias a que tem direito — vem pronto do relatório, não recalculamos. */
  dias_direito: string | number;
  dias_afastamento: number;
  faltas: number;
  ordem: number;
};

export type VacationUpload = {
  id: string;
  data_base: string | null;
  emissao: string | null;
  arquivo_nome: string | null;
  total_empregados: number | null;
  total_declarado: number | null;
  source: string;
  criado_em: string;
};


export type VacationSituacao = "vencida" | "a_vencer" | "ok" | "sem_limite";

export type VacationCusto = { bruto: number; umTerco: number; fgts: number; total: number };

/** Um funcionário × período aquisitivo, já com custo e alerta calculados no servidor. */
export type VacationItem = {
  id: string;
  codigo: string | null;
  nome: string;
  admissao: string | null;
  inicio_aquisitivo: string | null;
  fim_aquisitivo: string | null;
  inicio_gozo: string | null;
  limite_gozo: string | null;
  limite_seguranca: string | null;
  situacao: VacationSituacao;
  dias_direito: number;
  dias_gozados: number;
  dias_acumulados: number;
  dias_a_pagar: number;
  faltas: number;
  alerta_faltas: {
    faltasAtuais: number;
    diasAtuais: number;
    faltasRestantes: number;
    diasDepois: number;
    perde: number;
  } | null;
  dias_pela_tabela: number;
  salario_base: number | null;
  salario_competencia: string | null;
  origem_salario: "individual" | "media_folha" | null;
  /** Nulo quando não há salário conhecido — a tela mostra em branco, nunca R$ 0,00. */
  custo: VacationCusto | null;
};

export type VacationResumo = {
  funcionarios: number;
  periodos: number;
  vencidas: number;
  a_vencer: number;
  em_risco_faltas: number;
  custo: VacationCusto & { semSalario: number };
};

export type VacationCalendarItem = {
  data: string;
  limite_oficial: string;
  nome: string;
  dias: number;
  situacao: VacationSituacao;
};

export type LgpdTermo = {
  versao: string;
  titulo: string;
  paragrafos: string[];
  checkbox: string;
};

export type LgpdState = {
  consent_at: string | null;
  prompt_seen_at: string | null;
  versao: string | null;
};

/** Mesma forma das permissões do cliente — fonte única em companyTools, evita as duas listas divergirem. */
export type CompanyToolAccessApi = CompanyToolAccess;

export type AdminUser = {
  id: string;
  cpf: string;
  nome: string | null;
  areas: AdminAreaAccess;
  is_owner: boolean;
  active: boolean;
  must_change_password: boolean;
  contact_email: string | null;
  created_at: string;
};

export type MonthlyFollowKind = {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo_tipo: string;
  prazo_n: number | null;
  default_assignee_id: string | null;
  default_assignee_nome?: string | null;
  ordem: number;
  ativo: boolean;
};

export type MonthlyFollowTask = {
  id: string;
  kind_id: string;
  titulo: string;
  descricao: string | null;
  competencia: string;
  due_date: string;
  assigned_admin_id: string | null;
  assigned_nome: string | null;
  status: string;
  status_efetivo: string;
  notes: string;
  completed_at: string | null;
  updated_at: string;
};

export type MeiCredential = {
  id: string;
  company_id: string | null;
  nome: string;
  cnpj: string | null;
  portal: string | null;
  login: string | null;
  tem_senha: boolean;
  observacao: string | null;
  assigned_admin_id: string | null;
  assigned_nome: string | null;
  ativo: boolean;
  updated_at: string;
};

export type LoginResponse =
  | {
      token: string;
      role: "admin";
      admin: {
        id: string;
        cpf: string;
        nome?: string | null;
        is_owner?: boolean;
        areas?: AdminAreaAccess;
        must_change_password?: boolean;
      };
    }
  | {
      token: string;
      role: "company";
      company: {
        id: string;
        name: string;
        cnpj: string;
        tool_access?: CompanyToolAccessApi;
        must_change_password?: boolean;
      };
    };

/** Uma obrigação do catálogo, com o vencimento do mês já calculado pelo servidor. */
export interface AlertObligation {
  codigo: string;
  nome: string;
  esfera: "federal" | "estadual" | "municipal" | "trabalhista";
  regra: string;
  automatica: boolean;
  avisar_dias_antes: number;
  vencimento_no_mes: string | null;
  observacao: string | null;
}

export interface AlertObligationCatalog {
  referencia: string;
  obrigacoes: AlertObligation[];
}

export interface AlertCompanyRow {
  id: string;
  name: string;
  cnpj: string;
  /** Efetivo: o manual quando existe, senão o do espelho do G-Click. */
  whatsapp: string | null;
  whatsapp_manual: string | null;
  whatsapp_gclick: string | null;
  alertas_ativos: boolean;
  incentivo_ativo: boolean;
  /** Subchaves abaixo da geral (`alertas_ativos`). Ver AlertCompanyDetail. */
  avisos_gerais_ativos: boolean;
  boleto_lembrete_ativo: boolean;
  boleto_cobranca_ativo: boolean;
  /** Escolha DO CLIENTE. O painel mostra; quem desfaz é ele, no portal dele. */
  avisos_documentos_ativos: boolean;
  avisos_alterados_em: string | null;
  ferias_dispensadas: number;
  marcadas: number;
  ultimo_alerta_em: string | null;
}

export interface AlertOverview {
  total: number;
  sem_marcacao: number;
  sem_whatsapp: number;
  desligadas: number;
  /** Quantos clientes PEDIRAM para não receber aviso de documento novo. */
  recusaram_documentos: number;
  empresas: AlertCompanyRow[];
}

/** Sugestão: o portal achou guia dessa obrigação, mas quem marca é o admin. */
export interface AlertSuggestion {
  codigo: string;
  nome: string;
  esfera: string;
  ocorrencias: number;
  ultima_competencia: string | null;
  exemplo: string | null;
  evidencia: string;
}

export interface AlertCompanyDetail {
  empresa: {
    id: string;
    name: string;
    cnpj: string;
    whatsapp: string | null;
    whatsapp_manual: string | null;
    whatsapp_gclick: string | null;
    alertas_ativos: boolean;
    incentivo_ativo: boolean;
    /**
     * Subchaves do envio, abaixo da chave geral (`alertas_ativos`, que corta tudo):
     *  - avisos_gerais_ativos    → tributos, guias e férias
     *  - boleto_lembrete_ativo   → boleto: aviso de VENCIMENTO (véspera)
     *  - boleto_cobranca_ativo   → boleto: aviso de VENCIDO (marcos de cobrança)
     *  - honorario_cobranca_ativo → honorário: régua própria de cobrança (2 fases)
     */
    avisos_gerais_ativos: boolean;
    boleto_lembrete_ativo: boolean;
    boleto_cobranca_ativo: boolean;
    honorario_cobranca_ativo: boolean;
    avisos_documentos_ativos: boolean;
    avisos_alterados_em: string | null;
  };
  obrigacoes: Array<{
    codigo: string;
    nome: string;
    esfera: string;
    avisar_dias_antes: number;
    marcada: boolean;
    decidida: boolean;
    origem: "auto" | "manual" | null;
    observacao: string | null;
    sugerida: boolean;
  }>;
  sugestoes: AlertSuggestion[];
}

export interface AlertPreview {
  data: string;
  total: number;
  mensagens: Array<{
    company_id: string;
    empresa: string;
    cnpj: string;
    whatsapp: string | null;
    dia_alerta: string;
    vencimento: string;
    obrigacoes: string[];
    incentivo_id: string | null;
    texto: string;
  }>;
}

/** Escolhas do cliente sobre o que ele quer receber. */
export interface ClientNotificationPrefs {
  avisos_documentos_ativos: boolean;
  avisos_alterados_em: string | null;
  /** Avisos de férias já dispensados, por funcionário e limite. */
  ferias_dispensadas: Array<{ codigo: string | null; funcionario: string; limite_gozo: string; criado_em: string }>;
}

/** Uma competência no painel de folha. Valores vêm do Postgres como string. */
export interface FolhaSerieItem {
  competencia: string;
  folha_bruta: string | null;
  inss: string | null;
  fgts: string | null;
  afastamento_valor: string | null;
  afastamento_dias: string | null;
  faltas_dias: string | null;
  empregados: number | null;
  admitidos: number | null;
  demitidos: number | null;
  empresas: number;
  nao_conferidos: number;
  turnover: number | null;
}

export interface FolhaProblemas {
  total: number;
  /** Agrupado: 60 linhas com a mesma causa são UM problema, não sessenta. */
  motivos: Array<{
    /** Categoria: sem_texto | nao_e_extrato | extrato_parcial | formato_diferente */
    causa: string;
    motivo: string;
    quantas: number;
    /** Explicação + amostra de como o PDF veio, para diagnosticar sem abrir o arquivo. */
    exemplo: string | null;
  }>;
  itens: Array<{
    empresa: string;
    competencia: string;
    problemas: string | null;
    proventos: string | null;
    descontos: string | null;
    liquido: string | null;
  }>;
}

export interface DecimoTerceiroLinha {
  nome: string;
  /** 'YYYY-MM-DD', ou null quando a admissão não é conhecida (assume ano inteiro). */
  admissao: string | null;
  /** Avos no ano (0 a 12) — 12 = ano inteiro. Menos que isso costuma ser admissão no
   * meio do ano; se não bater com a data real do funcionário, é sinal de cadastro
   * desatualizado, não da fórmula. */
  avos: number;
  bruto: number | null;
  primeira_parcela?: number;
  inss_empregado?: number;
  segunda_parcela?: number;
  fgts?: number;
  /** Sem salário na folha mais recente: entrou na conta do "sem_salario", não no bruto. */
  sem_salario: boolean;
}

export interface DecimoTerceiro {
  ano: number;
  funcionarios: number;
  /** Quantos ficaram de fora por não ter salário na folha mais recente. */
  sem_salario: number;
  bruto: number;
  primeira_parcela: number;
  segunda_parcela: number;
  inss_empregado: number;
  fgts: number;
  custo_total: number;
  /** Detalhamento por funcionário — a mesma soma acima, aberta pessoa a pessoa. */
  linhas: DecimoTerceiroLinha[];
}

export interface BackupConfig {
  ativo: boolean;
  hora: number;
  email: string;
  whatsapp: string;
  /** BACKUP_SENHA no ambiente. Sem ela não dá para cifrar, então não dá para ligar. */
  senha_configurada: boolean;
  smtp_configurado: boolean;
}

export interface BackupResult {
  ok: boolean;
  erro?: string;
  problemas?: string[];
  nome?: string;
  tamanho?: string;
  linhas?: Record<string, number | null>;
  segundos?: number;
  entregas?: { email: string | null; whatsapp: string | null };
}

export interface DocUploadCompany {
  id: string;
  name: string;
  cnpj: string;
}

export interface DocUploadFile {
  filename: string;
  storedName: string;
  cnpjs: string[];
  empresa: DocUploadCompany | null;
  /** Todas as empresas cujo CNPJ apareceu no PDF, na ordem de aparição. */
  candidatas: DocUploadCompany[];
  /** 'texto' = parser determinístico, 'ia' = fallback, 'nao_encontrado' = ninguém achou. */
  origem: "texto" | "ia" | "nao_encontrado";
  observacao: string | null;
}

export interface DocUploadAnalysis {
  ia_ligada: boolean;
  arquivos: DocUploadFile[];
}

export interface DocUploadConfirmItem {
  storedName: string;
  company_id: string;
  title?: string;
  doc_type?: string;
  /** Nome que o cliente vê ao baixar — não o nome interno do arquivo. */
  originalName?: string;
}

export interface DocUploadAiState {
  habilitada: boolean;
  configurada: boolean;
  modelo?: string;
}

/** Guia retida com vencimento próximo — o alerta do escritório, não do cliente. */
export interface AlertHeldGuides {
  referencia: string;
  dias: number;
  total: number;
  vence_amanha: number;
  itens: Array<{
    id: string;
    company_id: string;
    empresa: string;
    doc_type: string | null;
    title: string;
    competencia: string | null;
    due_date: string;
  }>;
}

/** Um cliente na tela de Controle de acessos. */
export interface AcessoCliente {
  id: string;
  name: string;
  cnpj: string;
  ultimo_acesso: string | null;
  num_logins: number;
  views: number;
  downloads: number;
  nunca_acessou: boolean;
  ultimos_acessos: Array<{ em: string; ip: string | null }>;
  top_ferramentas: Array<{ ferramenta: string; usos: number }>;
}

export interface AcessosData {
  dias: number;
  totais: { total: number; acessaram: number; nunca_acessaram: number; ativos_30d: number };
  ranking: Array<{ ferramenta: string; usos: number }>;
  documentos: { visualizados: number; baixados: number };
  clientes: AcessoCliente[];
}

/** Configuração operacional — no banco, não no ambiente. */
export interface AlertOpConfig {
  envio_automatico: boolean;
  hora: number;
  escritorio_cnpj: string;
  /** WhatsApp do escritório para avisos internos (fila esgotou tentativas). Vazio = só no Dashboard. */
  escritorio_whatsapp: string;
  /** Antecedência do lembrete do boleto Cora, em dias (0 = sem véspera). */
  boleto_dias_antes: number;
  /** Marcos de cobrança do boleto vencido, em dias após o vencimento (ex.: [3,10,30]; vazio = desligado). */
  boleto_cobranca_dias: number[];
}

export interface AlertWhatsappStatus {
  ok: boolean;
  categoria: "ok" | "nao_configurado" | "token_invalido" | "desconectado" | "rede";
  mensagem: string;
  owner?: string | null;
}

export interface AlertSendResult {
  simulado?: boolean;
  dia: string;
  enviados: number;
  falhas: number;
  ignorados: number;
  selecionados?: number | null;
  erro?: string;
  resultados: Array<{
    empresa?: string;
    company_id?: string;
    /** sairia = ensaio; enviado/falhou/ignorado/adiado/interrompido = execução real */
    status: "sairia" | "enviado" | "falhou" | "ignorado" | "adiado" | "interrompido";
    motivo?: string;
    numero?: string;
    texto?: string;
  }>;
}

export interface AlertDashboard {
  periodo: string;
  resumo: {
    total_falhas: number;
    por_tipo: Array<{ tipo: string; total: number }>;
    empresas_afetadas: number;
    envios_24h: number;
  };
  detalhe: Array<{
    company_id: string | null;
    empresa: string | null;
    motivo: string;
    tipo: string;
    ultima_vez: string;
    vezes: number;
  }>;
}

export interface AlertProjecaoFerias {
  periodos: number;
  total: number;
  avisos: Array<{
    dia: string;
    dia_formatado: string;
    company_id: string;
    empresa: string | null;
    funcionario: string;
    marco_dias: number | null;
    limite_gozo: string;
    dias_restantes: number | null;
  }>;
}

export const api = {
  auth: {
    login: (login: string, password: string) =>
      publicRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password }),
      }),
    forgotPassword: (login: string, email: string) =>
      publicRequest<{ message: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ login, email }),
      }),
    checkResetToken: (token: string) =>
      publicRequest<{ valid: boolean }>(`/auth/reset-token?token=${encodeURIComponent(token)}`),
    /** Estado do modo manutenção — público, para a tela de login e a página de manutenção. */
    maintenance: () =>
      publicRequest<{ ativo: boolean; mensagem: string }>("/auth/maintenance"),
    resetPassword: (token: string, password: string) =>
      publicRequest<{ message: string }>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      }),
    /** Trocar a senha estando logado (não depende de e-mail). */
    changePassword: (current_password: string, new_password: string) =>
      request<{ message: string }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password, new_password }),
      }),
    /** Estando logado, pedir o link de redefinição para o e-mail já cadastrado. */
    sendResetLink: () =>
      request<{ message: string }>("/auth/send-reset-link", { method: "POST" }),
    /** Sessão de empresa: devolve tool_access atual (após admin alterar permissões). Requer Bearer. */
    companySession: () =>
      request<{
        company: { id: string; name: string; cnpj: string };
        tool_access: CompanyToolAccessApi;
        /** Falso quando a empresa só tem pró-labore: a seção Férias não aparece. */
        tem_funcionarios?: boolean;
        lgpd?: LgpdState;
      }>("/auth/company-session"),
  },

  /** Consentimento LGPD do cliente (texto servido pela API — fonte única). */
  lgpd: {
    termo: () => publicRequest<LgpdTermo>("/auth/lgpd-termo"),
    concordar: () =>
      request<{ ok: boolean; consent_at: string; versao: string }>("/auth/lgpd-consent", {
        method: "POST",
      }),
    /** Fechou sem aceitar: o aviso não volta a aparecer e o admin vê "visto". */
    marcarVisto: () => request<{ ok: boolean }>("/auth/lgpd-visto", { method: "POST" }),
  },

  /** Clientes vindos do G-Click: espelho, alertas e decisão do escritório. */
  gclickClientes: {
    pendencias: () =>
      request<{
        total: number;
        novos_count: number;
        mudancas_count: number;
        novos: GclickPendencia[];
        mudancas: GclickPendencia[];
      }>("/gclick-clientes/pendencias"),
    listar: (opts?: { decisao?: GclickDecisao; status?: string; q?: string }) => {
      const params = new URLSearchParams();
      if (opts?.decisao) params.set("decisao", opts.decisao);
      if (opts?.status) params.set("status", opts.status);
      if (opts?.q) params.set("q", opts.q);
      const q = params.toString();
      return request<GclickCliente[]>(`/gclick-clientes${q ? `?${q}` : ""}`);
    },
    aceitar: (cnpj: string) =>
      request<{ ok: boolean; company_id: string; criada: boolean; message: string }>(
        `/gclick-clientes/${cnpj}/aceitar`,
        { method: "POST" }
      ),
    rejeitar: (cnpj: string, motivo?: string | null) =>
      request<{ ok: boolean; empresa_existente: boolean; message: string }>(
        `/gclick-clientes/${cnpj}/rejeitar`,
        { method: "POST", body: JSON.stringify({ motivo: motivo || null }) }
      ),
    reconsiderar: (cnpj: string) =>
      request<{ ok: boolean; message: string }>(`/gclick-clientes/${cnpj}/reconsiderar`, {
        method: "POST",
      }),
    ciente: (id: string) =>
      request<{ ok: boolean }>(`/gclick-clientes/pendencias/${id}/ciente`, { method: "POST" }),
    /** Atualiza só o espelho de clientes (rápido — não baixa documentos). */
    sincronizar: () =>
      request<{ clientes: number; novos: number; atualizados: number; alertas: number }>(
        "/admin/sync-gclick/clientes",
        { method: "POST" }
      ),
  },

  /** Férias do cliente: previsão, custo e limite de faltas. */
  ferias: {
    listar: () =>
      request<{
        upload: VacationUpload | null;
        periodos: VacationItem[];
        resumo: VacationResumo | null;
      }>("/ferias"),
    calendario: () => request<VacationCalendarItem[]>("/ferias/calendario"),
  },

  /** Licenças (funcionamento, AVCB/CLCB, vigilância sanitária). Só admin. */
  licencas: {
    overview: () => request<LicenseOverview>("/licencas/overview"),
    itens: (opts?: { status?: LicenseStatus; tipo?: LicenseType; companyId?: string; q?: string }) => {
      const params = new URLSearchParams();
      if (opts?.status) params.set("status", opts.status);
      if (opts?.tipo) params.set("tipo", opts.tipo);
      if (opts?.companyId) params.set("company_id", opts.companyId);
      if (opts?.q) params.set("q", opts.q);
      const q = params.toString();
      return request<LicenseItem[]>(`/licencas/itens${q ? `?${q}` : ""}`);
    },
    empresas: () => request<CompanyWithLicenses[]>("/licencas/empresas"),
    criar: (data: LicenseInput) =>
      request<{ id: string }>("/licencas", { method: "POST", body: JSON.stringify(data) }),
    atualizar: (id: string, data: Omit<LicenseInput, "company_id" | "tipo">) =>
      request<{ id: string }>(`/licencas/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    apagar: (id: string) => request<{ ok: boolean }>(`/licencas/${id}`, { method: "DELETE" }),
    marcarEstabelecida: (companyId: string, established: boolean) =>
      request<{ id: string; established: boolean }>(`/licencas/empresas/${companyId}/estabelecida`, {
        method: "PATCH",
        body: JSON.stringify({ established }),
      }),
  },

  /**
   * Painel de folha. A MESMA rota serve o escritório e o cliente: sem `companyId` o
   * admin vê a carteira somada; o cliente sempre vê a própria empresa.
   */
  folha: {
    serie: (opts?: { companyId?: string; de?: string; ate?: string }) => {
      const p = new URLSearchParams();
      if (opts?.companyId) p.set("company_id", opts.companyId);
      if (opts?.de) p.set("de", opts.de);
      if (opts?.ate) p.set("ate", opts.ate);
      const q = p.toString();
      return request<FolhaSerieItem[]>(`/folha/serie${q ? `?${q}` : ""}`);
    },
    decimoTerceiro: (opts?: { companyId?: string; ano?: number }) => {
      const p = new URLSearchParams();
      if (opts?.companyId) p.set("company_id", opts.companyId);
      if (opts?.ano) p.set("ano", String(opts.ano));
      const q = p.toString();
      return request<DecimoTerceiro>(`/folha/decimo-terceiro${q ? `?${q}` : ""}`);
    },
    /** As competências que não fecharam, agrupadas por motivo. */
    problemas: (companyId?: string) =>
      request<FolhaProblemas>(`/folha/problemas${companyId ? `?company_id=${companyId}` : ""}`),
    reprocessar: (desde?: string) =>
      request<{ extratos: number; gravados: number; com_problema: number }>("/folha/reprocessar", {
        method: "POST",
        body: JSON.stringify({ desde }),
      }),
  },

  /**
   * Preferências de aviso — do CLIENTE, no portal dele.
   * O alerta de vencimento de guia não está aqui de propósito: desligar sozinho o
   * aviso do que se paga com juros seria prejuízo silencioso.
   */
  preferencias: {
    ler: (companyId?: string) =>
      request<ClientNotificationPrefs>(
        `/preferencias${companyId ? `?company_id=${companyId}` : ""}`
      ),
    salvar: (avisosDocumentosAtivos: boolean) =>
      request<{ avisos_documentos_ativos: boolean; avisos_alterados_em: string | null }>(
        "/preferencias",
        { method: "PUT", body: JSON.stringify({ avisos_documentos_ativos: avisosDocumentosAtivos }) }
      ),
    /** "Já recebi este aviso de férias" — vale por CÓDIGO do funcionário e limite. */
    feriasVisto: (codigo: string, limiteGozo: string, funcionario: string) =>
      request<{ dispensado: boolean }>("/preferencias/ferias-visto", {
        method: "POST",
        body: JSON.stringify({ codigo, funcionario, limite_gozo: limiteGozo }),
      }),
    desfazerFeriasVisto: (codigo: string, limiteGozo: string) =>
      request<{ dispensado: boolean }>("/preferencias/ferias-visto", {
        method: "DELETE",
        body: JSON.stringify({ codigo, limite_gozo: limiteGozo }),
      }),
  },

  /**
   * Upload de documentos avulsos com reconhecimento de CNPJ.
   *
   * `analisar` envia FormData, então não passa pelo `request()` — mas usa a MESMA base
   * e o MESMO token. Montar a chamada à mão com `fetch("/api/...")` quebra em produção,
   * onde o front é servido separado da API (ver o comentário de `parseResponseJson`).
   */
  docUpload: {
    analisar: async (files: File[]) => {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/doc-upload/analisar`, {
        method: "POST",
        body: form,
        headers,
      });
      const data = await parseResponseJson<unknown>(res);
      if (res.status === 401) {
        localStorage.removeItem("company_session");
        window.location.href = "/login";
        throw new Error("Sessão expirada");
      }
      if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      return data as DocUploadAnalysis;
    },
    confirmar: (items: DocUploadConfirmItem[]) =>
      request<{ gravados: Array<{ id: string; title: string }>; erros: Array<{ storedName: string; error: string }> }>(
        "/doc-upload/confirmar",
        { method: "POST", body: JSON.stringify({ items }) }
      ),
    descartar: (storedNames: string[]) =>
      request<{ removidos: number }>("/doc-upload/descartar", {
        method: "POST",
        body: JSON.stringify({ storedNames }),
      }),
    ia: () => request<DocUploadAiState>("/doc-upload/ia"),
    definirIa: (habilitada: boolean) =>
      request<DocUploadAiState>("/doc-upload/ia", {
        method: "PUT",
        body: JSON.stringify({ habilitada }),
      }),
    historico: () =>
      request<Array<{
        id: string;
        title: string;
        file_name: string;
        category: string;
        doc_type: string | null;
        competencia: string | null;
        created_at: string;
        empresa_nome: string;
        empresa_cnpj: string;
      }>>("/doc-upload/historico"),
  },

  /**
   * Alertas de vencimento: quais obrigações cada empresa recebe e o que sai hoje.
   * O envio em si ainda não é do portal — `previsao` só mostra, nunca manda.
   */
  alertas: {
    catalogo: () => request<AlertObligationCatalog>("/alertas/catalogo"),
    panorama: (busca?: string) => {
      const q = busca?.trim() ? `?busca=${encodeURIComponent(busca.trim())}` : "";
      return request<AlertOverview>(`/alertas${q}`);
    },
    empresa: (companyId: string) => request<AlertCompanyDetail>(`/alertas/empresas/${companyId}`),
    decidir: (companyId: string, codigo: string, ativo: boolean) =>
      request<{ obrigacao: string; ativo: boolean; origem: string }>(
        `/alertas/empresas/${companyId}/obrigacoes`,
        { method: "PUT", body: JSON.stringify({ codigo, ativo }) }
      ),
    limpar: (companyId: string, codigo: string) =>
      request<{ deletado: boolean }>(
        `/alertas/empresas/${companyId}/obrigacoes/${codigo}`,
        { method: "DELETE" }
      ),
    preferencias: (
      companyId: string,
      data: {
        alertas_ativos?: boolean;
        incentivo_ativo?: boolean;
        avisos_gerais_ativos?: boolean;
        boleto_lembrete_ativo?: boolean;
        boleto_cobranca_ativo?: boolean;
        honorario_cobranca_ativo?: boolean;
        whatsapp?: string | null;
      }
    ) =>
      request<{
        id: string;
        whatsapp: string | null;
        alertas_ativos: boolean;
        incentivo_ativo: boolean;
        avisos_gerais_ativos: boolean;
        boleto_lembrete_ativo: boolean;
        boleto_cobranca_ativo: boolean;
        honorario_cobranca_ativo: boolean;
      }>(`/alertas/empresas/${companyId}/preferencias`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    /** Aplica as mesmas subchaves a várias empresas. Sem company_ids = carteira toda. */
    preferenciasLote: (
      data: {
        alertas_ativos?: boolean;
        incentivo_ativo?: boolean;
        avisos_gerais_ativos?: boolean;
        boleto_lembrete_ativo?: boolean;
        boleto_cobranca_ativo?: boolean;
        honorario_cobranca_ativo?: boolean;
        company_ids?: string[];
      }
    ) =>
      request<{ atualizadas: number }>("/alertas/preferencias-lote", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    aplicarAutomaticas: () =>
      request<{ empresas: number; marcacoes_criadas: number }>("/alertas/aplicar-automaticas", {
        method: "POST",
      }),
    previsao: (data?: string) =>
      request<AlertPreview>(`/alertas/previsao${data ? `?data=${data}` : ""}`),
    /** Guias que vencem em breve e ainda não foram liberadas ao cliente. */
    retidos: (dias = 7) => request<AlertHeldGuides>(`/alertas/retidos?dias=${dias}`),
    /** Estado da instância de WhatsApp (uazapi). Nunca lança por instância caída. */
    whatsapp: () => request<AlertWhatsappStatus>("/alertas/whatsapp"),
    /** `simular: true` (padrão no servidor) ensaia sem mandar nada. */
    enviar: (opts?: { simular?: boolean; data?: string; companyIds?: string[] }) =>
      request<AlertSendResult>("/alertas/enviar", {
        method: "POST",
        body: JSON.stringify({
          simular: opts?.simular ?? true,
          data: opts?.data,
          company_ids: opts?.companyIds,
        }),
      }),
    config: () => request<AlertOpConfig>("/alertas/config"),
    salvarConfig: (data: Partial<AlertOpConfig>) =>
      request<AlertOpConfig>("/alertas/config", { method: "PUT", body: JSON.stringify(data) }),
    /** Envio manual de teste (isolado do fluxo automático). */
    enviarTeste: (companyId: string, tipo: "documentos" | "boleto_em_dia" | "boleto_vencido") =>
      request<{ ok: boolean; numero?: string | null; texto?: string; erro?: string }>(
        "/alertas/enviar-teste",
        { method: "POST", body: JSON.stringify({ company_id: companyId, tipo }) }
      ),
    registrarEnvio: (data: {
      company_id: string;
      obrigacoes: string[];
      /** O dia em que o aviso saiu — a chave de "uma mensagem por cliente por dia". */
      dia_alerta: string;
      texto: string;
      incentivo_id?: string | null;
    }) =>
      request<{ registrado: boolean; id: string | null }>("/alertas/registrar-envio", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    /** Dashboard de falhas: resumo agregado (últimas 48h) + detalhes por empresa. */
    dashboard: () =>
      request<AlertDashboard>("/alertas/dashboard"),
    /** Projeção de férias: próximos N dias com avisos previstos (padrão 7). */
    projecaoFerias: (dias = 7) =>
      request<AlertProjecaoFerias>(`/alertas/projecao-ferias?dias=${Math.min(30, Math.max(1, dias))}`),
  },

  /** Guias da taxa anual da prefeitura: controle por empresa e ano. Só admin. */
  taxasAnuais: {
    listar: (ano: number) =>
      request<{
        ano: number;
        resumo: Record<AnnualTaxStatus, number>;
        total: number;
        empresas: AnnualTaxRow[];
      }>(`/taxas-anuais?ano=${ano}`),
    marcar: (data: {
      company_id: string;
      ano: number;
      status: AnnualTaxStatus;
      observacao?: string | null;
    }) => request<AnnualTaxRow>("/taxas-anuais", { method: "PUT", body: JSON.stringify(data) }),
  },

  admin: {
    /** Modo manutenção: estado atual (qualquer admin) e liga/desliga (só o dono). */
    getManutencao: () =>
      request<{ ativo: boolean; mensagem: string }>("/admin/manutencao"),
    admissoes: {
      list: (opts?: { origem?: string; status?: string; q?: string }) => {
        const p = new URLSearchParams();
        if (opts?.origem) p.set("origem", opts.origem);
        if (opts?.status) p.set("status", opts.status);
        if (opts?.q) p.set("q", opts.q);
        const q = p.toString();
        return request<import("@/lib/admissionFicha").AdmissionListItem[]>(
          `/admin/admissoes${q ? `?${q}` : ""}`,
        );
      },
      get: (id: string) =>
        request<import("@/lib/admissionFicha").AdmissionDetail>(`/admin/admissoes/${id}`),
      setStatus: (id: string, status: import("@/lib/admissionFicha").AdmissionStatus) =>
        request<import("@/lib/admissionFicha").AdmissionDetail>(`/admin/admissoes/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }),
      anexoUrl: (formId: string, anexoId: string) =>
        `${API_BASE}/admin/admissoes/${formId}/anexos/${anexoId}/file`,
    },
    acompanhamentos: {
      mes: (competencia?: string) =>
        request<{
          competencia: string;
          hoje: string;
          quinto_dia_util: string | null;
          decimo_dia_util: string | null;
          ultimo_dia_util: string | null;
          tarefas: MonthlyFollowTask[];
        }>(`/admin/acompanhamentos/mes${competencia ? `?competencia=${competencia}` : ""}`),
      kinds: () => request<MonthlyFollowKind[]>("/admin/acompanhamentos/kinds"),
      criarKind: (data: {
        titulo: string;
        descricao?: string;
        prazo_tipo: "n_dia_bancario" | "ultimo_dia_bancario";
        prazo_n?: number;
      }) =>
        request<MonthlyFollowKind>("/admin/acompanhamentos/kinds", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      patchKind: (
        id: string,
        data: {
          titulo?: string;
          descricao?: string;
          prazo_tipo?: string;
          prazo_n?: number;
          default_assignee_id?: string | null;
          ativo?: boolean;
        },
      ) =>
        request<MonthlyFollowKind>(`/admin/acompanhamentos/kinds/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),
      patchTarefa: (
        id: string,
        data: { assigned_admin_id?: string | null; status?: string; notes?: string },
      ) =>
        request<MonthlyFollowTask>(`/admin/acompanhamentos/tarefas/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),
      responsaveis: () =>
        request<Array<{ id: string; nome: string }>>("/admin/acompanhamentos/responsaveis"),
      meis: () => request<MeiCredential[]>("/admin/acompanhamentos/meis"),
      criarMei: (data: Record<string, unknown>) =>
        request<MeiCredential>("/admin/acompanhamentos/meis", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      patchMei: (id: string, data: Record<string, unknown>) =>
        request<MeiCredential>(`/admin/acompanhamentos/meis/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),
      revelarSenhaMei: (id: string) =>
        request<{ senha: string }>(`/admin/acompanhamentos/meis/${id}/senha`),
    },
    setManutencao: (data: { ativo?: boolean; mensagem?: string }) =>
      request<{ ativo: boolean; mensagem: string }>("/admin/manutencao", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    summary: () =>
      request<{
        companies: number;
        documents: number;
        employees: number;
        certificates: number;
        deliverables: number;
        deliverables_liberadas: number;
        deliverables_retidas: number;
      }>("/admin/summary"),
    /** Entregas (guias/folha/documentos) por empresa: liberadas × retidas. */
    deliverablesOverview: () =>
      request<
        Array<{
          id: string;
          name: string;
          cnpj: string;
          total: number;
          liberadas: number;
          retidas: number;
          ultima_entrada: string | null;
        }>
      >("/admin/deliverables-overview"),
    /**
     * Cobertura operacional: onde o escritório está em dia e onde falta. Cada número
     * é uma fila de trabalho — antes só dava para saber abrindo empresa por empresa.
     */
    cobertura: () =>
      request<{
        empresas: number;
        com_funcionarios: number;
        estabelecidas: number;
        sem_licenca: { total: number; empresas: Array<{ id: string; name: string; cnpj: string }> };
        sem_programacao_ferias: {
          total: number;
          empresas: Array<{ id: string; name: string; cnpj: string }>;
        };
        sem_extrato_lido: {
          total: number;
          empresas: Array<{ id: string; name: string; cnpj: string }>;
        };
      }>("/admin/cobertura"),
    /** Férias urgentes: funcionários de TODAS as empresas prestes a perder dias. */
    feriasUrgencia: () =>
      request<{
        total_empresas: number;
        total_funcionarios: number;
        total_vencidos: number;
        empresas: Array<{
          company_id: string;
          empresa_nome: string;
          empresa_cnpj: string;
          funcionarios: Array<{
            id: string;
            nome: string;
            codigo: string | null;
            admissao: string | null;
            limite_gozo: string | null;
            dias_direito: number;
            dias_gozados: number;
            dias_restantes: number;
            dias_para_vencer: number | null;
            vencido: boolean;
            faltas: number | null;
          }>;
        }>;
      }>("/admin/ferias-urgencia"),
    /** Auditoria LGPD: quem concordou, quando e em que versão do termo. */
    lgpdConsents: () =>
      request<{
        versao_atual: string;
        resumo: { aceito: number; visto: number; pendente: number };
        total: number;
        empresas: Array<{
          id: string;
          name: string;
          cnpj: string;
          lgpd_consent_at: string | null;
          lgpd_consent_version: string | null;
          lgpd_consent_ip: string | null;
          lgpd_prompt_seen_at: string | null;
          situacao: "aceito" | "visto" | "pendente";
        }>;
      }>("/admin/lgpd-consents"),
    me: () =>
      request<{
        id: string;
        cpf: string;
        nome: string | null;
        contact_email: string | null;
        is_owner: boolean;
        areas: AdminAreaAccess;
      }>("/admin/me"),

    /** Usuários do painel (login por CPF). Só o dono usa estas rotas. */
    usuarios: {
      listar: () => request<AdminUser[]>("/admin/usuarios"),
      criar: (data: { cpf: string; nome: string; areas: AdminAreaAccess; senha?: string }) =>
        request<{ usuario: AdminUser; senha_inicial: string }>("/admin/usuarios", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      atualizar: (
        id: string,
        data: { nome?: string; areas?: AdminAreaAccess; active?: boolean }
      ) =>
        request<AdminUser>(`/admin/usuarios/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),
      redefinirSenha: (id: string, senha?: string) =>
        request<{ ok: boolean; senha_inicial: string }>(`/admin/usuarios/${id}/senha`, {
          method: "POST",
          body: JSON.stringify(senha ? { senha } : {}),
        }),
    },
    updateMyContactEmail: (contact_email: string | null) =>
      request<{ ok: boolean; contact_email: string | null }>("/admin/me/contact-email", {
        method: "PATCH",
        body: JSON.stringify({ contact_email }),
      }),
    companies: () =>
      request<
        Array<{
          id: string;
          name: string;
          cnpj: string;
          contact_email: string | null;
          phone: string | null;
          tool_access: CompanyToolAccessApi;
          /** Situação no G-Click (ATIVO/DESATIVADO). Informativo — não bloqueia nada. */
          gclick_status: string | null;
          created_at: string;
          /** Quando o acesso foi enviado por WhatsApp (null = ainda não enviado). */
          acesso_enviado_em: string | null;
          /** Último login do cliente no portal (null = nunca entrou). */
          ultimo_login_em: string | null;
          /** Grupo: se preenchido, esta empresa é filial da empresa-âncora daquele id. */
          matriz_id: string | null;
        }>
      >("/admin/companies"),
    /**
     * Vincula/desvincula a empresa a um grupo. `matriz_id` = id da empresa-âncora do
     * grupo, ou null para deixar independente. Entrar em qualquer empresa do grupo passa
     * a dar navegação livre por todas.
     */
    setCompanyMatriz: (id: string, matriz_id: string | null) =>
      request<{ ok: boolean; matriz_id: string | null }>(
        `/admin/companies/${id}/matriz`,
        { method: "PUT", body: JSON.stringify({ matriz_id }) }
      ),
    /** Tira a empresa do ar: some dos paineis, para de receber e perde o portal. */
    arquivarEmpresa: (id: string, motivo?: string) =>
      request<{ ok: boolean; ja_estava_arquivada: boolean }>(
        `/admin/companies/${id}/arquivar`,
        { method: "POST", body: JSON.stringify({ motivo }) }
      ),
    /** Devolve a empresa ao ar. Só o dono do sistema — o servidor recusa os demais. */
    reativarEmpresa: (id: string) =>
      request<{ ok: boolean; ja_estava_ativa: boolean }>(
        `/admin/companies/${id}/reativar`,
        { method: "POST" }
      ),
    /** Empresas arquivadas (só o dono enxerga). */
    empresasArquivadas: () =>
      request<
        Array<{
          id: string;
          name: string;
          cnpj: string;
          arquivada_em: string | null;
          arquivada_motivo: string | null;
          arquivada_por_nome: string | null;
        }>
      >("/admin/companies/arquivadas"),

    excluirEmpresa: (id: string, motivo?: string) =>
      request<{ ok: boolean; ja_estava_excluida: boolean }>(
        `/admin/companies/${id}/excluir`,
        { method: "POST", body: JSON.stringify({ motivo }) }
      ),

    revertExclusao: (id: string) =>
      request<{ ok: boolean }>(`/admin/companies/${id}/reverter-exclusao`, {
        method: "POST",
      }),

    /** Empresas excluídas (só o dono enxerga). */
    empresasExcluidas: () =>
      request<
        Array<{
          id: string;
          name: string;
          cnpj: string;
          excluida_em: string | null;
          excluida_motivo: string | null;
          excluida_por_nome: string | null;
        }>
      >("/admin/companies/excluidas"),

    createCompany: (data: {
      name: string;
      cnpj: string;
      contact_email?: string | null;
      phone?: string | null;
    }) =>
      request<{
        company: {
          id: string;
          name: string;
          cnpj: string;
          contact_email: string | null;
          phone: string | null;
          tool_access: CompanyToolAccessApi;
          created_at: string;
        };
        /** Mostrada UMA vez. Não fica guardada em claro — se perder, gera outra. */
        senha_inicial: string;
        message: string;
      }>("/admin/companies", { method: "POST", body: JSON.stringify(data) }),
    updateCompany: (
      companyId: string,
      data: {
        name?: string;
        contact_email?: string | null;
        phone?: string | null;
        tool_access?: CompanyToolAccessApi;
      }
    ) =>
      request<{
        id: string;
        name: string;
        cnpj: string;
        contact_email: string | null;
        phone: string | null;
        tool_access: CompanyToolAccessApi;
        created_at: string;
      }>(`/admin/companies/${companyId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    importEmployees: (
      companyId: string,
      rows: Array<{ name: string; cpf: string; pis?: string | null }>,
      fileCnpj: string
    ) =>
      request<{ inserted: number; skipped: number; errors: Array<{ row: number; message: string }> }>(
        `/admin/companies/${companyId}/import-employees`,
        { method: "POST", body: JSON.stringify({ rows, fileCnpj }) }
      ),

    /** Funcionários lidos do último extrato de folha da empresa (prévia). */
    extratoEmployees: (companyId: string) =>
      request<{
        competencia: string | null;
        arquivo: string;
        invalidos: number;
        total: number;
        novos: number;
        inativar: number;
        ausentes: string[];
        funcionarios: Array<{ codigo: string; name: string; cpf: string; jaCadastrado: boolean }>;
      }>(`/admin/companies/${companyId}/extrato-employees`),
    /** Cadastra os funcionários do extrato (uma empresa, ou todas se companyId omitido). */
    importExtratoEmployees: (companyId?: string) =>
      request<{
        inseridos: number;
        pulados: number;
        inativados: number;
        empresas: Array<{ name: string; inseridos?: number; pulados?: number; inativados?: number; erro?: string }>;
      }>("/admin/extrato-employees/import", {
        method: "POST",
        body: JSON.stringify(companyId ? { company_id: companyId } : {}),
      }),
    /** Regras de honorário POR EMPRESA + empresas disponíveis para incluir. */
    honorariosConfig: () =>
      request<{
        padrao: { base: number; registros_base: number; adicional: number };
        regras: Array<{ company_id: string; name: string; cnpj: string; base: number; registros_base: number; adicional: number }>;
        disponiveis: Array<{ company_id: string; name: string; cnpj: string }>;
      }>("/admin/honorarios-config"),
    /** Cria/edita a regra de UMA empresa (upsert). Sem valores → usa o padrão. */
    salvarHonorarioRegra: (body: {
      company_id: string;
      base?: number;
      registros_base?: number;
      adicional?: number;
    }) =>
      request<{ ok: boolean; criado: boolean }>("/admin/honorarios-config", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    /** Remove a empresa da cobrança por headcount. */
    removerHonorarioRegra: (companyId: string) =>
      request<{ ok: boolean }>(`/admin/honorarios-config/${companyId}`, { method: "DELETE" }),
    /** Honorários por headcount da folha, por empresa com regra, mês a mês. */
    honorariosFolha: (desde: string) =>
      request<{
        desde: string;
        ate: string;
        unidades: Array<{
          id: string;
          name: string;
          cnpj: string;
          base: number;
          registros_base: number;
          adicional: number;
          total: number;
          meses: Array<{
            competencia: string;
            empregados: number | null;
            sem_folha: boolean;
            honorario: number;
          }>;
        }>;
      }>(`/admin/honorarios-folha?desde=${encodeURIComponent(desde)}`),
    /** Visão de envio de Folha e encargos (FGTS/INSS/DAS) por competência. */
    acompanhamentoEnvio: (competencia: string) =>
      request<{
        competencia: string;
        total_empresas: number;
        grupos: Array<{
          chave: "folha" | "fgts" | "inss" | "das";
          rotulo: string;
          esperadas: number;
          ok: number;
          pendentes: number;
          empresas_ok: Array<{ id: string; name: string; cnpj: string }>;
          empresas_pendentes: Array<{ id: string; name: string; cnpj: string }>;
        }>;
      }>(`/admin/acompanhamento-envio?competencia=${encodeURIComponent(competencia)}`),
    /** Check de comunicação com o WhatsApp (uazapi): instância, webhook e transcrição. */
    whatsappDiagnostico: () =>
      request<{
        instancia: { ok: boolean; categoria: string; mensagem: string; owner?: string | null };
        ambiente: {
          public_app_url: string | null;
          uazapi_subdomain: string | null;
          uazapi_token_configurado: boolean;
          webhook_secret_configurado: boolean;
          nescon_contato_whatsapp: string | null;
          admin_whatsapp: string | null;
          openai_api_key_configurada: boolean;
          groq_api_key_configurada: boolean;
          chatgpt_tela_configurada: boolean;
        };
        webhook: { secret_configurado: boolean; url_base: string | null; url_com_token: string | null };
        assistente_dp: { transcricao_audio_configurada: boolean; classificacao_ia_configurada: boolean };
      }>("/admin/whatsapp/diagnostico"),
    whatsappTestar: (numero: string) =>
      request<{ ok: boolean; numero?: string; erro?: string }>("/admin/whatsapp/testar", {
        method: "POST",
        body: JSON.stringify({ numero }),
      }),
    /** Opções da sincronização mudáveis pela tela (sem redeploy). */
    configSync: () =>
      request<{ alerta_so_ativos: boolean }>("/admin/configuracoes/sync"),
    salvarConfigSync: (alerta_so_ativos: boolean) =>
      request<{ ok: boolean; alerta_so_ativos: boolean }>("/admin/configuracoes/sync", {
        method: "PUT",
        body: JSON.stringify({ alerta_so_ativos }),
      }),
    /** Programação de Férias: sobe o PDF e lê a última importação da empresa. */
    ferias: {
      ultima: (companyId: string) =>
        request<{ upload: VacationUpload | null; periodos: VacationPeriod[] }>(
          `/admin/ferias/${companyId}`
        ),
      upload: async (companyId: string, file: File) => {
        const token = getToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${API_BASE}/admin/ferias/${companyId}`, {
          method: "POST",
          body: fd,
          headers,
        });
        const data = await parseResponseJson<unknown>(res);
        if (res.status === 401) {
          localStorage.removeItem("company_session");
          window.location.href = "/login";
          throw new Error("Sessão expirada");
        }
        if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
        return data as {
          uploadId: string;
          funcionarios: number;
          periodos: number;
          empresa: string;
          data_base: string | null;
          emissao: string | null;
          total_declarado: number | null;
          /** Falso = lemos menos gente do que o rodapé do PDF declara. */
          confere: boolean;
        };
      },
      lote: async (files: File[]) => {
        const token = getToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const fd = new FormData();
        for (const f of files) fd.append("files", f);
        const res = await fetch(`${API_BASE}/admin/ferias/lote`, {
          method: "POST",
          body: fd,
          headers,
        });
        const data = await parseResponseJson<unknown>(res);
        if (res.status === 401) {
          localStorage.removeItem("company_session");
          window.location.href = "/login";
          throw new Error("Sessão expirada");
        }
        if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
        return data as {
          gravados: Array<{ arquivo: string; empresa: string; company_id: string; funcionarios: number; periodos: number }>;
          erros: Array<{ arquivo: string; motivo: string }>;
        };
      },
    },

    /** Quem está cadastrado mas não veio no último extrato — aguarda confirmação. */
    saidasFolha: () =>
      request<{
        total: number;
        saidas: Array<{
          id: string;
          nome: string;
          cpf: string;
          competencia: string | null;
          criado_em: string;
          company_id: string;
          company_name: string;
          cnpj: string;
        }>;
      }>("/admin/saidas-folha"),
    inativarSaida: (id: string) =>
      request<{ ok: boolean }>(`/admin/saidas-folha/${id}/inativar`, { method: "POST" }),
    manterSaida: (id: string) =>
      request<{ ok: boolean }>(`/admin/saidas-folha/${id}/manter`, { method: "POST" }),
    /** Lê agora os extratos que mudaram, sem esperar a sincronização. */
    processarExtratos: () =>
      request<{
        empresas: number;
        inseridos: number;
        atualizados: number;
        avisos: number;
        erros: number;
        pulados: number;
      }>("/admin/extratos/processar", { method: "POST" }),
    /** Estado da sincronização com o G-Click. */
    syncStatus: () =>
      request<{
        configurado: boolean;
        rodando: boolean;
        ultima: {
          criados: number;
          atualizados: number;
          empresasCriadas: number;
          erros: number;
          segundos: number;
          em: string;
          /** Avisos de "documento novo" mandados pelo próprio portal ao fim desta sincronização. */
          avisos_enviados?: number;
          avisos_nao_enviados?: number;
        } | null;
      }>("/admin/sync-gclick/status"),
    /** Dispara a sincronização com o G-Click (traz documentos e cria empresas que faltam). */
    runSync: (meses?: number) =>
      request<{ message: string }>("/admin/sync-gclick", {
        method: "POST",
        body: JSON.stringify(meses ? { meses } : {}),
      }),
    /**
     * Carga histórica: traz as competências já encerradas a partir de `desde` (AAAA-MM).
     * Os documentos entram liberados e marcados como histórico — arquivo para o cliente,
     * não cobrança. O mês corrente fica de fora.
     */
    runSyncHistorico: (desde: string, tipos?: string[]) =>
      request<{ message: string; competencias: string[]; tipos: string[] | null }>(
        "/admin/sync-gclick/historico",
        { method: "POST", body: JSON.stringify({ desde, tipos }) }
      ),
    /** Tipos que o G-Click entrega, para a tela montar a escolha. */
    tiposGclick: () =>
      request<Array<{ codigo: string; nome: string; categoria: "guia" | "folha" }>>(
        "/admin/sync-gclick/tipos"
      ),
    /** Status da sync de boletos Cora. */
    coraSyncStatus: () =>
      request<{
        configurado: boolean;
        rodando: boolean;
        ultima: {
          criados: number;
          atualizados: number;
          semMudanca: number;
          empresasProcessadas: number;
          erros: number;
          segundos: number;
          em: string;
        } | null;
      }>("/admin/sync-cora/status"),
    /** Dispara a sincronização de boletos da Cora. */
    runCorSync: (de?: string, ate?: string) =>
      request<{ message: string }>("/admin/sync-cora", {
        method: "POST",
        body: JSON.stringify({ de, ate }),
      }),
    /** Sync individual de uma empresa Cora por CNPJ. */
    coraSyncEmpresa: (cnpj: string) =>
      request<{ message: string }>("/admin/cora/sync-empresa", {
        method: "POST",
        body: JSON.stringify({ cnpj }),
      }),
    /** Lista empresas com info de boletos Cora. */
    coraEmpresas: () =>
      request<Array<{
        id: string;
        name: string;
        cnpj: string;
        boletos_ativo: boolean;
        total_boletos: number;
        ultimo_importado: string | null;
      }>>("/admin/cora/empresas"),
    /** Toggle importação de boletos para uma empresa. */
    coraToggleEmpresa: (id: string, ativo: boolean) =>
      request<{ ok: boolean; boletos_ativo: boolean }>(`/admin/cora/empresas/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ boletos_ativo: ativo }),
      }),
    /** Lista boletos Cora importados. */
    coraBoletos: (filters?: { company_id?: string; status?: string; competencia?: string }) => {
      const params = new URLSearchParams();
      if (filters?.company_id) params.set("company_id", filters.company_id);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.competencia) params.set("competencia", filters.competencia);
      const q = params.toString();
      return request<Array<{
        id: string;
        company_id: string;
        empresa_nome: string;
        empresa_cnpj: string;
        title: string;
        competencia: string | null;
        due_date: string | null;
        status: string;
        doc_type: string | null;
        external_ref: string;
        pdf_url: string | null;
        valor_centavos: number | null;
        created_at: string;
      }>>(`/admin/cora/boletos${q ? `?${q}` : ""}`);
    },
    /** Cancelar (excluir) um boleto Cora do portal. */
    coraDeleteBoleto: (id: string) =>
      request<{ ok: boolean }>(`/admin/cora/boletos/${id}`, { method: "DELETE" }),
    /** Enviar PDF do boleto por WhatsApp para o cliente. */
    coraEnviarWhatsapp: (id: string) =>
      request<{ ok: boolean; enviado_para: string }>(`/admin/cora/boletos/${id}/enviar-whatsapp`, {
        method: "POST",
      }),
    /** Lista todos os honorários com status de cobrança. */
    listarHonorarios: () =>
      request<Array<{
        id: string;
        title: string;
        pdf_url: string | null;
        valor_centavos: number | null;
        status: string;
        due_date: string | null;
        empresa_nome: string;
        empresa_cnpj: string;
        whatsapp: string | null;
        alert_sent_at: string | null;
        created_at: string;
      }>>("/admin/honorarios"),
    /** Disparo manual de cobrança de honorários (envia PDF por WhatsApp). */
    cobrancaHonorarioAgora: (companyId?: string, boletoId?: string) =>
      request<{
        enviados: number;
        total: number;
        erros: Array<{ empresa?: string; motivo: string }>;
        resultados: Array<{ empresa: string; enviado_para: string }>;
      }>("/admin/honorarios/cobrar-agora", {
        method: "POST",
        body: JSON.stringify({ company_id: companyId, boleto_id: boletoId }),
      }),
    /** Marca/desmarca um boleto como honorário. */
    marcarHonorario: (id: string, isHonorario: boolean) =>
      request<{ ok: boolean }>(`/admin/honorarios/${id}/marcar`, {
        method: "PUT",
        body: JSON.stringify({ is_honorario: isHonorario }),
      }),
    /** Marca TODOS os boletos Cora como honorários (atalho). */
    marcarTodosHonorarios: () =>
      request<{ ok: boolean; marcados: number }>("/admin/honorarios/marcar-todos", {
        method: "POST",
      }),
    /** Empresas que ainda não trocaram a senha inicial — a fila de risco a zerar. */
    senhaPendente: () =>
      request<{ total: number; empresas: Array<{ id: string; name: string; cnpj: string }> }>(
        "/admin/companies/senha-pendente"
      ),
    /** Gera senha nova e devolve UMA vez — não há como consultá-la depois. */
    gerarSenhaInicial: (companyId: string) =>
      request<{ id: string; name: string; cnpj: string; senha_inicial: string; message: string }>(
        `/admin/companies/${companyId}/senha-inicial`,
        { method: "POST" }
      ),
    /** Admin define uma senha específica para o cliente. */
    alterarSenhaCliente: (companyId: string, novaSenha: string, obrigarTroca = true) =>
      request<{ id: string; name: string; cnpj: string; must_change_password: boolean; message: string }>(
        `/admin/companies/${companyId}/alterar-senha`,
        { method: "PUT", body: JSON.stringify({ nova_senha: novaSenha, obrigar_troca: obrigarTroca }) }
      ),
    /** Admin personifica empresa — gera token para ver portal como cliente. */
    personificar: (companyId: string) =>
      request<{
        token: string;
        company: { id: string; name: string; cnpj: string; tool_access: Record<string, boolean> };
        is_matriz: boolean;
        empresas_grupo: Array<{ id: string; name: string; cnpj: string; is_matriz: boolean }>;
        personificando: boolean;
        admin_nome: string;
      }>(`/admin/personificar/${companyId}`, { method: "POST" }),
    /** Gera campos de advertência/suspensão via IA a partir de texto livre. */
    documentoIa: (texto: string) =>
      request<{
        tipo: "warning" | "suspension";
        funcionario_nome: string;
        funcionario_nome_completo?: string;
        funcionario_id?: string;
        funcionario_cpf?: string;
        funcionarios_candidatos?: Array<{ id: string; name: string; cpf: string }>;
        empresa_nome: string | null;
        empresa_nome_completo?: string;
        empresa_id?: string;
        empresa_cnpj?: string;
        empresas_candidatas?: Array<{ id: string; name: string; cnpj: string }>;
        data_documento: string;
        motivo_tipo: "falta" | "ma_conduta" | "outro";
        motivo_descricao: string;
        datas_falta?: string[];
        dias_suspensao?: number;
        confianca: "alta" | "media" | "baixa";
      }>("/admin/documento-ia", { method: "POST", body: JSON.stringify({ texto }) }),
    /** Envia acesso (senha provisória) por WhatsApp para empresas selecionadas ou todas. */
    enviarAcesso: (companyIds: string[] | "all") =>
      request<{
        enviados: number;
        erros: Array<{ id: string; name: string; erro: string }>;
        total: number;
        resultados: Array<{ id: string; name: string; status: string }>;
      }>("/admin/companies/enviar-acesso", {
        method: "POST",
        body: JSON.stringify({ companyIds }),
      }),
    /** Backup diário do banco — o único dado que não volta sozinho. */
    backupConfig: () => request<BackupConfig>("/admin/backup/config"),
    salvarBackupConfig: (d: Partial<Omit<BackupConfig, "senha_configurada" | "smtp_configurado">>) =>
      request<BackupConfig>("/admin/backup/config", { method: "PUT", body: JSON.stringify(d) }),
    executarBackup: () => request<BackupResult>("/admin/backup/executar", { method: "POST" }),
    /** Quantas entregas apontam para PDF que não está mais no disco. */
    integridadeArquivos: () =>
      request<{
        total: number;
        ok: number;
        faltando: number;
        recuperaveis: number;
        perdidos: number;
        exemplos: Array<{ empresa: string; title: string; competencia: string | null; source: string }>;
      }>("/admin/arquivos/integridade"),
    /** Marca as órfãs do G-Click para a próxima sincronização rebaixar. */
    rebaixarArquivos: () =>
      request<{ marcadas: number; message: string }>("/admin/arquivos/rebaixar", { method: "POST" }),
    /** Dry-run: quantos funcionários o extrato traria/inativaria por empresa, sem gravar. */
    scanExtratoEmployees: () =>
      request<{
        empresas_com_extrato: number;
        total_novos: number;
        total_inativar: number;
        empresas: Array<{ id: string; name: string; competencia: string | null; encontrados: number; novos: number; inativar: number }>;
      }>("/admin/extrato-employees/scan-all", { method: "POST" }),
  },

  employees: {
    list: (opts?: { companyId?: string }) => {
      const q =
        opts?.companyId && opts.companyId.length
          ? `?company_id=${encodeURIComponent(opts.companyId)}`
          : "";
      return request<
        Array<{
          id: string;
          name: string;
          cpf: string;
          pis: string | null;
          active: boolean;
          company_id: string;
          created_at: string;
          company_name?: string;
          company_cnpj?: string;
        }>
      >(`/employees${q}`);
    },
    create: (data: { company_id?: string; name: string; cpf: string; pis?: string | null; active?: boolean }) =>
      request("/employees", { method: "POST", body: JSON.stringify(data) }),
    import: (rows: Array<{ name: string; cpf: string; pis?: string | null }>, fileCnpj: string) =>
      request<{ inserted: number; skipped: number; errors: Array<{ row: number; message: string }> }>("/employees/import", {
        method: "POST",
        body: JSON.stringify({ rows, fileCnpj }),
      }),
    update: (id: string, data: { name?: string; cpf?: string; pis?: string | null; active?: boolean }) =>
      request(`/employees/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/employees/${id}`, { method: "DELETE" }),
  },

  documents: {
    list: (opts?: { companyId?: string }) => {
      const q =
        opts?.companyId && opts.companyId.length
          ? `?company_id=${encodeURIComponent(opts.companyId)}`
          : "";
      return request<Array<{
        id: string; document_type: string; employee_name: string; employee_cpf: string;
        employee_pis: string | null; company_name: string; company_cnpj: string; company_id: string | null;
        start_date: string | null; suspension_days: number | null; return_date: string | null;
        description: string | null; created_at: string;
      }>>(`/documents${q}`);
    },
    create: (data: Record<string, unknown>) =>
      request("/documents", { method: "POST", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/documents/${id}`, { method: "DELETE" }),
    enviarEmail: async (id: string, file: Blob, filename: string) => {
      const form = new FormData();
      form.append("file", file, filename);
      const token = getToken();
      const res = await fetch(`${API_BASE}/documents/${id}/enviar-email`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro ao enviar" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
  },

  certificates: {
    list: (opts?: { companyId?: string; startDate?: string; endDate?: string }) => {
      let url = `/certificates`;
      const params: string[] = [];
      const companyId = opts?.companyId;
      if (companyId && companyId.length) params.push(`company_id=${encodeURIComponent(companyId)}`);
      if (opts?.startDate) params.push(`start_date=${opts.startDate}`);
      if (opts?.endDate) params.push(`end_date=${opts.endDate}`);
      if (params.length) url += `?${params.join("&")}`;
      return request<Array<{
        id: string; company_id: string; employee_id: string; file_path: string;
        file_name: string; certificate_date: string; notes: string | null;
        created_at: string; employee_name?: string; company_name?: string; company_cnpj?: string;
      }>>(url);
    },
    upload: async (formData: FormData) => {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/certificates`, {
        method: "POST",
        body: formData,
        headers,
      });
      const data = await parseResponseJson<unknown>(res);
      if (res.status === 401) {
        localStorage.removeItem("company_session");
        window.location.href = "/login";
        throw new Error("Sessão expirada");
      }
      if (!res.ok) {
        const err = data as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return data;
    },
    delete: (id: string) =>
      request(`/certificates/${id}`, { method: "DELETE" }),
    fileUrl: (filePath: string) => `${API_BASE}/certificates/file/${filePath}`,
  },

  /** Entregas da contabilidade: guias fiscais, folha e documentos avulsos. */
  deliverables: {
    list: (opts?: {
      companyId?: string;
      category?: DeliverableCategory;
      competencia?: string;
      status?: DeliverableStatus;
      from?: string;
      to?: string;
    }) => {
      const params = new URLSearchParams();
      if (opts?.companyId) params.set("company_id", opts.companyId);
      if (opts?.category) params.set("category", opts.category);
      if (opts?.competencia) params.set("competencia", opts.competencia);
      if (opts?.status) params.set("status", opts.status);
      if (opts?.from) params.set("from", opts.from);
      if (opts?.to) params.set("to", opts.to);
      const q = params.toString();
      return request<Deliverable[]>(`/deliverables${q ? `?${q}` : ""}`);
    },
    calendar: (opts?: { companyId?: string; from?: string; to?: string }) => {
      const params = new URLSearchParams();
      if (opts?.companyId) params.set("company_id", opts.companyId);
      if (opts?.from) params.set("from", opts.from);
      if (opts?.to) params.set("to", opts.to);
      const q = params.toString();
      return request<Deliverable[]>(`/deliverables/calendar${q ? `?${q}` : ""}`);
    },
    upcoming: (opts?: { companyId?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (opts?.companyId) params.set("company_id", opts.companyId);
      if (opts?.limit) params.set("limit", String(opts.limit));
      const q = params.toString();
      return request<Deliverable[]>(`/deliverables/upcoming${q ? `?${q}` : ""}`);
    },
    setStatus: (id: string, status: DeliverableStatus) =>
      request<Deliverable>(`/deliverables/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/deliverables/${id}`, { method: "DELETE" }),
    /** Blob autenticado — usar com `openDeliverableFile` (ver lib/openFile.ts). */
    fetchFile: (id: string) => requestBlob(`/deliverables/${id}/file`),
    adminUpload: async (formData: FormData) => {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/deliverables`, { method: "POST", body: formData, headers });
      const data = await parseResponseJson<unknown>(res);
      if (res.status === 401) {
        localStorage.removeItem("company_session");
        window.location.href = "/login";
        throw new Error("Sessão expirada");
      }
      if (!res.ok) {
        const err = data as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      // origem_vencimento: como a data foi resolvida ('manual'|'regra'|'pdf'|'ia'|null).
      // doc_type_detectado: tipo identificado no envio (ex.: FGTS). due_date_from_pdf
      // mantido por compatibilidade (equivale a origem_vencimento === 'pdf').
      return data as Deliverable & {
        due_date_from_pdf?: boolean;
        origem_vencimento?: "manual" | "regra" | "pdf" | "ia" | null;
        doc_type_detectado?: string | null;
      };
    },
    /** Link do WhatsApp: token opaco, sem login. */
    public: {
      get: (token: string) => publicRequest<PublicDeliverable>(`/deliverables/public/${token}`),
      fileUrl: (token: string) => `${API_BASE}/deliverables/public/${token}/file`,
    },
  },

  /** Chat / Atendimento — lado do cliente. */
  chat: {
    conversations: () =>
      request<{
        conversations: Array<{
          id: string;
          subject: string | null;
          status: string;
          created_at: string;
          last_message_at: string;
          resolved_at: string | null;
          resolved_by: string | null;
          nao_lidas: number;
          ultima_mensagem: string | null;
        }>;
      }>("/chat/conversations"),
    create: (body: string, subject?: string, clientMsgId?: string) =>
      request<{ conversation: { id: string; subject: string | null; status: string } }>(
        "/chat/conversations",
        { method: "POST", body: JSON.stringify({ body, subject, client_msg_id: clientMsgId }) }
      ),
    messages: (id: string) =>
      request<{
        conversation: { id: string; status: string; subject: string | null; assigned_to: string | null };
        messages: Array<{
          id: string;
          sender_type: string;
          sender_name: string | null;
          body: string;
          created_at: string;
        }>;
      }>(`/chat/conversations/${id}/messages`),
    send: (id: string, body: string, clientMsgId?: string) =>
      request<{ message: { id: string; body: string; created_at: string }; reaberta: boolean }>(
        `/chat/conversations/${id}/messages`,
        { method: "POST", body: JSON.stringify({ body, client_msg_id: clientMsgId }) }
      ),
    markRead: (id: string) =>
      request<{ ok: boolean }>(`/chat/conversations/${id}/read`, { method: "POST" }),
    resolve: (id: string) =>
      request<{ ok: boolean }>(`/chat/conversations/${id}/resolver`, { method: "POST" }),
    unread: () => request<{ count: number }>("/chat/unread"),
  },

  /** Atendimentos — lado admin. */
  atendimentos: {
    list: (filters?: { status?: string; company_id?: string }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.company_id) params.set("company_id", filters.company_id);
      const q = params.toString();
      return request<{
        conversations: Array<{
          id: string;
          subject: string | null;
          status: string;
          assigned_to: string | null;
          created_at: string;
          last_message_at: string;
          resolved_at: string | null;
          resolved_by: string | null;
          empresa: string;
          cnpj: string;
          responsavel_nome: string | null;
          nao_lidas: number;
          ultima_mensagem: string | null;
        }>;
      }>(`/admin/atendimentos${q ? `?${q}` : ""}`);
    },
    summary: () =>
      request<{
        na_fila: number;
        em_atendimento: number;
        meus: number;
        resolvidos_hoje: number;
        resolvidos_7d: number;
        /** Horas de espera da conversa sem dono mais antiga. 0 = fila vazia. */
        espera_mais_antiga_h: number;
      }>("/admin/atendimentos/summary"),
    unread: () => request<{ count: number }>("/admin/atendimentos/unread"),
    atendentes: () =>
      request<{ atendentes: Array<{ id: string; nome: string }> }>(
        "/admin/atendimentos/atendentes"
      ),
    messages: (id: string) =>
      request<{
        conversation: {
          id: string;
          status: string;
          subject: string | null;
          assigned_to: string | null;
          company_id: string;
        };
        empresa: { name: string; cnpj: string; contact_email: string | null; phone: string | null } | null;
        messages: Array<{
          id: string;
          sender_type: string;
          sender_name: string | null;
          body: string;
          created_at: string;
        }>;
      }>(`/admin/atendimentos/${id}/messages`),
    send: (id: string, body: string, clientMsgId?: string) =>
      request<{ message: { id: string; body: string; created_at: string } }>(
        `/admin/atendimentos/${id}/messages`,
        { method: "POST", body: JSON.stringify({ body, client_msg_id: clientMsgId }) }
      ),
    action: (id: string, action: string, transferirPara?: string) =>
      request<{ ok: boolean }>(`/admin/atendimentos/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, transferir_para: transferirPara }),
      }),
    markRead: (id: string) =>
      request<{ ok: boolean; marcada: boolean }>(`/admin/atendimentos/${id}/read`, { method: "POST" }),
    uploadFile: async (id: string, file: File, body?: string, enviarAoPortal?: boolean) => {
      const form = new FormData();
      form.append("file", file);
      if (body) form.append("body", body);
      if (enviarAoPortal) form.append("enviar_ao_portal", "true");
      const token = getToken();
      const res = await fetch(`${API_BASE}/admin/atendimentos/${id}/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro ao enviar arquivo" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
  },

  /** Configuração de IA (Claude/Gemini/ChatGPT) para CNPJ e vencimento em documentos. */
  configIa: {
    get: () =>
      request<{
        provider: string;
        habilitada: boolean;
        limiar_confianca: number;
        timeout_ms: number;
        vencimento_habilitada: boolean;
        provedores_disponiveis: string[];
      }>("/admin/config/ia"),
    salvar: (body: Record<string, unknown>) =>
      request<{ ok: boolean }>("/admin/config/ia", { method: "PUT", body: JSON.stringify(body) }),
    testar: (provider: string) =>
      request<{ ok: boolean; erro?: string }>("/admin/config/ia/testar", {
        method: "POST",
        body: JSON.stringify({ provider }),
      }),
  },

  /** Fila de revisão de vencimentos sugeridos (reconhecimento em lote, PLANO-RECONHECIMENTO-VENCIMENTO-IA.md). */
  vencimentosSugeridos: {
    list: () =>
      request<
        Array<{
          id: string;
          data_sugerida: string;
          /** Nula = documento ainda não tinha vencimento. Preenchida = o PDF divergiu do que já estava gravado. */
          data_anterior: string | null;
          origem: "deterministico" | "ia";
          confianca: number | null;
          provider_ia: string | null;
          motivo: string | null;
          criado_em: string;
          deliverable_id: string;
          title: string;
          category: string;
          competencia: string | null;
          file_name: string;
          company_id: string;
          company_nome: string;
          company_cnpj: string;
        }>
      >("/admin/vencimentos-sugeridos"),
    /** Dispara em segundo plano — acompanhar pelo status(), não pelo retorno desta chamada. */
    rodar: (desde: string, limite?: number) =>
      request<{ message: string }>("/admin/vencimentos-sugeridos/rodar", {
        method: "POST",
        body: JSON.stringify({ desde, limite }),
      }),
    status: () =>
      request<{
        rodando: boolean;
        ultima: {
          desde: string;
          processados: number;
          sugestoes_criadas: number;
          confirmados: number;
          sem_vencimento: number;
          erros: number;
          segundos: number;
          em: string;
        } | null;
      }>("/admin/vencimentos-sugeridos/status"),
    aprovar: (id: string) =>
      request<{ ok: boolean }>(`/admin/vencimentos-sugeridos/${id}/aprovar`, { method: "POST" }),
    rejeitar: (id: string) =>
      request<{ ok: boolean }>(`/admin/vencimentos-sugeridos/${id}/rejeitar`, { method: "POST" }),
    /**
     * Recalcula pela REGRA o vencimento do núcleo (FGTS/DAS/DCTF Web) já gravado.
     * `aplicar=false` (padrão) só pré-visualiza; `aplicar=true` grava. Síncrono.
     */
    reaplicarRegra: (desde: string, aplicar: boolean) =>
      request<{
        desde: string;
        analisados: number;
        corrigidos: number;
        aplicado: boolean;
        mudancas: Array<{
          id: string;
          empresa: string;
          doc_type: string;
          competencia: string;
          title: string;
          de: string | null;
          para: string;
        }>;
      }>("/admin/vencimentos/reaplicar-regra", {
        method: "POST",
        body: JSON.stringify({ desde, aplicar }),
      }),
  },

  /** Controle de acessos (admin). `dias` filtra ranking/contagens (0/omitido = tudo). */
  acessos: {
    dados: (dias?: number) =>
      request<AcessosData>(`/admin/acessos${dias ? `?dias=${dias}` : ""}`),
  },

  /** Telemetria de uso do portal (cliente logado). Best-effort — nunca atrapalha a navegação. */
  portal: {
    registrarUso: (ferramenta: string) =>
      request<{ ok: boolean }>("/portal/uso", {
        method: "POST",
        body: JSON.stringify({ ferramenta }),
      }).catch(() => undefined),
  },

  admissoes: {
    lookup: (cnpj: string) =>
      publicRequest<{ encontrada: boolean; nome?: string }>(
        `/admissoes/lookup?cnpj=${encodeURIComponent(cnpj.replace(/\D/g, ""))}`,
      ),
    publicGet: (id: string, token: string) =>
      publicRequest<import("@/lib/admissionFicha").AdmissionDetail>(
        `/admissoes/public/${id}?token=${encodeURIComponent(token)}`,
      ),
    publicCreate: (body: Record<string, unknown>) =>
      publicRequest<import("@/lib/admissionFicha").AdmissionDetail>("/admissoes/public", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    publicUpdate: (id: string, body: Record<string, unknown>) =>
      publicRequest<import("@/lib/admissionFicha").AdmissionDetail>(`/admissoes/public/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    publicUpload: async (id: string, token: string, filesByKind: Partial<Record<string, File>>) => {
      const entries = Object.entries(filesByKind).filter(([, f]) => f);
      for (const [kind, file] of entries) {
        const form = new FormData();
        form.append("edit_token", token);
        form.append(kind, file as File);
        const res = await fetch(`${API_BASE}/admissoes/public/${id}/anexos`, { method: "POST", body: form });
        const data = await parseResponseJson<{ anexos: import("@/lib/admissionFicha").AdmissionAnexo[]; error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "Falha no anexo");
      }
      return { ok: true as const };
    },
    list: () => request<import("@/lib/admissionFicha").AdmissionListItem[]>("/admissoes"),
    get: (id: string) => request<import("@/lib/admissionFicha").AdmissionDetail>(`/admissoes/${id}`),
    create: (body: Record<string, unknown>) =>
      request<import("@/lib/admissionFicha").AdmissionDetail>("/admissoes", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, unknown>) =>
      request<import("@/lib/admissionFicha").AdmissionDetail>(`/admissoes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    upload: async (id: string, filesByKind: Partial<Record<string, File>>) => {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const entries = Object.entries(filesByKind).filter(([, f]) => f);
      for (const [kind, file] of entries) {
        const form = new FormData();
        form.append(kind, file as File);
        const res = await fetch(`${API_BASE}/admissoes/${id}/anexos`, { method: "POST", body: form, headers });
        const data = await parseResponseJson<{ anexos: import("@/lib/admissionFicha").AdmissionAnexo[]; error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "Falha no anexo");
      }
      return { ok: true as const };
    },
    anexoUrl: (id: string, anexoId: string) => `${API_BASE}/admissoes/${id}/anexos/${anexoId}/file`,
  },
};
