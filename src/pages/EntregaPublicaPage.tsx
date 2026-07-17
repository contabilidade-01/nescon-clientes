import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, LogIn, CalendarDays, Building2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { competenciaLabel, formatDue, dueText, dueTone, DUE_TONE_CLASS } from "@/lib/deliverableDisplay";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  guia: "Guia fiscal",
  folha: "Folha de pagamento",
  outro: "Documento",
};

/**
 * Página aberta pelo link do WhatsApp — sem login.
 * Mostra só os dados do documento (token opaco) e convida a entrar no portal.
 */
const EntregaPublicaPage = () => {
  const { token = "" } = useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-deliverable", token],
    queryFn: () => api.deliverables.public.get(token),
    retry: false,
    enabled: !!token,
  });

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10">
        {isLoading ? (
          <p className="text-center text-sm text-muted-foreground">Carregando documento...</p>
        ) : error || !data ? (
          <Card>
            <CardContent className="p-6 text-center">
              <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground/60" />
              <h1 className="mt-3 text-lg font-bold">Documento não encontrado</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Este link pode ter expirado ou estar incorreto. Entre no portal para ver todos os seus
                documentos.
              </p>
              <Button asChild className="mt-4 w-full">
                <Link to="/login">
                  <LogIn className="mr-2 h-4 w-4" /> Entrar no portal
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Building2 className="h-4 w-4 shrink-0" />
                <span className="truncate">{data.company_name}</span>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{data.doc_type || CATEGORY_LABEL[data.category] || "Documento"}</Badge>
                  {data.status === "paid" && (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600">Pago</Badge>
                  )}
                </div>
                <h1 className="mt-2 text-xl font-bold leading-tight">{data.title}</h1>
                {data.competencia && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Competência: {competenciaLabel(data.competencia)}
                  </p>
                )}
              </div>

              {data.due_date && (
                <div className="flex items-center gap-2 rounded-lg bg-muted p-3">
                  <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <span className="text-muted-foreground">Vencimento: </span>
                    <span className="font-semibold">{formatDue(data.due_date)}</span>
                    <span className={cn("ml-2", DUE_TONE_CLASS[dueTone(data.due_date, data.status)])}>
                      {dueText(data.due_date, data.status)}
                    </span>
                  </div>
                </div>
              )}

              <Button asChild size="lg" className="w-full">
                <a
                  href={api.deliverables.public.fileUrl(token)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText className="mr-2 h-5 w-5" /> Abrir documento
                </a>
              </Button>

              <Button asChild variant="outline" className="w-full">
                <Link to="/login">
                  <LogIn className="mr-2 h-4 w-4" /> Ver todos no portal
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Portal do Cliente · documentos e vencimentos da sua empresa
        </p>
      </main>
    </div>
  );
};

export default EntregaPublicaPage;
