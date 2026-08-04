import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  CalendarCheck,
  UserCog,
  UserPlus,
  FileCheck2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Send,
  ShieldCheck,
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
      {
        to: "/admin/clientes-gclick",
        label: "Clientes do G-Click",
        icon: UserPlus,
        area: "empresas",
        badgePendencias: true,
      },
      { to: "/admin/funcionarios", label: "Funcionários", icon: Users, area: "funcionarios" },
    ],
  },
  {
    label: "Entregas",
    items: [
      { to: "/admin/entregas", label: "Documentos e entregas", icon: FileCheck2, area: "entregas" },
      { to: "/admin/envio-guias", label: "Envio de guias", icon: Send, area: "envio_guias" },
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
      { to: "/admin/sincronizacao", label: "Sincronização", icon: RefreshCw, area: "sincronizacao" },
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
