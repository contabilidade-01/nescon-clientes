import {
  AlertTriangle,
  Barcode,
  Bot,
  Calculator,
  CalendarDays,
  CalendarRange,
  CircleDollarSign,
  ClipboardList,
  FileBadge,
  FileText,
  FileX,
  FolderOpen,
  History,
  MessageSquare,
  Palmtree,
  Receipt,
  Scale,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { isToolAllowed, type CompanyToolAccess, type CompanyToolKey } from "@/lib/companyTools";

/**
 * Mapa do portal do cliente, por setor. Única fonte do Início (hub), das telas de setor
 * (/setor/:id), da barra inferior e do botão "+": mudar um item aqui muda todos.
 *
 * Setor é só agrupamento de tela — NÃO é permissão. Quem decide o que cada empresa vê
 * continua sendo `tool` (o tool_access da empresa) e o servidor, em cada rota.
 * As rotas não mudam: links de e-mail e WhatsApp continuam abrindo a mesma tela.
 */
export type PortalItem = {
  key: string;
  path: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Ferramenta exigida. Sem ferramenta = toda empresa vê (menos gerente, se marcado). */
  tool?: CompanyToolKey;
  /** Some do login de gerente (que só emite advertência e suspensão). */
  naoGerente?: boolean;
  /** Só para empresa com funcionário celetista (férias). */
  exigeFuncionarios?: boolean;
};

export type PortalSetorId = "financeiro" | "documentos" | "dp";

export type PortalSetor = {
  id: PortalSetorId;
  label: string;
  /** Rótulo curto da barra inferior. */
  curto: string;
  descricao: string;
  icon: LucideIcon;
  items: PortalItem[];
};

export const PORTAL_SETORES: PortalSetor[] = [
  {
    id: "financeiro",
    label: "Financeiro",
    curto: "Financeiro",
    descricao: "O que vence e quando pagar.",
    icon: Wallet,
    items: [
      { key: "calendar", tool: "calendar", path: "/calendario", icon: CalendarDays,
        title: "Calendário", description: "Tudo do mês num só lugar" },
      { key: "upcoming", tool: "calendar", path: "/proximos-pagamentos", icon: Wallet,
        title: "Próximos pagamentos", description: "Atrasados e próximos" },
      { key: "fiscal_guides", tool: "fiscal_guides", path: "/guias", icon: Receipt,
        title: "Guias fiscais", description: "Impostos e contribuições" },
      { key: "impostos_pendentes", tool: "impostos_ecac", path: "/impostos-pendentes", icon: AlertTriangle,
        title: "Impostos em aberto", description: "O que consta na Receita e a guia atualizada" },
      { key: "boletos", tool: "boletos", path: "/boletos", icon: Barcode,
        title: "Boletos", description: "Honorários e boletos a pagar" },
      { key: "regime", tool: "regime_tributario", path: "/regime", icon: Scale,
        title: "Simulador de regime", description: "Simples puro ou IBS/CBS por fora" },
    ],
  },
  {
    id: "documentos",
    label: "Meus documentos",
    curto: "Documentos",
    descricao: "Recebidos e gerados com a contabilidade.",
    icon: FolderOpen,
    items: [
      { key: "documents", tool: "documents", path: "/documentos", icon: FolderOpen,
        title: "Recebidos", description: "Contratos e relatórios que o escritório enviou" },
      { key: "payroll_files", tool: "payroll_files", path: "/folha", icon: FileText,
        title: "Folha de pagamento", description: "Extratos e recibos mensais" },
      { key: "custo_folha", tool: "payroll_files", path: "/custo-folha", icon: CircleDollarSign,
        title: "Custo de folha", description: "Quanto custou por mês e a projeção do 13º" },
      { key: "certificado_digital", path: "/certificado-digital", icon: FileBadge, naoGerente: true,
        title: "Certificado digital", description: "Validade e aviso de vencimento" },
      { key: "history", tool: "history", path: "/historico", icon: History,
        title: "Histórico", description: "Advertências, suspensões e atestados gerados" },
    ],
  },
  {
    id: "dp",
    label: "Departamento Pessoal",
    curto: "DP",
    descricao: "Sua equipe, da admissão às férias.",
    icon: Users,
    items: [
      { key: "employees", tool: "employees", path: "/funcionarios", icon: Users,
        title: "Funcionários", description: "Quadro ativo e inativos" },
      { key: "admissao", path: "/admissao", icon: UserPlus, naoGerente: true,
        title: "Ficha de admissão", description: "Cadastrar funcionário novo" },
      { key: "vacations", tool: "vacations", path: "/ferias", icon: Palmtree, exigeFuncionarios: true,
        title: "Férias", description: "Quem tem direito, custo e faltas" },
      { key: "certificates", tool: "certificates", path: "/atestados", icon: ClipboardList,
        title: "Atestados", description: "Enviar e consultar atestados" },
      { key: "warning", tool: "warning", path: "/advertencia", icon: AlertTriangle,
        title: "Advertência", description: "Gerar advertência formal" },
      { key: "suspension", tool: "suspension", path: "/suspensao", icon: FileX,
        title: "Suspensão", description: "Gerar suspensão formal" },
      { key: "salary_adhoc", tool: "salary_adhoc", path: "/salario-avulso", icon: Calculator,
        title: "Salário avulso", description: "Pagamento fora da folha" },
      { key: "escalas", tool: "escalas", path: "/escalas", icon: CalendarRange,
        title: "Escalas de trabalho", description: "Planejador de escalas" },
      { key: "chatbot", tool: "chatbot", path: "/chatbot", icon: Bot,
        title: "Assistente do DP", description: "Tire dúvidas do dia a dia" },
      { key: "gerentes", path: "/gerentes", icon: UserCog, naoGerente: true,
        title: "Gerentes", description: "Acessos só para advertência e suspensão" },
    ],
  },
];

export const ITEM_CHAT: PortalItem = {
  key: "chat",
  tool: "chat",
  path: "/mensagens",
  icon: MessageSquare,
  title: "Mensagens",
  description: "Fale com o escritório",
};

/** Botão "+": ações rápidas, na ordem em que aparecem. */
export const ACOES_RAPIDAS = ["admissao", "warning", "suspension", "certificates", "chat"];

/** Atalhos do Início: os quatro primeiros desta lista que a empresa pode ver. */
export const ATALHOS_INICIO = [
  "fiscal_guides",
  "documents",
  "payroll_files",
  "vacations",
  "boletos",
  "calendar",
  "employees",
  "certificado_digital",
];

export type QuemPortal =
  | { toolAccess?: CompanyToolAccess; gerente?: unknown; temFuncionarios?: boolean }
  | null
  | undefined;

export function podeVerItemPortal(item: PortalItem, quem: QuemPortal): boolean {
  if (!quem) return false;
  const gerente = Boolean(quem.gerente);
  if (item.naoGerente && gerente) return false;
  if (item.tool && !isToolAllowed(quem.toolAccess, item.tool)) return false;
  // Gerente: o servidor já reduz o tool_access; sem ferramenta própria, nada além dela.
  if (!item.tool && gerente) return false;
  if (item.exigeFuncionarios && quem.temFuncionarios === false) return false;
  return true;
}

/** Setores com os itens que esta empresa pode ver; setor sem item visível some. */
export function setoresVisiveisPortal(quem: QuemPortal): PortalSetor[] {
  return PORTAL_SETORES.map((s) => ({
    ...s,
    items: s.items.filter((i) => podeVerItemPortal(i, quem)),
  })).filter((s) => s.items.length > 0);
}

const TODOS_ITENS: PortalItem[] = [...PORTAL_SETORES.flatMap((s) => s.items), ITEM_CHAT];

export function itemPorChave(key: string): PortalItem | undefined {
  return TODOS_ITENS.find((i) => i.key === key);
}

/** Itens de uma lista de chaves que esta empresa pode ver, na ordem da lista. */
export function itensPorChaves(keys: string[], quem: QuemPortal, limite?: number): PortalItem[] {
  const out = keys
    .map(itemPorChave)
    .filter((i): i is PortalItem => Boolean(i) && podeVerItemPortal(i!, quem));
  return limite ? out.slice(0, limite) : out;
}

export function setorPorId(id: string | undefined): PortalSetor | undefined {
  return PORTAL_SETORES.find((s) => s.id === id);
}

/** Setor da rota atual (tela de setor ou tela de um item dele), ou null. */
export function setorDoCaminhoPortal(pathname: string): PortalSetorId | null {
  const m = /^\/setor\/([a-z]+)/.exec(pathname);
  if (m && setorPorId(m[1])) return m[1] as PortalSetorId;
  for (const s of PORTAL_SETORES) {
    for (const i of s.items) {
      if (pathname === i.path || pathname.startsWith(`${i.path}/`)) return s.id;
    }
  }
  return null;
}
