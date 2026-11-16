import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Home, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LinhaSetor } from "@/components/hub/Hub";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { isToolAllowed } from "@/lib/companyTools";
import {
  ACOES_RAPIDAS,
  ITEM_CHAT,
  itensPorChaves,
  setorDoCaminhoPortal,
  setoresVisiveisPortal,
  type PortalItem,
} from "@/lib/portalNav";
import { cn } from "@/lib/utils";

/** Telas fora do portal logado: sem barra. */
const FORA = [/^\/login/, /^\/forgot-password/, /^\/reset-password/, /^\/manutencao/, /^\/entrega\//, /^\/g\//, /^\/onboarding\//, /^\/calculadora-custo/, /^\/alterar-senha/, /^\/admin/];

/**
 * Barra inferior do portal (celular): Início, setores, botão "+" e Chat. No computador
 * some — lá o Início mostra os setores em cartões. Monta uma vez, em App, e aparece em
 * toda tela do cliente logado.
 */
export function PortalBottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { company, isAdmin } = useAuth();
  const [maisAberto, setMaisAberto] = useState(false);

  const ativo = Boolean(company) && !isAdmin && !company?.mustChangePassword && !FORA.some((r) => r.test(pathname));

  const podeChat = ativo && isToolAllowed(company?.toolAccess, "chat") && !company?.gerente;
  const { data: chatUnread } = useQuery({
    queryKey: ["chat-unread"],
    queryFn: () => api.chat.unread(),
    enabled: podeChat,
    refetchInterval: 60_000,
  });

  // Espaço para a barra fixa não cobrir o fim das telas (só no celular).
  useEffect(() => {
    document.body.classList.toggle("com-barra-portal", ativo);
    return () => document.body.classList.remove("com-barra-portal");
  }, [ativo]);

  if (!ativo) return null;

  const setores = setoresVisiveisPortal(company);
  // Documentos entra pelos atalhos do Início; a barra fica com Financeiro e DP.
  const naBarra = setores.filter((s) => s.id !== "documentos");
  const acoes = itensPorChaves(ACOES_RAPIDAS, company);
  const setorAtual = setorDoCaminhoPortal(pathname);

  const abrir = (item: PortalItem) => {
    setMaisAberto(false);
    if (item.tool) api.portal.registrarUso(item.tool);
    navigate(item.path);
  };

  const botoes: Array<{ id: string; label: string; icon: typeof Home; to: string; badge?: number; atual: boolean }> = [
    { id: "inicio", label: "Início", icon: Home, to: "/", atual: pathname === "/" || setorAtual === "documentos" },
    ...naBarra.map((s) => ({ id: s.id, label: s.curto, icon: s.icon, to: `/setor/${s.id}`, atual: setorAtual === s.id })),
  ];
  if (podeChat) {
    botoes.push({ id: "chat", label: "Chat", icon: ITEM_CHAT.icon, to: "/mensagens", badge: chatUnread?.count ?? 0, atual: pathname.startsWith("/mensagens") });
  }
  // O "+" fica no meio quando há ações; com poucos botões, no fim.
  const meio = Math.ceil(botoes.length / 2);

  const Botao = (b: (typeof botoes)[number]) => (
    <button
      key={b.id}
      type="button"
      onClick={() => navigate(b.to)}
      aria-current={b.atual ? "page" : undefined}
      className={cn(
        "relative flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium",
        b.atual ? "text-primary" : "text-muted-foreground"
      )}
    >
      <b.icon className="h-5 w-5" />
      {b.label}
      {!!b.badge && (
        <span className="absolute right-[22%] top-0 rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
          {b.badge}
        </span>
      )}
    </button>
  );

  return (
    <>
      <nav
        aria-label="Setores do portal"
        className="fixed inset-x-0 bottom-0 z-40 flex items-end border-t bg-card/95 px-2 pt-1.5 backdrop-blur md:hidden"
        style={{ paddingBottom: "max(0.6rem, env(safe-area-inset-bottom))" }}
      >
        {botoes.slice(0, meio).map(Botao)}
        {acoes.length > 0 && (
          <div className="flex flex-1 justify-center">
            <button
              type="button"
              onClick={() => setMaisAberto(true)}
              aria-label="Ações rápidas"
              className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>
        )}
        {botoes.slice(meio).map(Botao)}
      </nav>

      <Sheet open={maisAberto} onOpenChange={setMaisAberto}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Ações rápidas</SheetTitle>
          </SheetHeader>
          <div className="mt-2">
            {acoes.map((a) => (
              <LinhaSetor key={a.key} icon={a.icon} titulo={a.title} descricao={a.description} onClick={() => abrir(a)} />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
