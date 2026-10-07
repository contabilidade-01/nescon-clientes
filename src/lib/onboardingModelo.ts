/**
 * Tipos e rótulos do onboarding no navegador. A lógica (qual modelo, que datas) vive no
 * servidor — api/src/onboardingRegras.js — para ser uma só.
 */
export type OnboardingStatus = "aguardando" | "em_andamento" | "em_analise" | "concluido";
export type OnboardingOrigem = "contrato_auto" | "contrato_manual" | "proposta" | "empresa" | "manual";
export type EnvioStatus = "enviado" | "aprovado" | "reprovado";
export type TipoBloco = "boas_vindas" | "etapa" | "documento" | "prazo_recorrente" | "contato" | "marco";

export const STATUS_LABEL: Record<OnboardingStatus, string> = {
  aguardando: "Aguardando documentos",
  em_andamento: "Em andamento",
  em_analise: "Em análise",
  concluido: "Concluído",
};

export const ORIGEM_LABEL: Record<OnboardingOrigem, string> = {
  contrato_auto: "Contrato assinado (automático)",
  contrato_manual: "Contrato (manual)",
  proposta: "Proposta",
  empresa: "Empresa cadastrada",
  manual: "Manual",
};

export type OnboardingItem = {
  id: string;
  tipo: TipoBloco;
  titulo: string;
  descricao: string;
  obrigatorio?: boolean;
  formatos?: string[];
  comoEnviar?: string;
  exemploUrl?: string;
  prazoData?: string | null;
  regra?: string;
  contato?: string;
  envio?: { status: EnvioStatus; observacao: string; arquivo: string; em: string };
};

/** O que o cliente vê no link público. */
export type OnboardingCliente = {
  cliente_nome: string;
  status: OnboardingStatus;
  itens: OnboardingItem[];
  progresso: { enviados: number; total: number };
};

export type OnboardingResumo = {
  id: string;
  contrato_id: string | null;
  proposta_id: string | null;
  origem: OnboardingOrigem;
  company_id: string | null;
  company_name: string | null;
  cliente_nome: string;
  cliente_email: string;
  status: OnboardingStatus;
  assinado_em: string | null;
  inicio_em: string | null;
  enviado_em: string | null;
  concluido_em: string | null;
  link: string | null;
  docs_total: number;
  docs_enviados?: number;
  docs_aprovados?: number;
  atrasados?: number;
};

export type OnboardingDetalhe = OnboardingResumo & {
  itens: OnboardingItem[];
  arquivos: Array<{ id: string; item_id: string; file_name: string; status: EnvioStatus; observacao: string; created_at: string }>;
  eventos: Array<{ tipo: string; detalhe: string; created_at: string }>;
};

/** Para quais contratos um modelo (ou um bloco, em `condicao`) vale. Critério ausente = não restringe. */
export type Regras = {
  areas?: Array<"contabil" | "fiscal" | "pessoal">;
  enquadramento?: Array<"mei" | "simples" | "presumido" | "real">;
  tipoEmpresa?: Array<"servico" | "comercio" | "industria">;
  comFuncionarios?: boolean;
};

export type Prazo = { ref: "assinatura" | "inicio"; dias: number; uteis: boolean };

/** Bloco como o construtor edita. `uid` só existe no navegador (chave do arrastar e soltar). */
export type Bloco = {
  uid?: string;
  tipo: TipoBloco;
  titulo: string;
  descricao: string;
  obrigatorio?: boolean;
  formatos?: string[];
  comoEnviar?: string;
  exemploUrl?: string;
  prazo?: Prazo;
  regra?: string;
  contato?: string;
  condicao?: Regras;
};

export type ModeloEntrada = {
  nome: string;
  descricao: string;
  regras: Regras;
  blocos: Bloco[];
  ativo?: boolean;
};

export type OnboardingModelo = {
  id: string;
  nome: string;
  descricao: string;
  regras: Regras;
  blocos: Bloco[];
  ordem: number;
  ativo: boolean;
};

export type RespostaAgente = {
  mensagem: string;
  modelo: ModeloEntrada | null;
  faltando: string[];
  pronto: boolean;
};

export type ResultadoLembretes = {
  onboardings: number;
  lembretes: number;
  enviados: number;
  falhas: number;
  detalhes: Array<{ cliente: string; itens: string[]; email: string; enviado: boolean }>;
};

export const TIPO_BLOCO_LABEL: Record<TipoBloco, string> = {
  boas_vindas: "Boas-vindas",
  etapa: "Passo",
  documento: "Documento",
  prazo_recorrente: "Rotina do mês",
  contato: "Atendimento",
  marco: "Marco",
};

export const TIPO_BLOCO_AJUDA: Record<TipoBloco, string> = {
  boas_vindas: "Texto de abertura da página do cliente",
  etapa: "Algo a fazer, sem enviar arquivo",
  documento: "O cliente envia um arquivo, com prazo",
  prazo_recorrente: "Regra que se repete todo mês",
  contato: "Quem atende e como falar",
  marco: "Primeira vitória, com data prevista",
};

let contador = 0;
/** Identificador local de um bloco (não vai para o servidor). */
export function novoUid(): string {
  contador += 1;
  return `b${Date.now().toString(36)}${contador}`;
}

/** Bloco novo, já com os padrões que o servidor esperaria. */
export function blocoVazio(tipo: TipoBloco): Bloco {
  const base: Bloco = { uid: novoUid(), tipo, titulo: "", descricao: "" };
  if (tipo === "documento") return { ...base, obrigatorio: true, formatos: [], comoEnviar: "", prazo: { ref: "assinatura", dias: 5, uteis: true } };
  if (tipo === "marco") return { ...base, prazo: { ref: "inicio", dias: 30, uteis: false } };
  if (tipo === "prazo_recorrente") return { ...base, regra: "" };
  if (tipo === "contato") return { ...base, contato: "" };
  return base;
}

/** Garante `uid` em cada bloco (modelos vindos do servidor não o têm). */
export function comUids(blocos: Bloco[]): Bloco[] {
  return (blocos || []).map((b) => ({ ...b, uid: b.uid || novoUid() }));
}

/** Tira o `uid` antes de enviar ao servidor. */
export function semUids(blocos: Bloco[]): Bloco[] {
  return blocos.map(({ uid: _uid, ...resto }) => resto);
}

/** Resumo legível das regras de um modelo: "Simples · contábil + fiscal · com funcionários". */
export function resumoRegras(r: Regras | undefined | null): string {
  if (!r) return "Qualquer contrato";
  const partes: string[] = [];
  if (r.enquadramento?.length) partes.push(r.enquadramento.map((e) => ({ mei: "MEI", simples: "Simples", presumido: "Presumido", real: "Real" })[e]).join("/"));
  if (r.tipoEmpresa?.length) partes.push(r.tipoEmpresa.map((t) => ({ servico: "serviço", comercio: "comércio", industria: "indústria" })[t]).join("/"));
  if (r.areas?.length) partes.push(r.areas.join(" + "));
  if (r.comFuncionarios === true) partes.push("com funcionários");
  if (r.comFuncionarios === false) partes.push("sem funcionários");
  return partes.length ? partes.join(" · ") : "Qualquer contrato";
}

/** 'YYYY-MM-DD' -> 'DD/MM/AAAA' sem passar por Date (fuso). */
export function dataBR(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
