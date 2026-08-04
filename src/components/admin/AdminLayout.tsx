import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  CalendarCheck,
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

/**
 * Painel do escritório dividido por área. Cada item é uma rota própria — nada de uma
 * página só com tudo empilhado. O menu lateral retrai para ícones (botão no topo ou
 * Ctrl/Cmd+B) e vira gaveta no celular.
 */
type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean };

const NAV_SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Geral",
    items: [{ to: "/admin", label: "Visão geral", icon: LayoutDashboard, end: true }],
  },
  {
    label: "Cadastro",
    items: [
      { to: "/admin/empresas", label: "Empresas", icon: Building2 },
      { to: "/admin/funcionarios", label: "Funcionários", icon: Users },
    ],
  },
  {
    label: "Entregas",
    items: [
      { to: "/admin/entregas", label: "Documentos e entregas", icon: FileCheck2 },
      { to: "/admin/envio-guias", label: "Envio de guias", icon: Send },
    ],
  },
  {
    label: "Licenças e taxas",
    items: [
      { to: "/admin/licencas", label: "Licenças", icon: ShieldCheck },
      { to: "/admin/taxas-anuais", label: "Taxas anuais", icon: CalendarCheck },
    ],
  },
  {
    label: "Conformidade",
    items: [
      { to: "/admin/lgpd", label: "Consentimentos LGPD", icon: ShieldCheck },
      { to: "/admin/sincronizacao", label: "Sincronização", icon: RefreshCw },
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
  const { admin, logout } = useAuth();
  const { pathname } = useLocation();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LayoutDashboard className="h-4 w-4" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-semibold leading-tight">Painel Nescon</p>
              <p className="truncate text-xs text-muted-foreground">
                CPF {formatCpf(admin?.cpf)}
              </p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          {NAV_SECTIONS.map((section) => (
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

      <SidebarInset>
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
        <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
