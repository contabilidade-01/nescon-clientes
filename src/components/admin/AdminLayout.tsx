import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { KeyRound, LayoutDashboard, LayoutGrid, LogOut } from "lucide-react";
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
import { mergeAdminAreas } from "@/lib/adminAreas";
import {
  HUB_PATH,
  ITEM_VISAO_GERAL,
  setorDoCaminho,
  setoresVisiveis,
  type NavItem,
} from "@/lib/adminNav";
import { useGclickPendencias } from "@/hooks/useGclickPendencias";
import { GclickAlertaDialog } from "@/components/admin/GclickAlertaDialog";

/**
 * Painel do escritório dividido por setor (mapa em src/lib/adminNav.ts, o mesmo do hub).
 * Cada item é uma rota própria. Dentro de um setor o menu mostra só as páginas dele; no
 * hub, na Visão geral e em rota fora do mapa mostra todos os setores, como era antes.
 * O menu lateral retrai para ícones (botão no topo ou Ctrl/Cmd+B) e vira gaveta no celular.
 */
const ITEM_HUB: NavItem = { to: HUB_PATH, label: "Setores (início)", icon: LayoutGrid };

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

  const setorAtual = setorDoCaminho(pathname);
  const todos = setoresVisiveis(admin);
  // Dentro de um setor: só o dele. Fora de qualquer setor: todos, como antes do hub.
  const setoresNoMenu = setorAtual ? todos.filter((x) => x.id === setorAtual.id) : todos;
  const secoesVisiveis: Array<{ label: string; items: NavItem[] }> = [
    { label: "Geral", items: [ITEM_HUB, ITEM_VISAO_GERAL] },
    ...setoresNoMenu.map((x) => ({ label: x.label, items: x.items })),
  ];

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
                    const ativo = item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
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
