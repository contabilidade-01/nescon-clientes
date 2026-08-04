import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, RefreshCw, Search, UserPlus, X } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type GclickPendencia } from "@/lib/api";
import { maskCNPJ } from "@/lib/masks";

function dataHora(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR");
}

const ClientesGclickPage = () => {
  const queryClient = useQueryClient();

  const { data: pendencias, isLoading } = useQuery({
    queryKey: ["gclick-pendencias"],
    queryFn: () => api.gclickClientes.pendencias(),
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["gclick-pendencias"] });
    queryClient.invalidateQueries({ queryKey: ["gclick-clientes"] });
    queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
  };

  const sincronizar = useMutation({
    mutationFn: () => api.gclickClientes.sincronizar(),
    onSuccess: (r) => {
      invalidar();
      toast.success(
        `${r.clientes} cliente(s) conferido(s) · ${r.novos} novo(s) no espelho · ${r.alertas} alerta(s)`
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const novos = pendencias?.novos ?? [];
  const mudancas = pendencias?.mudancas ?? [];

  return (
    <AdminLayout
      title="Clientes do G-Click"
      description="Quem entrou, quem mudou de situação e quem você decidiu não cadastrar"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          O G-Click descobre; a decisão de cadastrar é sua.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => sincronizar.mutate()}
          disabled={sincronizar.isPending}
        >
          <RefreshCw className={`mr-1 h-4 w-4 ${sincronizar.isPending ? "animate-spin" : ""}`} />
          Conferir agora
        </Button>
      </div>

      <Tabs defaultValue="novos">
        <TabsList>
          <TabsTrigger value="novos">
            Novos{novos.length > 0 ? ` (${novos.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="mudancas">
            Mudanças de situação{mudancas.length > 0 ? ` (${mudancas.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="rejeitados">Rejeitados</TabsTrigger>
        </TabsList>

        <TabsContent value="novos" className="mt-4 space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : novos.length ? (
            novos.map((p) => <NovoClienteCard key={p.id} p={p} onResolvido={invalidar} />)
          ) : (
            <p className="rounded-xl border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhum cliente novo aguardando decisão.
            </p>
          )}
        </TabsContent>

        <TabsContent value="mudancas" className="mt-4 space-y-3">
          {mudancas.length ? (
            mudancas.map((p) => <MudancaCard key={p.id} p={p} onResolvido={invalidar} />)
          ) : (
            <p className="rounded-xl border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhuma mudança de situação para revisar.
            </p>
          )}
        </TabsContent>

        <TabsContent value="rejeitados" className="mt-4">
          <RejeitadosTab onResolvido={invalidar} />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
};

function NovoClienteCard({ p, onResolvido }: { p: GclickPendencia; onResolvido: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [pedindoMotivo, setPedindoMotivo] = useState(false);

  const aceitar = useMutation({
    mutationFn: () => api.gclickClientes.aceitar(p.cnpj),
    onSuccess: (r) => {
      onResolvido();
      toast.success(r.message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejeitar = useMutation({
    mutationFn: () => api.gclickClientes.rejeitar(p.cnpj, motivo.trim() || null),
    onSuccess: (r) => {
      onResolvido();
      // A empresa criada automaticamente NÃO é apagada ao rejeitar. Aviso longo de
      // propósito: sem ele o operador assumiria que o acesso foi removido.
      if (r.empresa_existente) toast.warning(r.message, { duration: 12000 });
      else toast.success(r.message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{p.dados?.nome || p.nome || "(sem nome)"}</p>
            <p className="text-xs text-muted-foreground">
              CNPJ {maskCNPJ(p.cnpj)}
              {p.dados?.email ? ` · ${p.dados.email}` : ""}
              {p.criado_em ? ` · visto em ${dataHora(p.criado_em)}` : ""}
            </p>
          </div>
          <Badge variant={p.status_gclick === "ATIVO" ? "default" : "secondary"}>
            {p.status_gclick || "—"}
          </Badge>
        </div>

        {p.empresa_existente_id && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Este CNPJ <strong>já tem cadastro no portal</strong> (criado automaticamente quando
              chegou uma guia). Cadastrar apenas vincula, sem alterar os dados. Recusar{" "}
              <strong>não remove</strong> o acesso — isso se faz em Empresas.
            </span>
          </div>
        )}

        {pedindoMotivo ? (
          <div className="space-y-2">
            <Input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (opcional): ex. cliente não contratou o portal"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => rejeitar.mutate()}
                disabled={rejeitar.isPending}
              >
                Confirmar recusa
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPedindoMotivo(false)}>
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => aceitar.mutate()} disabled={aceitar.isPending}>
              <UserPlus className="mr-1 h-4 w-4" /> Cadastrar no portal
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPedindoMotivo(true)}>
              <X className="mr-1 h-4 w-4" /> Não cadastrar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MudancaCard({ p, onResolvido }: { p: GclickPendencia; onResolvido: () => void }) {
  const ciente = useMutation({
    mutationFn: () => api.gclickClientes.ciente(p.id),
    onSuccess: () => {
      onResolvido();
      toast.success("Aviso arquivado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const desativado = p.dados?.para === "DESATIVADO";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{p.dados?.nome || p.nome || p.cnpj}</p>
        <p className="text-xs text-muted-foreground">
          CNPJ {maskCNPJ(p.cnpj)} · {p.dados?.de || "—"} → <strong>{p.dados?.para || "—"}</strong>
          {p.criado_em ? ` · ${dataHora(p.criado_em)}` : ""}
        </p>
        {desativado && (
          <p className="mt-1 text-xs text-muted-foreground">
            O cliente <strong>continua acessando o portal</strong>. Isto é só um aviso; desligar o
            acesso, se for o caso, é feito em Empresas.
          </p>
        )}
      </div>
      <Button type="button" size="sm" onClick={() => ciente.mutate()} disabled={ciente.isPending}>
        <Check className="mr-1 h-4 w-4" /> OK, ciente
      </Button>
    </div>
  );
}

function RejeitadosTab({ onResolvido }: { onResolvido: () => void }) {
  const [busca, setBusca] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["gclick-clientes", "rejeitados"],
    queryFn: () => api.gclickClientes.listar({ decisao: "rejeitado" }),
  });

  const reconsiderar = useMutation({
    mutationFn: (cnpj: string) => api.gclickClientes.reconsiderar(cnpj),
    onSuccess: (r) => {
      onResolvido();
      toast.success(r.message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const linhas = data?.filter((c) => {
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return (c.nome || "").toLowerCase().includes(q) || c.cnpj.includes(q);
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Recusados</CardTitle>
        <CardDescription>
          Não voltam a ser perguntados enquanto nada mudar no G-Click. Se um deles for reativado
          lá, o sistema pergunta de novo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por nome ou CNPJ"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="max-h-[32rem] space-y-2 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : linhas?.length ? (
            linhas.map((c) => (
              <div
                key={c.cnpj}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.nome || "(sem nome)"}</p>
                  <p className="text-xs text-muted-foreground">
                    CNPJ {maskCNPJ(c.cnpj)}
                    {c.motivo_rejeicao ? ` · ${c.motivo_rejeicao}` : ""}
                    {c.decidido_em ? ` · recusado em ${dataHora(c.decidido_em)}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => reconsiderar.mutate(c.cnpj)}
                  disabled={reconsiderar.isPending}
                >
                  Cadastrar agora
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum cliente recusado.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default ClientesGclickPage;
