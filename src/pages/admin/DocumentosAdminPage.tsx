import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Search, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

const CATEGORIAS = [
  { value: "", label: "Todas as categorias" },
  { value: "guia", label: "Guia" },
  { value: "boleto", label: "Boleto" },
  { value: "folha", label: "Folha" },
  { value: "outro", label: "Outro" },
  { value: "avulso", label: "Avulso" },
];

const DocumentosAdminPage = () => {
  const queryClient = useQueryClient();
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroDe, setFiltroDe] = useState("");
  const [filtroAte, setFiltroAte] = useState("");

  const { data: docs, isLoading } = useQuery({
    queryKey: ["admin-documentos", filtroEmpresa, filtroCategoria, filtroDe, filtroAte],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filtroEmpresa) params.set("busca", filtroEmpresa);
      if (filtroCategoria) params.set("category", filtroCategoria);
      if (filtroDe) params.set("de", filtroDe);
      if (filtroAte) params.set("ate", filtroAte);
      const q = params.toString();
      const res = await fetch(`/api/admin/documentos${q ? `?${q}` : ""}`, {
        headers: { Authorization: `Bearer ${(() => { try { return JSON.parse(localStorage.getItem("company_session") || "{}").token || ""; } catch { return ""; } })()}` },
      });
      if (!res.ok) throw new Error("Erro ao carregar");
      return res.json() as Promise<Array<{
        id: string;
        title: string;
        file_name: string;
        category: string;
        doc_type: string | null;
        competencia: string | null;
        source: string;
        created_at: string;
        due_date: string | null;
        empresa_nome: string;
        empresa_cnpj: string;
      }>>;
    },
    refetchOnWindowFocus: false,
  });

  const excluir = useMutation({
    mutationFn: (id: string) => api.deliverables.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-documentos"] });
      toast.success("Documento excluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Documentos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Todos os documentos por empresa, tipo e período.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" /> Filtros
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Input
                placeholder="Empresa, título ou arquivo..."
                className="h-9 w-56"
                value={filtroEmpresa}
                onChange={(e) => setFiltroEmpresa(e.target.value)}
              />
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={filtroCategoria}
                onChange={(e) => setFiltroCategoria(e.target.value)}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">De</span>
                <Input
                  type="date"
                  className="h-9 w-36"
                  value={filtroDe}
                  onChange={(e) => setFiltroDe(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Até</span>
                <Input
                  type="date"
                  className="h-9 w-36"
                  value={filtroAte}
                  onChange={(e) => setFiltroAte(e.target.value)}
                />
              </div>
              {(filtroEmpresa || filtroCategoria || filtroDe || filtroAte) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => { setFiltroEmpresa(""); setFiltroCategoria(""); setFiltroDe(""); setFiltroAte(""); }}
                >
                  Limpar
                </Button>
              )}
              <span className="ml-auto flex items-center text-xs text-muted-foreground">
                {docs?.length ?? 0} documento(s)
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Carregando...</p>
            ) : !docs?.length ? (
              <div className="p-8 text-center">
                <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">Nenhum documento encontrado.</p>
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Documento</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Empresa</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tipo</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Comp.</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Data</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => (
                      <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2">
                          <p className="truncate max-w-[250px] font-medium">{d.title || d.file_name}</p>
                          <p className="text-xs text-muted-foreground">{d.source}</p>
                        </td>
                        <td className="px-3 py-2">
                          <p className="truncate max-w-[180px]">{d.empresa_nome}</p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {d.empresa_cnpj?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}
                          </p>
                        </td>
                        <td className="px-3 py-2 capitalize text-muted-foreground">
                          {d.category}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {d.competencia || "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {new Date(d.created_at).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Excluir "${d.title || d.file_name}"?`)) {
                                excluir.mutate(d.id);
                              }
                            }}
                            disabled={excluir.isPending}
                          >
                            <Trash2 className="mr-1 h-3 w-3" /> Excluir
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default DocumentosAdminPage;
