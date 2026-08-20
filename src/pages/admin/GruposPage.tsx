import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

  if (isLoading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Grupos de empresas</h1>
        <p className="text-sm text-muted-foreground">
          Empresas do mesmo grupo. Entrar em qualquer uma delas permite navegar por todas —
          cada empresa mantém sua própria senha. Para montar um grupo, vincule as empresas a
          uma mesma empresa do grupo.
        </p>
      </div>

      {/* Grupos existentes */}
      {grupos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum grupo montado ainda.</p>
      ) : (
        grupos.map(({ ancora, filiais }) => (
          <Card key={ancora.id}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Grupo: {ancora.name}</CardTitle>
              <CardDescription>
                {filiais.length + 1} empresa(s) — navegação livre entre elas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between rounded border p-2">
                <span className="text-sm">
                  {ancora.name}{" "}
                  <span className="text-xs text-muted-foreground">({ancora.cnpj}) — âncora</span>
                </span>
              </div>
              {filiais.map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded border p-2">
                  <span className="text-sm">
                    {f.name} <span className="text-xs text-muted-foreground">({f.cnpj})</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={vincular.isPending}
                    onClick={() => vincular.mutate({ id: f.id, matriz_id: null })}
                  >
                    Remover do grupo
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
          <CardTitle className="text-base">Empresas sem grupo</CardTitle>
          <CardDescription>
            Escolha a empresa do grupo à qual vincular — elas passam a transitar juntas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {semGrupo.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todas as empresas já estão em algum grupo.</p>
          ) : (
            semGrupo.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <span className="text-sm">
                  {c.name} <span className="text-xs text-muted-foreground">({c.cnpj})</span>
                </span>
                <select
                  className="h-9 rounded border bg-background px-2 text-sm"
                  defaultValue=""
                  disabled={vincular.isPending}
                  onChange={(e) => {
                    const target = e.target.value;
                    if (target) vincular.mutate({ id: c.id, matriz_id: target });
                    e.currentTarget.value = "";
                  }}
                >
                  <option value="">Vincular ao grupo de…</option>
                  {ancoras
                    .filter((a) => a.id !== c.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
