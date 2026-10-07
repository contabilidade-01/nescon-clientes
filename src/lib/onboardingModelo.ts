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

export type OnboardingModelo = {
  id: string;
  nome: string;
  descricao: string;
  regras: Record<string, unknown>;
  blocos: Array<Record<string, unknown>>;
  ordem: number;
  ativo: boolean;
};

/** 'YYYY-MM-DD' -> 'DD/MM/AAAA' sem passar por Date (fuso). */
export function dataBR(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
