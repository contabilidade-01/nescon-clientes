import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export interface EmpresaDoGrupo {
  id: string;
  name: string;
  cnpj?: string | null;
}

/** Primeira palavra "de verdade" do nome (tira LTDA, RESTAURANTE DO…), para achar as do mesmo grupo. */
function raiz(nome: string): string {
  const fora = new Set(["restaurante", "do", "da", "de", "dos", "das", "o", "a", "e", "ltda", "me", "epp", "eireli", "comercio", "comércio"]);
  return (
    nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .find((p) => p.length > 2 && !fora.has(p)) ?? ""
  );
}

/**
 * Escritório: traz para esta escala um funcionário registrado em OUTRA empresa do grupo
 * (outro CNPJ), por exemplo do Queijeiro 3 para a unidade Terra Preta da Matriz. As
 * empresas com nome parecido aparecem primeiro.
 */
export function TrazerDeOutraEmpresa({
  empresaAtual,
  empresas,
  unidades,
  jaNaEscala,
  onFechar,
  onTrazer,
}: {
  empresaAtual: EmpresaDoGrupo;
  empresas: EmpresaDoGrupo[];
  unidades: string[];
  /** Ids que já estão nesta escala (não aparecem para escolher). */
  jaNaEscala: Set<string>;
  onFechar: () => void;
  onTrazer: (p: { empresa: EmpresaDoGrupo; id: string; nome: string; cargo?: string; unidade: string }) => void;
}) {
  const grupo = raiz(empresaAtual.name);
  const outras = useMemo(
    () =>
      empresas
        .filter((e) => e.id !== empresaAtual.id)
        .sort((a, b) => Number(raiz(b.name) === grupo) - Number(raiz(a.name) === grupo) || a.name.localeCompare(b.name)),
    [empresas, empresaAtual.id, grupo],
  );
  const doGrupo = outras.filter((e) => grupo && raiz(e.name) === grupo);
  const [empresaId, setEmpresaId] = useState(doGrupo[0]?.id ?? "");
  const [busca, setBusca] = useState("");
  const [pessoaId, setPessoaId] = useState("");
  const [unidade, setUnidade] = useState(unidades[0] ?? "");
  const listaEmpresas = busca.trim()
    ? outras.filter((e) => `${e.name} ${e.cnpj ?? ""}`.toLowerCase().includes(busca.trim().toLowerCase()))
    : doGrupo.length
      ? doGrupo
      : outras;

  const funcionarios = useQuery({
    queryKey: ["employees", empresaId],
    queryFn: () => api.employees.list({ companyId: empresaId }),
    enabled: Boolean(empresaId),
  });
  const ativos = (funcionarios.data || []).filter((f) => f.active && !jaNaEscala.has(f.id)).sort((a, b) => a.name.localeCompare(b.name));
  const empresa = outras.find((e) => e.id === empresaId);
  const pessoa = ativos.find((f) => f.id === pessoaId);

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Trazer funcionário de outra empresa</DialogTitle>
          <DialogDescription>
            Para quem é registrado em outro CNPJ do grupo e trabalha numa unidade de {empresaAtual.name}. Ele entra nesta escala e sai da escala da
            empresa de origem (fica lá como “fora da escala”).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Empresa de origem</span>
            <Input className="h-8" placeholder="Buscar outra empresa pelo nome ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select
              className="h-9 w-full rounded border bg-background px-2"
              value={empresaId}
              onChange={(e) => {
                setEmpresaId(e.target.value);
                setPessoaId("");
              }}
              aria-label="Empresa de origem"
            >
              <option value="">Escolha a empresa</option>
              {listaEmpresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.cnpj ? ` · ${e.cnpj}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Funcionário</span>
            <select
              className="h-9 w-full rounded border bg-background px-2"
              value={pessoaId}
              onChange={(e) => setPessoaId(e.target.value)}
              disabled={!empresaId || funcionarios.isLoading}
              aria-label="Funcionário"
            >
              <option value="">{funcionarios.isLoading ? "Carregando…" : ativos.length ? "Escolha o funcionário" : "Nenhum funcionário ativo"}</option>
              {ativos.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.cargo ? ` · ${f.cargo}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Unidade nesta escala</span>
            <select className="h-9 w-full rounded border bg-background px-2" value={unidade} onChange={(e) => setUnidade(e.target.value)} aria-label="Unidade">
              {unidades.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
              <option value="">Sem unidade</option>
            </select>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={!empresa || !pessoa}
            onClick={() => empresa && pessoa && onTrazer({ empresa, id: pessoa.id, nome: pessoa.name, cargo: pessoa.cargo ?? undefined, unidade })}
          >
            Trazer para a escala
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
