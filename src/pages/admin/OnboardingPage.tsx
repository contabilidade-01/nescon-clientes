import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, BellRing, CheckCircle2, Copy, Download, ExternalLink, LayoutTemplate, Loader2, Mail, Plus, XCircle } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import {
  ORIGEM_LABEL,
  STATUS_LABEL,
  dataBR,
  type OnboardingResumo,
  type OnboardingStatus,
} from "@/lib/onboardingModelo";

const COLUNAS: OnboardingStatus[] = ["aguardando", "em_andamento", "em_analise", "concluido"];

const SELECT_CLASS = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm";

function CartaoOnboarding({ o, onAbrir }: { o: OnboardingResumo; onAbrir: () => void }) {
  return (
    <button type="button" onClick={onAbrir} className="w-full rounded-lg border bg-card p-3 text-left hover:bg-accent/40">
      <p className="truncate text-sm font-medium">{o.cliente_nome || o.company_name || "Sem nome"}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{ORIGEM_LABEL[o.origem]}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">
          {o.docs_enviados ?? 0}/{o.docs_total} docs
        </Badge>
        {(o.atrasados ?? 0) > 0 && (
          <Badge variant="destructive">
            <AlertTriangle className="mr-1 h-3 w-3" />
            {o.atrasados} em atraso
          </Badge>
        )}
        {!o.enviado_em && <Badge variant="outline">Link não enviado</Badge>}
      </div>
    </button>
  );
}

function Detalhe({ id, onFechar }: { id: string | null; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-onboarding", id],
    queryFn: () => api.admin.onboarding.get(id as string),
    enabled: Boolean(id),
  });
  const [motivo, setMotivo] = useState<Record<string, string>>({});

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-onboarding"] });
  };
  const revisar = useMutation({
    mutationFn: (v: { arquivoId: string; status: "aprovado" | "reprovado"; observacao?: string }) =>
      api.admin.onboarding.revisar(v.arquivoId, { status: v.status, observacao: v.observacao }),
    onSuccess: invalidar,
    onError: (e: Error) => toast.error(e.message),
  });
  const reenviar = useMutation({
    mutationFn: () => api.admin.onboarding.reenviar(id as string),
    onSuccess: (r) => {
      toast[r.enviado ? "success" : "warning"](r.enviado ? "E-mail enviado ao cliente." : "Não foi possível enviar o e-mail (sem e-mail do cliente ou SMTP). Copie o link.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baixar = async (arquivoId: string, nome: string) => {
    try {
      const blob = await api.admin.onboarding.fetchArquivo(arquivoId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const d = q.data;
  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d?.cliente_nome || "Onboarding"}</DialogTitle>
          <DialogDescription>{d ? `${ORIGEM_LABEL[d.origem]} · ${STATUS_LABEL[d.status]}` : "Carregando…"}</DialogDescription>
        </DialogHeader>
        {!d ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {d.link && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard?.writeText(d.link as string);
                      toast.success("Link copiado.");
                    }}
                  >
                    <Copy className="mr-1 h-4 w-4" /> Copiar link do cliente
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={d.link} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1 h-4 w-4" /> Ver como o cliente
                    </a>
                  </Button>
                </>
              )}
              <Button size="sm" onClick={() => reenviar.mutate()} disabled={reenviar.isPending}>
                <Mail className="mr-1 h-4 w-4" /> {d.enviado_em ? "Reenviar e-mail" : "Enviar e-mail"}
              </Button>
            </div>

            <ul className="space-y-2">
              {d.itens.map((item) => {
                if (item.tipo !== "documento") return null;
                const arqs = d.arquivos.filter((a) => a.item_id === item.id);
                return (
                  <li key={item.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {item.titulo}
                        {!item.obrigatorio && <span className="ml-2 text-xs font-normal text-muted-foreground">(opcional)</span>}
                      </p>
                      {item.prazoData && <span className="text-xs text-muted-foreground">prazo {dataBR(item.prazoData)}</span>}
                    </div>
                    {!arqs.length && <p className="mt-1 text-xs text-muted-foreground">Nada enviado ainda.</p>}
                    {arqs.map((a, i) => (
                      <div key={a.id} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <button type="button" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" onClick={() => baixar(a.id, a.file_name)}>
                          <Download className="h-3.5 w-3.5" />
                          {a.file_name}
                        </button>
                        <Badge variant={a.status === "aprovado" ? "default" : a.status === "reprovado" ? "destructive" : "secondary"}>{a.status}</Badge>
                        {i === 0 && a.status === "enviado" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => revisar.mutate({ arquivoId: a.id, status: "aprovado" })}>
                              <CheckCircle2 className="mr-1 h-4 w-4" /> Aprovar
                            </Button>
                            <Input
                              className="h-8 w-56"
                              placeholder="O que corrigir (para reprovar)"
                              value={motivo[a.id] || ""}
                              onChange={(e) => setMotivo((m) => ({ ...m, [a.id]: e.target.value }))}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!(motivo[a.id] || "").trim()}
                              onClick={() => revisar.mutate({ arquivoId: a.id, status: "reprovado", observacao: motivo[a.id] })}
                            >
                              <XCircle className="mr-1 h-4 w-4" /> Reprovar
                            </Button>
                          </>
                        )}
                        {a.observacao && <span className="text-xs text-muted-foreground">“{a.observacao}”</span>}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>

            {d.eventos.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Histórico</summary>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {d.eventos.map((e, i) => (
                    <li key={i}>
                      {new Date(e.created_at).toLocaleString("pt-BR")} — {e.tipo}
                      {e.detalhe ? `: ${e.detalhe}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Origem = "contrato" | "proposta" | "empresa" | "manual";

function NovoOnboarding({ aberto, inicial, onFechar, onCriado }: { aberto: boolean; inicial: { origem: Origem; id: string } | null; onFechar: () => void; onCriado: (id: string) => void }) {
  const [origem, setOrigem] = useState<Origem>(inicial?.origem ?? "contrato");
  const [refId, setRefId] = useState(inicial?.id ?? "");
  const [modeloId, setModeloId] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [enviar, setEnviar] = useState(true);
  const [enq, setEnq] = useState("simples");
  const [funcs, setFuncs] = useState("0");

  const contratos = useQuery({ queryKey: ["admin-contratos"], queryFn: () => api.admin.contratos.list(), enabled: aberto });
  const propostas = useQuery({ queryKey: ["admin-propostas"], queryFn: () => api.admin.propostas.list(), enabled: aberto });
  const empresas = useQuery({ queryKey: ["admin-onboarding", "empresas"], queryFn: () => api.admin.companies(), enabled: aberto });
  const modelos = useQuery({ queryKey: ["admin-onboarding", "modelos"], queryFn: () => api.admin.onboarding.modelos(), enabled: aberto });

  const criar = useMutation({
    mutationFn: () => {
      const base = { modelo_id: modeloId || undefined, enviar };
      if (origem === "contrato") return api.admin.onboarding.create({ ...base, contrato_id: refId });
      if (origem === "proposta") return api.admin.onboarding.create({ ...base, proposta_id: refId, dados: email ? { contratante: { email } } : undefined });
      if (origem === "empresa") return api.admin.onboarding.create({ ...base, company_id: refId, dados: email ? { contratante: { email } } : undefined });
      return api.admin.onboarding.create({
        ...base,
        dados: {
          contratante: { razao: nome, email },
          objeto: { enquadramento: enq, funcionariosIncluidos: Number(funcs) || 0, areaContabil: true, areaFiscal: true, areaPessoal: Number(funcs) > 0 },
        },
      });
    },
    onSuccess: (r) => {
      toast.success(r.criado ? "Onboarding criado." : "Este contrato já tinha onboarding — abrindo o existente.");
      onCriado(r.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pronto = origem === "manual" ? nome.trim().length > 1 : Boolean(refId);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo onboarding</DialogTitle>
          <DialogDescription>
            O caminho recomendado é partir do contrato assinado — ele já nasce sozinho. Aqui você cria à mão quando precisar: o mesmo cadastro vale para qualquer origem.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Criar a partir de</Label>
            <select className={SELECT_CLASS} value={origem} onChange={(e) => { setOrigem(e.target.value as Origem); setRefId(""); }}>
              <option value="contrato">Um contrato</option>
              <option value="proposta">Uma proposta</option>
              <option value="empresa">Uma empresa já cadastrada</option>
              <option value="manual">Do zero (digitar os dados)</option>
            </select>
          </div>

          {origem === "contrato" && (
            <div>
              <Label>Contrato</Label>
              <select className={SELECT_CLASS} value={refId} onChange={(e) => setRefId(e.target.value)}>
                <option value="">Selecione…</option>
                {(contratos.data || []).filter((c) => c.tipo === "contrato" && !(c as { onboarding_id?: string | null }).onboarding_id).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.titulo} ({c.status})
                  </option>
                ))}
              </select>
            </div>
          )}
          {origem === "proposta" && (
            <div>
              <Label>Proposta</Label>
              <select className={SELECT_CLASS} value={refId} onChange={(e) => setRefId(e.target.value)}>
                <option value="">Selecione…</option>
                {(propostas.data || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.titulo}
                  </option>
                ))}
              </select>
            </div>
          )}
          {origem === "empresa" && (
            <div>
              <Label>Empresa</Label>
              <select className={SELECT_CLASS} value={refId} onChange={(e) => setRefId(e.target.value)}>
                <option value="">Selecione…</option>
                {(empresas.data || []).map((c: { id: string; name: string }) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {origem === "manual" && (
            <>
              <div>
                <Label>Nome do cliente</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Enquadramento</Label>
                  <select className={SELECT_CLASS} value={enq} onChange={(e) => setEnq(e.target.value)}>
                    <option value="mei">MEI</option>
                    <option value="simples">Simples Nacional</option>
                    <option value="presumido">Lucro Presumido</option>
                    <option value="real">Lucro Real</option>
                  </select>
                </div>
                <div>
                  <Label>Funcionários</Label>
                  <Input type="number" min={0} value={funcs} onChange={(e) => setFuncs(e.target.value)} />
                </div>
              </div>
            </>
          )}
          {origem !== "contrato" && (
            <div>
              <Label>E-mail do cliente {origem === "manual" ? "" : "(opcional — completa o cadastro)"}</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}
          {origem === "contrato" && (
            <p className="text-xs text-muted-foreground">Contratos que já têm onboarding não aparecem na lista.</p>
          )}

          <div>
            <Label>Modelo</Label>
            <select className={SELECT_CLASS} value={modeloId} onChange={(e) => setModeloId(e.target.value)}>
              <option value="">Automático (o que melhor serve ao cadastro)</option>
              {(modelos.data || []).filter((m) => m.ativo).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} />
            Enviar o link por e-mail agora
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={!pronto || criar.isPending} onClick={() => criar.mutate()}>
            {criar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Lembretes automáticos de prazo: e-mail ao cliente 2 dias antes, no dia e 1, 3 e 7 dias
 * depois do vencimento de cada documento obrigatório. Nasce desligado.
 */
function PainelLembretes() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["admin-onboarding", "lembretes"], queryFn: () => api.admin.onboarding.lembretes() });
  const definir = useMutation({
    mutationFn: (ativo: boolean) => api.admin.onboarding.definirLembretes(ativo),
    onSuccess: (r) => {
      queryClient.setQueryData(["admin-onboarding", "lembretes"], r);
      toast.success(r.ativo ? "Lembretes automáticos ligados." : "Lembretes automáticos desligados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const executar = useMutation({
    mutationFn: (simular: boolean) => api.admin.onboarding.executarLembretes(simular),
    onSuccess: (r, simular) => {
      if (!r.lembretes) toast.info("Nenhum lembrete a enviar hoje.");
      else if (simular) toast.info(`Sairiam ${r.lembretes} lembrete(s) para ${r.onboardings} cliente(s): ${r.detalhes.map((d) => d.cliente || d.email).join(", ")}.`);
      else toast.success(`${r.enviados} e-mail(s) enviado(s)${r.falhas ? `, ${r.falhas} falha(s) (confira o SMTP e o e-mail do cliente)` : ""}.`);
      queryClient.invalidateQueries({ queryKey: ["admin-onboarding"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-3">
          <BellRing className="h-4 w-4 text-muted-foreground" />
          <div>
            <Label htmlFor="lembretes-auto" className="text-sm font-medium">
              Lembretes automáticos de prazo
            </Label>
            <p className="text-xs text-muted-foreground">
              E-mail ao cliente 2 dias antes, no dia e 1, 3 e 7 dias depois do prazo, só em dia útil e no horário comercial.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={executar.isPending} onClick={() => executar.mutate(true)}>
            Ver o que sairia hoje
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={executar.isPending}
            onClick={() => {
              if (window.confirm("Enviar agora os lembretes devidos hoje para os clientes?")) executar.mutate(false);
            }}
          >
            Enviar agora
          </Button>
          <Switch id="lembretes-auto" checked={Boolean(q.data?.ativo)} disabled={q.isLoading || definir.isPending} onCheckedChange={(v) => definir.mutate(v)} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function OnboardingPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState<string | null>(null);
  // Vindo de proposta/contrato (?proposta=ID ou ?contrato=ID): abre o diálogo já preenchido.
  const deLink: { origem: Origem; id: string } | null = params.get("proposta")
    ? { origem: "proposta", id: params.get("proposta") as string }
    : params.get("contrato")
      ? { origem: "contrato", id: params.get("contrato") as string }
      : null;
  const [novo, setNovo] = useState(Boolean(deLink));

  const lista = useQuery({ queryKey: ["admin-onboarding"], queryFn: () => api.admin.onboarding.list() });
  const itens = lista.data || [];

  const fecharNovo = () => {
    setNovo(false);
    if (params.get("proposta") || params.get("contrato")) setParams({}, { replace: true });
  };

  return (
    <AdminLayout title="Onboarding" description="Primeiros passos do cliente novo: o que enviar, até quando e por onde — a partir do contrato assinado ou criado à mão.">
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline">
          <Link to="/admin/onboarding/modelos">
            <LayoutTemplate className="mr-1 h-4 w-4" /> Modelos
          </Link>
        </Button>
        <Button onClick={() => setNovo(true)}>
          <Plus className="mr-1 h-4 w-4" /> Novo onboarding
        </Button>
      </div>
      <PainelLembretes />

      {lista.isLoading ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      ) : !itens.length ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhum onboarding ainda. Quando um contrato for assinado, ele aparece aqui sozinho — ou crie um à mão.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUNAS.map((col) => {
            const doStatus = itens.filter((o) => o.status === col);
            return (
              <section key={col} aria-label={STATUS_LABEL[col]} className="space-y-2">
                <h2 className="text-sm font-semibold">
                  {STATUS_LABEL[col]} <span className="font-normal text-muted-foreground">({doStatus.length})</span>
                </h2>
                {doStatus.map((o) => (
                  <CartaoOnboarding key={o.id} o={o} onAbrir={() => setAberto(o.id)} />
                ))}
              </section>
            );
          })}
        </div>
      )}

      <Detalhe id={aberto} onFechar={() => setAberto(null)} />
      {novo && (
        <NovoOnboarding
          aberto={novo}
          inicial={deLink}
          onFechar={fecharNovo}
          onCriado={(id) => {
            fecharNovo();
            queryClient.invalidateQueries({ queryKey: ["admin-onboarding"] });
            queryClient.invalidateQueries({ queryKey: ["admin-contratos"] });
            setAberto(id);
          }}
        />
      )}
    </AdminLayout>
  );
}
