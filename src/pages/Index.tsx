import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  AlertTriangle,
  History,
  ChevronRight,
  Users,
  MessageSquare,
  LogOut,
  ClipboardList,
  Calculator,
  CalendarDays,
  Receipt,
  Wallet,
  FolderOpen,
  CheckCircle2,
  ArrowRight,
  Building2,
  KeyRound,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { formatDue, dueText, dueTone, DUE_TONE_CLASS } from "@/lib/deliverableDisplay";
import { cn } from "@/lib/utils";

type MenuItem = {
  key: string;
  tool: CompanyToolKey;
  path: string;
  icon: typeof FileText;
  color: string;
  /** Sobrepõe o rótulo padrão da ferramenta (duas telas partilham a chave `calendar`). */
  title?: string;
  description?: string;
};

const MENU_ITEMS: MenuItem[] = [
  {
    key: "calendar",
    tool: "calendar",
    path: "/calendario",
    icon: CalendarDays,
    color: "bg-primary text-primary-foreground",
  },
  {
    key: "upcoming",
    tool: "calendar",
    path: "/proximos-pagamentos",
    icon: Wallet,
    color: "bg-accent text-accent-foreground",
    title: "Próximos pagamentos",
    description: "Lista do que está por vencer",
  },
  {
    key: "fiscal_guides",
    tool: "fiscal_guides",
    path: "/guias",
    icon: Receipt,
    color: "bg-primary text-primary-foreground",
  },
  {
    key: "payroll_files",
    tool: "payroll_files",
    path: "/folha",
    icon: Wallet,
    color: "bg-secondary text-secondary-foreground",
  },
  {
    key: "documents",
    tool: "documents",
    path: "/documentos",
    icon: FolderOpen,
    color: "bg-secondary text-secondary-foreground",
  },
  {
    key: "certificates",
    tool: "certificates",
    path: "/atestados",
    icon: ClipboardList,
    color: "bg-accent text-accent-foreground",
  },
  {
    key: "suspension",
    tool: "suspension",
    path: "/suspensao",
    icon: FileText,
    color: "bg-primary text-primary-foreground",
  },
  {
    key: "warning",
    tool: "warning",
    path: "/advertencia",
    icon: AlertTriangle,
    color: "bg-accent text-accent-foreground",
  },
  {
    key: "chatbot",
    tool: "chatbot",
    path: "/chatbot",
    icon: MessageSquare,
    color: "bg-primary text-primary-foreground",
  },
  {
    key: "salary_adhoc",
    tool: "salary_adhoc",
    path: "/salario-avulso",
    icon: Calculator,
    color: "bg-secondary text-secondary-foreground",
  },
  {
    key: "employees",
    tool: "employees",
    path: "/funcionarios",
    icon: Users,
    color: "bg-secondary text-secondary-foreground",
  },
  {
    key: "history",
    tool: "history",
    path: "/historico",
    icon: History,
    color: "bg-secondary text-secondary-foreground",
  },
];

const Index = () => {
  const navigate = useNavigate();
  const { company, logout, login } = useAuth();

  useEffect(() => {
    if (!company?.id || !company.token) return;
    const { id, token, mustChangePassword } = company;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.auth.companySession();
        if (cancelled) return;
        login({
          role: "company",
          id,
          name: data.company.name,
          cnpj: data.company.cnpj,
          token,
          toolAccess: mergeClientToolAccess(data.tool_access),
          // Preserva a marca: este refresh é só de nome/permissões.
          mustChangePassword,
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

  const { data: upcoming } = useQuery({
    queryKey: ["deliverables-upcoming", "home"],
    queryFn: () => api.deliverables.upcoming({ limit: 3 }),
    enabled: !!company && canSeePayments,
  });

  const visibleItems = MENU_ITEMS.filter((item) =>
    company ? isToolAllowed(company.toolAccess, item.tool) : true
  );

  const groups: Array<{ group: ToolGroup; items: MenuItem[] }> = TOOL_GROUPS.map((group) => ({
    group,
    items: visibleItems.filter((item) => COMPANY_TOOL_LABELS[item.tool].group === group),
  })).filter((g) => g.items.length > 0);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight text-foreground">Portal do Cliente</h1>
            {company && (
              <p className="truncate text-sm text-muted-foreground">{company.name}</p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => navigate("/alterar-senha")}
            title="Alterar senha"
          >
            <KeyRound className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only sm:ml-1">Senha</span>
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleLogout}>
            <LogOut className="mr-1 h-4 w-4" /> Sair
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        {canSeePayments && upcoming && (
          <Card className="mb-6 overflow-hidden">
            <CardContent className="p-0">
              <div className="flex items-center justify-between gap-2 border-b bg-card px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Wallet className="h-4 w-4 text-primary" />
                  Próximos pagamentos
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => navigate("/proximos-pagamentos")}
                >
                  Ver todos <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </div>
              {upcoming.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Nenhuma guia em aberto no momento.
                </div>
              ) : (
                <ul className="divide-y">
                  {upcoming.map((d) => {
                    const tone = dueTone(d.due_date, d.status);
                    return (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => navigate("/proximos-pagamentos")}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {d.doc_type && (
                                <Badge variant="secondary" className="text-xs">
                                  {d.doc_type}
                                </Badge>
                              )}
                              <span className="truncate text-sm font-medium">{d.title}</span>
                            </div>
                            <p className={cn("mt-0.5 text-xs", DUE_TONE_CLASS[tone])}>
                              {formatDue(d.due_date)} · {dueText(d.due_date, d.status)}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {groups.length === 0 && (
          <p className="rounded-lg border border-dashed bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhuma ferramenta está liberada para esta empresa. Contacte o administrador.
          </p>
        )}

        <div className="space-y-6">
          {groups.map(({ group, items }) => (
            <section key={group}>
              <div className="mb-2 px-1">
                <h2 className="text-sm font-semibold text-foreground">
                  {TOOL_GROUP_LABELS[group].title}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {TOOL_GROUP_LABELS[group].description}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((item) => {
                  const meta = COMPANY_TOOL_LABELS[item.tool];
                  return (
                    <Card
                      key={item.key}
                      className="cursor-pointer transition-all hover:shadow-md active:scale-[0.98]"
                      onClick={() => navigate(item.path)}
                    >
                      <CardContent className="flex items-center gap-3 p-4">
                        <div
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.color}`}
                        >
                          <item.icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-semibold text-foreground">
                            {item.title ?? meta.title}
                          </h3>
                          <p className="truncate text-xs text-muted-foreground">
                            {item.description ?? meta.description}
                          </p>
                        </div>
                        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
};

export default Index;
