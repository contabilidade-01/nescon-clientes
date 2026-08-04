import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, FileText } from "lucide-react";
import { format, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { CompanyFilter } from "@/components/admin/CompanyFilter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

/** Formata data com segurança: valor nulo ou inválido nunca derruba a página. */
function formatDateSafe(value: string | null | undefined, pattern: string): string {
  if (!value) return "";
  const d = new Date(value);
  return isValid(d) ? format(d, pattern, { locale: ptBR }) : "";
}

const EntregasPage = () => {
  const [companyId, setCompanyId] = useState("");
  const listOpts = companyId ? { companyId } : undefined;

  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ["admin-deliverables-overview"],
    queryFn: () => api.admin.deliverablesOverview(),
  });

  const { data: documents, isLoading: loadingDocs } = useQuery({
    queryKey: ["issued-documents", "admin", companyId || "all"],
    queryFn: () => api.documents.list(listOpts),
  });

  const { data: certificates, isLoading: loadingCert } = useQuery({
    queryKey: ["certificates", "admin", companyId || "all"],
    queryFn: () => api.certificates.list(listOpts),
  });

  return (
    <AdminLayout
      title="Documentos e entregas"
      description="O que a sincronização e os envios manuais entregaram a cada cliente"
    >
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Entregas por empresa (G-Click + manual)
          </CardTitle>
          <CardDescription>
            <strong>Liberadas</strong> = já visíveis para o cliente no portal;{" "}
            <strong>retidas</strong> = à espera de o escritório clicar &quot;Enviar&quot; no sistema de
            guias.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-h-96 space-y-2 overflow-y-auto text-sm">
          {loadingOverview ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : overview?.length ? (
            overview.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">
                    CNPJ {row.cnpj}
                    {row.ultima_entrada
                      ? ` · última: ${formatDateSafe(row.ultima_entrada, "dd/MM/yyyy HH:mm")}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="outline">{row.total} total</Badge>
                  <Badge variant="default">{row.liberadas} liberadas</Badge>
                  {row.retidas > 0 && <Badge variant="secondary">{row.retidas} retidas</Badge>}
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">
              Nenhuma entrega registrada ainda. Rode a sincronização com o G-Click ou envie um
              documento manualmente em <strong>Empresas</strong>.
            </p>
          )}
        </CardContent>
      </Card>

      <CompanyFilter
        value={companyId}
        onChange={setCompanyId}
        description="Filtra os documentos de DP e os atestados listados abaixo."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Documentos emitidos (suspensões e advertências)
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-72 space-y-2 overflow-y-auto">
          {loadingDocs ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : documents?.length ? (
            documents.map((doc) => (
              <div key={doc.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={doc.document_type === "suspension" ? "default" : "secondary"}>
                    {doc.document_type === "suspension" ? "Suspensão" : "Advertência"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{doc.company_name}</span>
                </div>
                <p className="mt-1 font-medium">{doc.employee_name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateSafe(doc.created_at, "dd/MM/yyyy HH:mm")} · CNPJ {doc.company_cnpj}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum documento</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Atestados
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-72 space-y-2 overflow-y-auto text-sm">
          {loadingCert ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : certificates?.length ? (
            certificates.map((c) => (
              <div key={c.id} className="flex flex-col border-b border-border/50 pb-2 last:border-0">
                <span className="font-medium">{c.employee_name ?? "—"}</span>
                <span className="text-xs text-muted-foreground">
                  {c.company_name ?? "—"} · {c.file_name} ·{" "}
                  {formatDateSafe(c.certificate_date, "dd/MM/yyyy")}
                </span>
                <a
                  className="mt-1 text-xs text-primary underline"
                  href={api.certificates.fileUrl(c.file_path)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir arquivo
                </a>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">Nenhum atestado</p>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
};

export default EntregasPage;
