import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, AlertTriangle, History, ChevronRight, Users, MessageSquare, LogOut, ClipboardList, Calculator, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { isToolAllowed, mergeClientToolAccess, type CompanyToolKey } from "@/lib/companyTools";

const GCLICK_URL = "https://guias.gestaoempresa.com";

const menuItems: Array<{
  title: string;
  description: string;
  icon: typeof FileText;
  path?: string;
  externalUrl?: string;
  color: string;
  tool: CompanyToolKey;
}> = [
  {
    title: "Suspensão",
    description: "Gerar termo de suspensão",
    icon: FileText,
    path: "/suspensao",
    color: "bg-primary text-primary-foreground",
    tool: "suspension",
  },
  {
    title: "Advertência",
    description: "Gerar termo de advertência",
    icon: AlertTriangle,
    path: "/advertencia",
    color: "bg-accent text-accent-foreground",
    tool: "warning",
  },
  {
    title: "Assistente",
    description: "Gerar documentos via chatbot",
    icon: MessageSquare,
    path: "/chatbot",
    color: "bg-primary text-primary-foreground",
    tool: "chatbot",
  },
  {
    title: "Salário avulso",
    description: "Cálculo proporcional (experiência / treino)",
    icon: Calculator,
    path: "/salario-avulso",
    color: "bg-secondary text-secondary-foreground",
    tool: "salary_adhoc",
  },
  {
    title: "Funcionários",
    description: "Cadastro de funcionários",
    icon: Users,
    path: "/funcionarios",
    color: "bg-secondary text-secondary-foreground",
    tool: "employees",
  },
  {
    title: "Atestados",
    description: "Gestão de atestados médicos",
    icon: ClipboardList,
    path: "/atestados",
    color: "bg-accent text-accent-foreground",
    tool: "certificates",
  },
  {
    title: "Histórico",
    description: "Documentos emitidos",
    icon: History,
    path: "/historico",
    color: "bg-secondary text-secondary-foreground",
    tool: "history",
  },
  {
    title: "Envio de Guias",
    description: "Envio de guias fiscais por WhatsApp",
    icon: ExternalLink,
    externalUrl: GCLICK_URL,
    color: "bg-primary text-primary-foreground",
    tool: "history",
  },
];

const Index = () => {
  const navigate = useNavigate();
  const { company, logout, login } = useAuth();

  useEffect(() => {
    if (!company?.id || !company.token) return;
    const { id, token } = company;
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
        });
      } catch {
        /* sessão inválida ou rede: mantém estado local */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [company?.id, company?.token, login]);

  const visibleItems = company
    ? menuItems.filter((item) => isToolAllowed(company.toolAccess, item.tool))
    : menuItems;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-2xl px-4 py-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <FileText className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Gestão de Documentos</h1>
          {company && (
            <p className="mt-1 text-sm text-muted-foreground">{company.name}</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-muted-foreground"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4 mr-1" /> Sair
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <div className="space-y-3">
          {visibleItems.length === 0 && (
            <p className="rounded-lg border border-dashed bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhuma ferramenta está liberada para esta empresa. Contacte o administrador.
            </p>
          )}
          {visibleItems.map((item) => (
            <Card
              key={item.title}
              className="cursor-pointer transition-all hover:shadow-md active:scale-[0.98]"
              onClick={() => {
                if (item.externalUrl) {
                  window.open(item.externalUrl, "_blank", "noopener,noreferrer");
                } else if (item.path) {
                  navigate(item.path);
                }
              }}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${item.color}`}>
                  <item.icon className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h2 className="font-semibold text-foreground">{item.title}</h2>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
                {item.externalUrl ? (
                  <ExternalLink className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

export default Index;
