import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ClipboardList, Eye, KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, type MeiCredential, type MonthlyFollowTask } from "@/lib/api";
import { maskCNPJ } from "@/lib/masks";

function competenciaAtual() {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  return p.slice(0, 7);
}

function fmtData(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluido: "Concluído",
  atrasado: "Atrasado",
};

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "concluido") return "secondary";
  if (s === "atrasado") return "destructive";
  if (s === "em_andamento") return "default";
  return "outline";
}

function SelectUser({
  value,
  onChange,
  people,
  emptyLabel = "Sem responsável",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  people: Array<{ id: string; nome: string }>;
  emptyLabel?: string;
}) {
  return (
    <select
      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{emptyLabel}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nome}
        </option>
      ))}
    </select>
  );
}

function TarefaCard({
  t,
  people,
  onPatch,
}: {
  t: MonthlyFollowTask;
  people: Array<{ id: string; nome: string }>;
  onPatch: (id: string, data: { assigned_admin_id?: string | null; status?: string; notes?: string }) => void;
}) {
  const [notes, setNotes] = useState(t.notes || "");
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{t.titulo}</CardTitle>
            <CardDescription>{t.descricao}</CardDescription>
          </div>
          <Badge variant={statusVariant(t.status_efetivo)}>{STATUS_LABEL[t.status_efetivo] || t.status_efetivo}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Prazo: <span className="font-medium text-foreground">{fmtData(t.due_date)}</span>
        </p>
        <div className="space-y-1">
          <Label className="text-xs">Destinar a</Label>
          <SelectUser
            value={t.assigned_admin_id}
            people={people}
            onChange={(v) => onPatch(t.id, { assigned_admin_id: v })}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["pendente", "em_andamento", "concluido"] as const).map((st) => (
            <Button
              key={st}
              size="sm"
              variant={t.status === st ? "default" : "outline"}
              onClick={() => onPatch(t.id, { status: st })}
            >
              {STATUS_LABEL[st]}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Anotações</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => onPatch(t.id, { notes })}>
            Guardar anotação
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const AcompanhamentosPage = () => {
  const qc = useQueryClient();
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [aba, setAba] = useState("tarefas");

  const [novoTitulo, setNovoTitulo] = useState("");
  const [novoDesc, setNovoDesc] = useState("");
  const [novoPrazo, setNovoPrazo] = useState<"n_dia_bancario" | "ultimo_dia_bancario">("n_dia_bancario");
  const [novoN, setNovoN] = useState(5);

  const [meiNome, setMeiNome] = useState("");
  const [meiCnpj, setMeiCnpj] = useState("");
  const [meiPortal, setMeiPortal] = useState("");
  const [meiLogin, setMeiLogin] = useState("");
  const [meiSenha, setMeiSenha] = useState("");
  const [meiObs, setMeiObs] = useState("");
  const [meiResp, setMeiResp] = useState<string | null>(null);

  const peopleQ = useQuery({
    queryKey: ["acompanhamentos-responsaveis"],
    queryFn: () => api.admin.acompanhamentos.responsaveis(),
  });
  const people = peopleQ.data || [];

  const mesQ = useQuery({
    queryKey: ["acompanhamentos-mes", competencia],
    queryFn: () => api.admin.acompanhamentos.mes(competencia),
  });
  const kindsQ = useQuery({
    queryKey: ["acompanhamentos-kinds"],
    queryFn: () => api.admin.acompanhamentos.kinds(),
  });
  const meisQ = useQuery({
    queryKey: ["acompanhamentos-meis"],
    queryFn: () => api.admin.acompanhamentos.meis(),
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["acompanhamentos-mes"] });
    qc.invalidateQueries({ queryKey: ["acompanhamentos-kinds"] });
    qc.invalidateQueries({ queryKey: ["acompanhamentos-meis"] });
  };

  const patchTarefa = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { assigned_admin_id?: string | null; status?: string; notes?: string } }) =>
      api.admin.acompanhamentos.patchTarefa(id, data),
    onSuccess: () => {
      invalidar();
      toast.success("Tarefa atualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchKind = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { default_assignee_id?: string | null } }) =>
      api.admin.acompanhamentos.patchKind(id, data),
    onSuccess: () => {
      invalidar();
      toast.success("Responsável padrão salvo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const criarKind = useMutation({
    mutationFn: () =>
      api.admin.acompanhamentos.criarKind({
        titulo: novoTitulo,
        descricao: novoDesc,
        prazo_tipo: novoPrazo,
        prazo_n: novoN,
      }),
    onSuccess: () => {
      invalidar();
      setNovoTitulo("");
      setNovoDesc("");
      toast.success("Ramificação criada — a tarefa deste mês aparece na aba Tarefas");
      qc.invalidateQueries({ queryKey: ["acompanhamentos-mes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const criarMei = useMutation({
    mutationFn: () =>
      api.admin.acompanhamentos.criarMei({
        nome: meiNome,
        cnpj: meiCnpj,
        portal: meiPortal,
        login: meiLogin,
        senha: meiSenha,
        observacao: meiObs,
        assigned_admin_id: meiResp,
      }),
    onSuccess: () => {
      invalidar();
      setMeiNome("");
      setMeiCnpj("");
      setMeiPortal("");
      setMeiLogin("");
      setMeiSenha("");
      setMeiObs("");
      setMeiResp(null);
      toast.success("MEI guardado no cofre");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchMei = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.admin.acompanhamentos.patchMei(id, data),
    onSuccess: () => {
      invalidar();
      toast.success("MEI atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revelar = useMutation({
    mutationFn: (id: string) => api.admin.acompanhamentos.revelarSenhaMei(id),
    onSuccess: (r) => {
      toast.message("Senha", { description: r.senha || "(vazia)" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mes = mesQ.data;
  const tarefasPorKind = useMemo(() => {
    const m = new Map<string, MonthlyFollowTask>();
    for (const t of mes?.tarefas || []) m.set(t.kind_id, t);
    return m;
  }, [mes]);

  const atrasadas = (mes?.tarefas || []).filter((t) => t.status_efetivo === "atrasado").length;
  const minhas = (mes?.tarefas || []).filter((t) => t.status !== "concluido").length;

  return (
    <AdminLayout
      title="Acompanhamentos mensais"
      description="Folha até o 5º dia útil, impostos até o 10º, NFs de MEI no último dia útil — com responsável e cofre de senhas"
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Competência</Label>
          <Input type="month" className="w-44" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        </div>
        {mes && (
          <p className="text-xs text-muted-foreground">
            5º dia útil: <b>{fmtData(mes.quinto_dia_util)}</b>
            {" · "}
            10º: <b>{fmtData(mes.decimo_dia_util)}</b>
            {" · "}
            último: <b>{fmtData(mes.ultimo_dia_util)}</b>
            {atrasadas > 0 && ` · ${atrasadas} atrasada(s)`}
          </p>
        )}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Tarefas em aberto neste mês</p>
            <p className="text-2xl font-bold tabular-nums">{minhas}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Ramificações</p>
            <p className="text-2xl font-bold tabular-nums">{kindsQ.data?.filter((k) => k.ativo).length ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">MEIs no cofre</p>
            <p className="text-2xl font-bold tabular-nums">{meisQ.data?.filter((m) => m.ativo).length ?? "—"}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList className="mb-4 flex flex-wrap">
          <TabsTrigger value="tarefas">
            <ClipboardList className="mr-1 h-3.5 w-3.5" /> Tarefas do mês
          </TabsTrigger>
          <TabsTrigger value="meis">
            <KeyRound className="mr-1 h-3.5 w-3.5" /> Credenciais MEI
          </TabsTrigger>
          <TabsTrigger value="ramos">
            <CalendarCheck className="mr-1 h-3.5 w-3.5" /> Ramificações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tarefas" className="space-y-4">
          {mesQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando prazos…</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              {(mes?.tarefas || []).map((t) => (
                <TarefaCard
                  key={`${t.id}-${t.updated_at}`}
                  t={t}
                  people={people}
                  onPatch={(id, data) => patchTarefa.mutate({ id, data })}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="meis" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4" /> Guardar credencial de MEI
              </CardTitle>
              <CardDescription>
                Login e senha ficam cifrados no servidor. Use para emitir as NFs no último dia útil.
                Destine o MEI a quem vai emitir.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Nome / razão *</Label>
                <Input value={meiNome} onChange={(e) => setMeiNome(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CNPJ</Label>
                <Input
                  value={maskCNPJ(meiCnpj)}
                  onChange={(e) => setMeiCnpj(e.target.value.replace(/\D/g, "").slice(0, 14))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Portal (NFS-e, gov.br…)</Label>
                <Input value={meiPortal} onChange={(e) => setMeiPortal(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Login</Label>
                <Input value={meiLogin} onChange={(e) => setMeiLogin(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Senha</Label>
                <Input type="password" value={meiSenha} onChange={(e) => setMeiSenha(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Destinar a</Label>
                <SelectUser value={meiResp} people={people} onChange={setMeiResp} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Observação</Label>
                <Input value={meiObs} onChange={(e) => setMeiObs(e.target.value)} />
              </div>
              <Button type="button" disabled={criarMei.isPending} onClick={() => criarMei.mutate()}>
                Guardar no cofre
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {(meisQ.data || []).map((m: MeiCredential) => (
              <Card key={m.id} className={!m.ativo ? "opacity-60" : undefined}>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{m.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.cnpj ? maskCNPJ(m.cnpj) : "sem CNPJ"}
                      {m.portal ? ` · ${m.portal}` : ""}
                      {m.login ? ` · login ${m.login}` : ""}
                      {m.assigned_nome ? ` · ${m.assigned_nome}` : " · sem responsável"}
                    </p>
                    {m.observacao && <p className="mt-1 text-xs">{m.observacao}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-44">
                      <SelectUser
                        value={m.assigned_admin_id}
                        people={people}
                        onChange={(v) => patchMei.mutate({ id: m.id, data: { assigned_admin_id: v } })}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!m.tem_senha || revelar.isPending}
                      onClick={() => revelar.mutate(m.id)}
                    >
                      <Eye className="mr-1 h-3.5 w-3.5" /> Ver senha
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => patchMei.mutate({ id: m.id, data: { ativo: !m.ativo } })}
                    >
                      {m.ativo ? "Arquivar" : "Reativar"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {meisQ.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum MEI no cofre ainda.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="ramos" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Cada ramificação vira uma tarefa por mês, com prazo em dia útil bancário (segunda a
            sexta, sem feriado nacional). O responsável padrão entra nas tarefas novas.
          </p>
          {(kindsQ.data || []).map((k) => {
            const t = tarefasPorKind.get(k.id);
            return (
              <Card key={k.id}>
                <CardContent className="grid gap-3 py-4 sm:grid-cols-[1fr_16rem]">
                  <div>
                    <p className="font-medium">
                      {k.titulo} {!k.ativo && <Badge variant="outline">inativa</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {k.prazo_tipo === "ultimo_dia_bancario"
                        ? "Último dia útil do mês"
                        : `${k.prazo_n}º dia útil do mês`}
                      {t ? ` · este mês: ${fmtData(t.due_date)}` : ""}
                    </p>
                    {k.descricao && <p className="mt-1 text-sm">{k.descricao}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Responsável padrão</Label>
                    <SelectUser
                      value={k.default_assignee_id}
                      people={people}
                      onChange={(v) => patchKind.mutate({ id: k.id, data: { default_assignee_id: v } })}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Nova ramificação</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Nome</Label>
                <Input value={novoTitulo} onChange={(e) => setNovoTitulo(e.target.value)} placeholder="Ex.: Conferir eSocial" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Descrição</Label>
                <Input value={novoDesc} onChange={(e) => setNovoDesc(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Prazo</Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={novoPrazo}
                  onChange={(e) => setNovoPrazo(e.target.value as "n_dia_bancario" | "ultimo_dia_bancario")}
                >
                  <option value="n_dia_bancario">N-ésimo dia útil</option>
                  <option value="ultimo_dia_bancario">Último dia útil do mês</option>
                </select>
              </div>
              {novoPrazo === "n_dia_bancario" && (
                <div className="space-y-1">
                  <Label className="text-xs">Qual dia útil (1–22)</Label>
                  <Input type="number" min={1} max={22} value={novoN} onChange={(e) => setNovoN(Number(e.target.value) || 1)} />
                </div>
              )}
              <Button type="button" disabled={criarKind.isPending || novoTitulo.trim().length < 2} onClick={() => criarKind.mutate()}>
                Criar ramificação
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
};

export default AcompanhamentosPage;
