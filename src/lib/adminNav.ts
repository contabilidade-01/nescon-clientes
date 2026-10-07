import {
  Activity,
  AlertTriangle,
  BellRing,
  Bot,
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarSearch,
  CircleDollarSign,
  UserCog,
  UserPlus,
  FileCheck2,
  FileText,
  FileUp,
  Landmark,
  Calculator,
  ClipboardCheck,
  LayoutDashboard,
  MessageCircle,
  Megaphone,
  Network,
  Receipt,
  RefreshCw,
  Scale,
  FileSignature,
  Send,
  ShieldCheck,
  Upload,
  Users,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { canSeeArea, type AdminArea } from "@/lib/adminAreas";

/**
 * Mapa do painel do escritório, por setor. É a única fonte do menu lateral e do hub
 * (/admin/hub): mudar um item aqui muda os dois.
 *
 * Setor é só agrupamento de tela — NÃO é permissão. Quem decide o que cada pessoa vê
 * continua sendo `area`/`ownerOnly` de cada item (e o servidor, em cada rota). Um setor
 * aparece se a pessoa pode ver pelo menos um item dele. Por isso não existe área
 * "comercial": criar uma tiraria o acesso de quem já tem permissões salvas.
 *
 * As rotas /admin/* não mudam: links de e-mail e favoritos antigos continuam valendo.
 */
export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Área exigida. Sem área = todo administrador vê. */
  area?: AdminArea;
  ownerOnly?: boolean;
  /** Mostra o número de pendências dos clientes do G-Click ao lado do item. */
  badgePendencias?: boolean;
  /** Mostra quantas mensagens de cliente esperam resposta (ver /atendimentos/unread). */
  badgeAtendimentos?: boolean;
};

export type Setor = {
  id: string;
  label: string;
  descricao: string;
  icon: LucideIcon;
  items: NavItem[];
};

export const HUB_PATH = "/admin/hub";

export const ITEM_VISAO_GERAL: NavItem = {
  to: "/admin",
  label: "Visão geral",
  icon: LayoutDashboard,
  end: true,
};

export const SETORES: Setor[] = [
  {
    id: "comercial",
    label: "Comercial",
    descricao: "Da proposta à assinatura e à implantação do cliente novo.",
    icon: Briefcase,
    items: [
      { to: "/admin/propostas", label: "Propostas", icon: FileText, area: "empresas" },
      { to: "/admin/contratos", label: "Contratos", icon: FileSignature, area: "empresas" },
      {
        to: "/admin/clientes-gclick",
        label: "Clientes do G-Click",
        icon: UserPlus,
        ownerOnly: true,
        badgePendencias: true,
      },
    ],
  },
  {
    id: "clientes-dp",
    label: "Departamento Pessoal e clientes",
    descricao: "Cadastro das empresas, funcionários, admissões, folha, férias e honorários.",
    icon: Users,
    items: [
      { to: "/admin/empresas", label: "Empresas", icon: Building2, area: "empresas" },
      { to: "/admin/grupos", label: "Grupos de empresas", icon: Network, area: "empresas" },
      { to: "/admin/enviar-acesso", label: "Enviar acesso (WhatsApp)", icon: Send, area: "empresas" },
      { to: "/admin/funcionarios", label: "Funcionários", icon: Users, area: "funcionarios" },
      { to: "/admin/admissoes", label: "Admissões", icon: UserPlus, area: "funcionarios" },
      { to: "/admin/folha", label: "Painel de folha", icon: CircleDollarSign, area: "funcionarios" },
      { to: "/admin/honorarios-queijeiro", label: "Honorários (folha)", icon: Calculator, area: "funcionarios" },
      { to: "/admin/honorarios-atualizacao", label: "Atualização de Honorários", icon: Scale, area: "funcionarios" },
      { to: "/admin/ferias-lote", label: "Upload de férias (lote)", icon: FileUp, area: "funcionarios" },
      { to: "/admin/ferias-urgencia", label: "Férias — Urgência", icon: AlertTriangle, area: "funcionarios" },
      { to: "/admin/acompanhamentos", label: "Acompanhamentos mensais", icon: CalendarClock, area: "acompanhamentos" },
    ],
  },
  {
    id: "entregas",
    label: "Entregas e documentos",
    descricao: "Documentos que o escritório entrega ao cliente e a leitura automática deles.",
    icon: FileCheck2,
    items: [
      { to: "/admin/entregas", label: "Documentos e entregas", icon: FileCheck2, area: "entregas" },
      { to: "/admin/envio-folha", label: "Envio de folha e encargos", icon: ClipboardCheck, area: "entregas" },
      { to: "/admin/documentos", label: "Gestão de documentos", icon: FileText, area: "entregas" },
      { to: "/admin/doc-upload", label: "Upload de documentos", icon: Upload, area: "entregas" },
      { to: "/admin/vencimentos-sugeridos", label: "Vencimentos sugeridos", icon: CalendarSearch, area: "entregas" },
      { to: "/admin/config-ia", label: "Configuração de IA", icon: Bot, area: "entregas" },
    ],
  },
  {
    id: "fiscal",
    label: "Fiscal e alertas",
    descricao: "Avisos de vencimento, cobrança do e-CAC, licenças e taxas anuais.",
    icon: BellRing,
    items: [
      { to: "/admin/alertas", label: "Alertas de vencimento", icon: BellRing, area: "alertas" },
      { to: "/admin/whatsapp", label: "Conexão do WhatsApp", icon: MessageCircle, area: "alertas" },
      { to: "/admin/circular", label: "Circular (WhatsApp)", icon: Megaphone, area: "alertas" },
      { to: "/admin/impostos-ecac", label: "Impostos e-CAC (cobrança)", icon: Landmark, area: "alertas" },
      { to: "/admin/licencas", label: "Licenças", icon: ShieldCheck, area: "licencas" },
      { to: "/admin/taxas-anuais", label: "Taxas anuais", icon: CalendarCheck, area: "taxas_anuais" },
    ],
  },
  {
    id: "sistema",
    label: "Atendimento e sistema",
    descricao: "Atendimentos, LGPD, acessos, sincronizações, boletos e usuários do painel.",
    icon: Settings2,
    items: [
      {
        to: "/admin/atendimentos",
        label: "Atendimentos",
        icon: MessageCircle,
        area: "atendimento",
        badgeAtendimentos: true,
      },
      { to: "/admin/lgpd", label: "Consentimentos LGPD", icon: ShieldCheck, area: "lgpd" },
      { to: "/admin/acessos", label: "Controle de acessos", icon: Activity, area: "acessos" },
      { to: "/admin/sincronizacao", label: "Sincronização", icon: RefreshCw, area: "sincronizacao" },
      { to: "/admin/boletos-cora", label: "Boletos Cora", icon: Receipt, area: "sincronizacao" },
      { to: "/admin/usuarios", label: "Usuários do painel", icon: UserCog, ownerOnly: true },
    ],
  },
];

type Quem = { areas?: Parameters<typeof canSeeArea>[1]; isOwner?: boolean } | null | undefined;

export function podeVerItem(item: NavItem, quem: Quem): boolean {
  if (item.ownerOnly) return Boolean(quem?.isOwner);
  if (!item.area) return true;
  return canSeeArea(item.area, quem?.areas, quem?.isOwner);
}

/** Setores com os itens que esta pessoa pode ver; setor sem item visível some. */
export function setoresVisiveis(quem: Quem): Setor[] {
  return SETORES.map((s) => ({ ...s, items: s.items.filter((i) => podeVerItem(i, quem)) })).filter(
    (s) => s.items.length > 0
  );
}

/**
 * Setor da rota atual, ou null (hub, Visão geral, rota fora do mapa). Casa pelo prefixo
 * com fronteira — "/admin/folha" não pode pegar "/admin/folha-x" de outro setor.
 */
export function setorDoCaminho(pathname: string): Setor | null {
  for (const s of SETORES) {
    for (const i of s.items) {
      if (pathname === i.to || pathname.startsWith(`${i.to}/`)) return s;
    }
  }
  return null;
}
