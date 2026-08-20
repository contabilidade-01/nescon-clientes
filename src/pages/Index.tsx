import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CircleDollarSign,
  FileText,
  AlertTriangle,
  History,
  Users,
  MessageSquare,
  LogOut,
  ClipboardList,
  Calculator,
  CalendarDays,
  Palmtree,
  Receipt,
  Wallet,
  Barcode,
  FolderOpen,
  CheckCircle2,
  ArrowUpRight,
  KeyRound,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DueBadge } from "@/components/DueBadge";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import {
  isToolAllowed,
  mergeClientToolAccess,
  COMPANY_TOOL_LABELS,
  TOOL_GROUPS,
  TOOL_GROUP_LABELS,
  type CompanyToolKey,
  type ToolGroup,
} from "@/lib/companyTools";
import { competenciaLabel, formatDueLong } from "@/lib/deliverableDisplay";
import { LgpdConsentDialog } from "@/components/LgpdConsentDialog";
import { CompanySwitcher } from "@/components/CompanySwitcher";

type MenuItem = {
  key: string;
  tool: CompanyToolKey;
  path: string;
  icon: typeof FileText;
  /** Sobrepõe o rótulo da ferramenta (duas telas dividem a chave `calendar`). */
  title?: string;
  description?: string;
};

const MENU_ITEMS: MenuItem[] = [
  { key: "calendar", tool: "calendar", path: "/calendario", icon: CalendarDays,
    title: "Calendário", description: "Tudo do mês num só lugar" },
  { key: "upcoming", tool: "calendar", path: "/proximos-pagamentos", icon: Wallet,
    title: "Próximos pagamentos", description: "Atrasados e próximos" },
  { key: "fiscal_guides", tool: "fiscal_guides", path: "/guias", icon: Receipt,
    title: "Guias fiscais", description: "Impostos e contribuições" },
  { key: "boletos", tool: "boletos", path: "/boletos", icon: Barcode,
    title: "Boletos", description: "Boletos a pagar" },
  { key: "payroll_files", tool: "payroll_files", path: "/folha", icon: FileText,
    title: "Folha de pagamento", description: "Extratos e recibos mensais" },
  // Mesma permissão da folha: quem vê o documento vê o custo dele.
  { key: "custo_folha", tool: "payroll_files", path: "/custo-folha", icon: CircleDollarSign,
    title: "Custo de folha", description: "Quanto custou por mês e a projeção do 13º" },
  { key: "documents", tool: "documents", path: "/documentos", icon: FolderOpen,
    title: "Documentos", description: "Contratos e relatórios" },
  { key: "vacations", tool: "vacations", path: "/ferias", icon: Palmtree,
    title: "Férias", description: "Quem tem direito, custo e faltas" },
  { key: "certificates", tool: "certificates", path: "/atestados", icon: ClipboardList },
  { key: "suspension", tool: "suspension", path: "/suspensao", icon: FileText },
  { key: "warning", tool: "warning", path: "/advertencia", icon: AlertTriangle },
  { key: "chatbot", tool: "chatbot", path: "/chatbot", icon: MessageSquare },
  { key: "salary_adhoc", tool: "salary_adhoc", path: "/salario-avulso", icon: Calculator },
  { key: "employees", tool: "employees", path: "/funcionarios", icon: Users },
  { key: "history", tool: "history", path: "/historico", icon: History },
  { key: "chat", tool: "chat", path: "/mensagens", icon: MessageSquare,
    title: "Mensagens", description: "Fale com o escritório" },
];

const GROUP_SUBTITLE: Record<ToolGroup, string> = {
  financeiro: "Guias, calendário e próximos pagamentos",
  entregas: "Contratos e relatórios",
  portal: "Fale com o escritório",
  dp: "Folha, férias e rotinas de funcionários",
};

const Index = () => {
  const navigate = useNavigate();
  const { company, logout, login } = useAuth();

  // Registra a abertura de uma ferramenta (tela "Controle de acessos") e navega.
  // Best-effort: se o registro falhar, a navegação acontece do mesmo jeito.
  const abrirFerramenta = (tool: CompanyToolKey, path: string) => {
    api.portal.registrarUso(tool);
    navigate(path);
  };
  // Aviso de LGPD: só abre se o servidor disser que a empresa nunca respondeu.
  const [mostrarLgpd, setMostrarLgpd] = useState(false);

  useEffect(() => {
    if (!company?.id || !company.token) return;
    const { id, token, mustChangePassword } = company;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.auth.companySession();
        if (cancelled) return;
        setMostrarLgpd(!data.lgpd?.consent_at && !data.lgpd?.prompt_seen_at);
        login({
          role: "company",
          id,
          name: data.company.name,
          cnpj: data.company.cnpj,
          token,
          toolAccess: mergeClientToolAccess(data.tool_access),
          // Preserva a marca: este refresh é só de nome/permissões.
          mustChangePassword,
          temFuncionarios: data.tem_funcionarios !== false,
        });
      } catch {
        /* sessão inválida ou rede: mantém estado local */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [company?.id, company?.token, company?.mustChangePassword, login]);

  const canSeePayments = isToolAllowed(company?.toolAccess, "calendar");

  const { data: upcoming, isLoading: loadingUpcoming } = useQuery({
    queryKey: ["deliverables-upcoming", "home"],
    queryFn: () => api.deliverables.upcoming({ limit: 3 }),
    enabled: !!company && canSeePayments,
  });

  // Férias urgentes na porta de entrada: sem isto o cliente precisa descobrir o menu
  // sozinho para saber que alguém está prestes a perder dias.
  const podeFerias =
    isToolAllowed(company?.toolAccess, "vacations") && company?.temFuncionarios !== false;
  const { data: ferias } = useQuery({
    queryKey: ["ferias", "home"],
    queryFn: () => api.ferias.listar(),
    enabled: !!company && podeFerias,
  });

  const { data: docCount } = useQuery({
    queryKey: ["deliverables", "home-count"],
    queryFn: () => api.deliverables.list(),
    enabled: !!company,
  });

  // Mensagens sem resposta do escritório. Sem este número, o cliente só descobre que
  // foi respondido se abrir a tela por conta própria.
  const podeChat = isToolAllowed(company?.toolAccess, "chat");
  const { data: chatUnread } = useQuery({
    queryKey: ["chat-unread"],
    queryFn: () => api.chat.unread(),
    enabled: !!company && podeChat,
    refetchInterval: 60_000,
  });
  const naoLidasChat = chatUnread?.count ?? 0;

  const visibleItems = MENU_ITEMS.filter((item) => {
    if (company && !isToolAllowed(company.toolAccess, item.tool)) return false;
    // Férias só para quem tem funcionário celetista: empresa só com pró-labore não
    // tem o que programar, e um menu vazio parece serviço faltando.
    if (item.tool === "vacations" && company?.temFuncionarios === false) return false;
    return true;
  });

  const groups: Array<{ group: ToolGroup; items: MenuItem[] }> = TOOL_GROUPS.map((group) => ({
    group,
    items: visibleItems.filter((item) => COMPANY_TOOL_LABELS[item.tool].group === group),
  })).filter((g) => g.items.length > 0);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const abertas = upcoming?.length ?? 0;
  const primeiroNome = (company?.name || "").replace(/\s+(LTDA|ME|EPP|S\/?A|EIRELI)\.?$/i, "");
  const estaPersonificando = Boolean(localStorage.getItem("admin_session_backup"));

  const voltarAoAdmin = () => {
    const backup = localStorage.getItem("admin_session_backup");
    if (backup) {
      localStorage.setItem("company_session", backup);
      localStorage.removeItem("admin_session_backup");
      window.location.href = "/admin";
    }
  };

  return (
    <div className="min-h-screen">
      <LgpdConsentDialog aberto={mostrarLgpd} onResolvido={() => setMostrarLgpd(false)} />

      {/* Banner de personificação — admin está vendo como cliente */}
      {estaPersonificando && (
        <div className="sticky top-0 z-50 flex items-center justify-between gap-2 bg-amber-600 px-4 py-2 text-white text-sm">
          <span>👁️ Você está vendo o portal como <strong>{company?.name}</strong></span>
          <button
            onClick={voltarAoAdmin}
            className="rounded bg-white/20 px-3 py-1 text-xs font-medium hover:bg-white/30 transition-colors"
          >
            ← Voltar ao admin
          </button>
        </div>
      )}

      <header className="border-b border-border/60 bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-primary/30 text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Hub Empresa · Portal</p>
            <h1 className="truncate text-base font-bold leading-tight sm:text-lg">
              {company?.name ?? "Portal do Cliente"}
            </h1>
          </div>
          <CompanySwitcher />
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/alterar-senha")}
            aria-label="Alterar senha"
          >
            <KeyRound className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
            aria-label="Sair"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6">
        {/* Herói — quem é a empresa e o que exige atenção agora */}
        <section className="card-glow p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="eyebrow">Bem-vindo de volta</p>
              <h2 className="mt-2 truncate text-2xl font-bold sm:text-3xl">{primeiroNome}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {!canSeePayments
                  ? "Seus documentos ficam guardados aqui."
                  : loadingUpcoming
                    ? "Carregando seus vencimentos..."
                    : abertas === 0
                      ? "Nenhuma guia em aberto no momento."
                      : `${abertas} pagamento${abertas > 1 ? "s" : ""} ${abertas > 1 ? "próximos" : "próximo"} do vencimento.`}
              </p>
            </div>
            <div className="flex shrink-0 gap-3">
              {canSeePayments && (
                <div className="min-w-[7.5rem] rounded-xl border bg-background/40 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Guias abertas
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {loadingUpcoming ? "—" : abertas}
                  </p>
                </div>
              )}
              <div className="min-w-[7.5rem] rounded-xl border bg-background/40 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Documentos
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{docCount?.length ?? "—"}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Próximos pagamentos */}
        {canSeePayments && (
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Próximos pagamentos</h2>
                <p className="text-sm text-muted-foreground">O que precisa da sua atenção agora</p>
              </div>
              <button
                type="button"
                onClick={() => abrirFerramenta("calendar", "/proximos-pagamentos")}
                className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Ver todos <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>

            {loadingUpcoming ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-36 rounded-2xl" />
                ))}
              </div>
            ) : abertas === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border bg-card/60 px-5 py-6">
                <CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
                <div>
                  <p className="font-medium">Nenhuma guia em aberto</p>
                  <p className="text-sm text-muted-foreground">
                    Novos vencimentos aparecem aqui assim que a contabilidade enviar.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {upcoming!.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => abrirFerramenta("calendar", "/proximos-pagamentos")}
                    className="rounded-2xl border bg-card/70 p-5 text-left transition-colors hover:border-primary/40 hover:bg-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      {d.doc_type ? (
                        <Badge variant="secondary" className="font-mono text-[10px] tracking-wide">
                          {d.doc_type}
                        </Badge>
                      ) : (
                        <span />
                      )}
                      <DueBadge dueDate={d.due_date} status={d.status} />
                    </div>
                    <p className="mt-3 truncate text-lg font-semibold">{d.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {competenciaLabel(d.competencia)}
                    </p>
                    <p className="mt-3 text-lg font-bold text-primary">
                      {formatDueLong(d.due_date)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Só aparece quando há o que resolver — cartão vazio vira ruído. */}
        {podeFerias && ferias?.resumo && (ferias.resumo.vencidas > 0 || ferias.resumo.em_risco_faltas > 0) && (
          <button
            type="button"
            onClick={() => abrirFerramenta("vacations", "/ferias")}
            className="flex w-full items-center gap-3 rounded-2xl border-2 border-amber-500/50 bg-amber-500/10 px-5 py-4 text-left"
          >
            <Palmtree className="h-6 w-6 shrink-0 text-amber-600" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                {ferias.resumo.vencidas > 0
                  ? `${ferias.resumo.vencidas} férias vencida(s)`
                  : `${ferias.resumo.em_risco_faltas} funcionário(s) prestes a perder dias de férias`}
              </span>
              <span className="block text-sm text-muted-foreground">
                {ferias.resumo.vencidas > 0 && ferias.resumo.em_risco_faltas > 0
                  ? `E ${ferias.resumo.em_risco_faltas} prestes a perder dias por faltas. `
                  : ""}
                Toque para ver quem, quando e quanto custa.
              </span>
            </span>
            <ArrowUpRight className="h-5 w-5 shrink-0 text-amber-600" />
          </button>
        )}

        {groups.length === 0 && (
          <p className="rounded-2xl border border-dashed bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma ferramenta está liberada para esta empresa. Contacte o administrador.
          </p>
        )}

        {/* Menu por seção */}
        {groups.map(({ group, items }) => (
          <section key={group}>
            <div className="mb-3">
              <h2 className="text-lg font-bold">{TOOL_GROUP_LABELS[group].title}</h2>
              <p className="text-sm text-muted-foreground">{GROUP_SUBTITLE[group]}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => {
                const meta = COMPANY_TOOL_LABELS[item.tool];
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => abrirFerramenta(item.tool, item.path)}
                    className="group flex min-w-0 items-center gap-4 rounded-2xl border bg-card/70 p-4 text-left transition-colors hover:border-primary/40 hover:bg-card"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                      <item.icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="flex items-center gap-2 truncate font-semibold">
                        {item.title ?? meta.title}
                        {item.key === "chat" && naoLidasChat > 0 && (
                          <Badge className="bg-destructive text-destructive-foreground">
                            {naoLidasChat}
                          </Badge>
                        )}
                      </h3>
                      <p className="truncate text-sm text-muted-foreground">
                        {item.description ?? meta.description}
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
};

export default Index;
