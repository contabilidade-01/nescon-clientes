import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Anchor, Building2, Link2, Network, Unlink } from "lucide-react";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Empresa = NonNullable<ReturnType<typeof useAdminCompanies>["data"]>[number];

/**
 * Grupos de empresas: entrar em QUALQUER empresa do grupo dá navegação livre por todas
 * (cada empresa mantém a própria senha). No banco, uma empresa é a "âncora" (matriz) e as
 * demais apontam para ela (matriz_id). A navegação, porém, é simétrica — a âncora é só o
 * ponto de ligação. 1 nível: filial não pode ser âncora de outra.
 */
export default function GruposPage() {
  const { data: companies, isLoading } = useAdminCompanies();
  const queryClient = useQueryClient();

  const vincular = useMutation({
    mutationFn: ({ id, matriz_id }: { id: string; matriz_id: string | null }) =>
      api.admin.setCompanyMatriz(id, matriz_id),
    onSuccess: () => {
      toast.success("Grupo atualizado.");
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { grupos, semGrupo, ancoras } = useMemo(() => {
    const list: Empresa[] = companies ?? [];
    const filiaisPor = new Map<string, Empresa[]>();
    for (const c of list) {
      if (c.matriz_id) {
        if (!filiaisPor.has(c.matriz_id)) filiaisPor.set(c.matriz_id, []);
        filiaisPor.get(c.matriz_id)!.push(c);
      }
    }
    const temFilial = (id: string) => (filiaisPor.get(id)?.length ?? 0) > 0;
    const grupos = list
      .filter((c) => !c.matriz_id && temFilial(c.id))
      .map((anc) => ({ ancora: anc, filiais: filiaisPor.get(anc.id) ?? [] }));
    const semGrupo = list.filter((c) => !c.matriz_id && !temFilial(c.id));
    // Candidatas a âncora: qualquer empresa que não seja filial (matriz_id nulo).
    const ancoras = list.filter((c) => !c.matriz_id);
    return { grupos, semGrupo, ancoras };
  }, [companies]);

  return (
    <AdminLayout
      title="Grupos de empresas"
      description="Empresas do mesmo grupo transitam juntas: entrar em qualquer uma libera a navegação por todas — cada empresa mantém sua própria senha. Para montar um grupo, vincule empresas a uma âncora."
    >
      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="space-y-6">
          {/* Grupos existentes */}
          {grupos.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <Network className="h-8 w-8 text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">Nenhum grupo montado ainda.</p>
                <p className="text-xs text-muted-foreground">
                  Use a seção abaixo para vincular uma empresa a outra.
                </p>
              </CardContent>
            </Card>
          ) : (
            grupos.map(({ ancora, filiais }) => (
              <Card key={ancora.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Network className="h-4 w-4 text-primary" />
                    Grupo: {ancora.name}
                  </CardTitle>
                  <CardDescription>
                    {filiais.length + 1} empresa(s) — navegação livre entre elas.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Anchor className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{ancora.name}</p>
                        <p className="text-xs text-muted-foreground">{ancora.cnpj}</p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      Âncora
                    </Badge>
                  </div>

                  {filiais.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{f.name}</p>
                          <p className="text-xs text-muted-foreground">{f.cnpj}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={vincular.isPending}
                        onClick={() => vincular.mutate({ id: f.id, matriz_id: null })}
                      >
                        <Unlink className="mr-1 h-4 w-4" />
                        Remover
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}

          {/* Empresas sem grupo: vincular a uma âncora */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="h-4 w-4" />
                Empresas sem grupo
              </CardTitle>
              <CardDescription>
                Escolha a empresa à qual vincular — elas passam a transitar juntas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {semGrupo.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Todas as empresas já estão em algum grupo.
                </p>
              ) : (
                semGrupo.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.cnpj}</p>
                      </div>
                    </div>
                    <Select
                      disabled={vincular.isPending}
                      onValueChange={(target) => {
                        if (target) vincular.mutate({ id: c.id, matriz_id: target });
                      }}
                    >
                      <SelectTrigger className="h-9 w-[220px]">
                        <SelectValue placeholder="Vincular ao grupo de…" />
                      </SelectTrigger>
                      <SelectContent>
                        {ancoras
                          .filter((a) => a.id !== c.id)
                          .map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}
