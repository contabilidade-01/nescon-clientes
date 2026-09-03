import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BellRing,
  Bot,
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
  KeyRound,
  Calculator,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Network,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { canSeeArea, mergeAdminAreas, type AdminArea } from "@/lib/adminAreas";
import { useGclickPendencias } from "@/hooks/useGclickPendencias";
import { GclickAlertaDialog } from "@/components/admin/GclickAlertaDialog";

/**
 * Painel do escritório dividido por área. Cada item é uma rota própria — nada de uma
 * página só com tudo empilhado. O menu lateral retrai para ícones (botão no topo ou
 * Ctrl/Cmd+B) e vira gaveta no celular.
 */
type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  /** Área exigida. Sem área = todo administrador vê. `owner` = só o dono. */
  area?: AdminArea;
  ownerOnly?: boolean;
  /** Mostra o número de pendências dos clientes do G-Click ao lado do item. */
  badgePendencias?: boolean;
  /** Mostra quantas mensagens de cliente esperam resposta (ver /atendimentos/unread). */
  badgeAtendimentos?: boolean;
};

const NAV_SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Geral",
    items: [{ to: "/admin", label: "Visão geral", icon: LayoutDashboard, end: true }],
  },
  {
    label: "Cadastro",
    items: [
      { to: "/admin/empresas", label: "Empresas", icon: Building2, area: "empresas" },
      { to: "/admin/grupos", label: "Grupos de empresas", icon: Network, area: "empresas" },
      {
        to: "/admin/enviar-acesso",
        label: "Enviar acesso (WhatsApp)",
        icon: Send,
        area: "empresas",
      },
      {
        to: "/admin/clientes-gclick",
        label: "Clientes do G-Click",
        icon: UserPlus,
        ownerOnly: true,
        badgePendencias: true,
      },
      { to: "/admin/funcionarios", label: "Funcionários", icon: Users, area: "funcionarios" },
      { to: "/admin/admissoes", label: "Admissões", icon: UserPlus, area: "funcionarios" },
      { to: "/admin/folha", label: "Painel de folha", icon: CircleDollarSign, area: "funcionarios" },
      { to: "/admin/honorarios-queijeiro", label: "Honorários Queijeiro", icon: Calculator, area: "funcionarios" },
      { to: "/admin/ferias-lote", label: "Upload de férias (lote)", icon: FileUp, area: "funcionarios" },
      { to: "/admin/ferias-urgencia", label: "Férias — Urgência", icon: AlertTriangle, area: "funcionarios" },
    ],
  },
  {
    label: "Entregas",
    items: [
      { to: "/admin/entregas", label: "Documentos e entregas", icon: FileCheck2, area: "entregas" },
      { to: "/admin/envio-folha", label: "Envio de folha e encargos", icon: ClipboardCheck, area: "entregas" },
      { to: "/admin/documentos", label: "Gestão de documentos", icon: FileText, area: "entregas" },
      { to: "/admin/doc-upload", label: "Upload de documentos", icon: Upload, area: "entregas" },
      { to: "/admin/envio-guias", label: "Envio de guias", icon: Send, area: "envio_guias" },
      { to: "/admin/alertas", label: "Alertas de vencimento", icon: BellRing, area: "alertas" },
      { to: "/admin/whatsapp", label: "Conexão do WhatsApp", icon: MessageCircle, area: "alertas" },
      { to: "/admin/vencimentos-sugeridos", label: "Vencimentos sugeridos", icon: CalendarSearch, area: "entregas" },
      { to: "/admin/config-ia", label: "Configuração de IA", icon: Bot, area: "entregas" },
      { to: "/admin/acompanhamentos", label: "Acompanhamentos mensais", icon: CalendarClock, area: "acompanhamentos" },
    ],
  },
  {
    label: "Licenças e taxas",
    items: [
      { to: "/admin/licencas", label: "Licenças", icon: ShieldCheck, area: "licencas" },
      { to: "/admin/taxas-anuais", label: "Taxas anuais", icon: CalendarCheck, area: "taxas_anuais" },
    ],
  },
  {
    label: "Conformidade",
    items: [
      { to: "/admin/lgpd", label: "Consentimentos LGPD", icon: ShieldCheck, area: "lgpd" },
      {
        to: "/admin/atendimentos",
        label: "Atendimentos",
        icon: MessageCircle,
        area: "atendimento",
        badgeAtendimentos: true,
      },
      { to: "/admin/acessos", label: "Controle de acessos", icon: Activity, area: "acessos" },
      { to: "/admin/sincronizacao", label: "Sincronização", icon: RefreshCw, area: "sincronizacao" },
      { to: "/admin/boletos-cora", label: "Boletos Cora", icon: Receipt, area: "sincronizacao" },
      { to: "/admin/usuarios", label: "Usuários do painel", icon: UserCog, ownerOnly: true },
    ],
  },
];

function formatCpf(cpf?: string) {
  if (!cpf) return "";
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export function AdminLayout({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const { admin, logout, login } = useAuth();
  const { pathname } = useLocation();
  const { total: pendenciasGclick } = useGclickPendencias();

  // Mensagens de cliente esperando resposta. O servidor já devolve só o que ESTE
  // usuário pode ver (fila + as dele), então o número no menu nunca denuncia
  // conversa de colega. Sem badge, só se descobre mensagem nova abrindo a tela.
  const { data: naoLidas } = useQuery({
    queryKey: ["admin-atendimentos-unread"],
    queryFn: () => api.atendimentos.unread(),
    enabled: Boolean(admin?.token),
    refetchInterval: 60_000,
  });
  const atendimentosNaoLidos = naoLidas?.count ?? 0;

  // Permissões podem ter mudado desde o login: o painel busca as atuais e atualiza a
  // sessão. Quem manda de verdade é o servidor; isto só mantém o menu honesto.
  const { data: perfil } = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => api.admin.me(),
    enabled: Boolean(admin?.token),
  });

  useEffect(() => {
    if (!perfil || !admin) return;
    const areas = mergeAdminAreas(perfil.areas ?? null);
    const mudou =
      Boolean(perfil.is_owner) !== Boolean(admin.isOwner) ||
      JSON.stringify(areas) !== JSON.stringify(admin.areas ?? null) ||
      (perfil.nome ?? null) !== (admin.nome ?? null);
    if (mudou) {
      login({ ...admin, nome: perfil.nome ?? null, isOwner: Boolean(perfil.is_owner), areas });
    }
  }, [perfil, admin, login]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const podeVer = (item: NavItem) => {
    if (item.ownerOnly) return Boolean(admin?.isOwner);
    if (!item.area) return true;
    return canSeeArea(item.area, admin?.areas, admin?.isOwner);
  };

  const secoesVisiveis = NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter(podeVer),
  })).filter((s) => s.items.length > 0);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LayoutDashboard className="h-4 w-4" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-semibold leading-tight">
                {admin?.nome || "Painel Nescon"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                CPF {formatCpf(admin?.cpf)}
              </p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          {secoesVisiveis.map((section) => (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    const ativo = item.end ? pathname === item.to : pathname.startsWith(item.to);
                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton asChild isActive={ativo} tooltip={item.label}>
                          <NavLink to={item.to} end={item.end}>
                            <item.icon />
                            <span>{item.label}</span>
                          </NavLink>
                        </SidebarMenuButton>
                        {item.badgePendencias && pendenciasGclick > 0 && (
                          <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
                            {pendenciasGclick}
                          </SidebarMenuBadge>
                        )}
                        {item.badgeAtendimentos && atendimentosNaoLidos > 0 && (
                          <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
                            {atendimentosNaoLidos}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => navigate("/alterar-senha")} tooltip="Alterar senha">
                <KeyRound />
                <span>Alterar senha</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleLogout} tooltip="Sair">
                <LogOut />
                <span>Sair</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      {/* min-w-0: sem isto o inset é um flex item com min-width auto e NÃO encolhe
          abaixo do conteúdo mais largo — um e-mail comprido empurrava a página toda
          para a direita no celular. */}
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/85 px-4 py-3 backdrop-blur">
          <SidebarTrigger />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold leading-tight sm:text-lg">{title}</h1>
            {description && (
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout} className="hidden sm:inline-flex">
            Sair
          </Button>
        </header>
        <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
          {/* Aviso de entrada: abre uma vez por sessão em qualquer página do painel. */}
          <GclickAlertaDialog />
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
