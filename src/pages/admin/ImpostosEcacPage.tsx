import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Pause, Play, RefreshCw, Send, XCircle } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, type EcacCobrancaResumo, type EcacConfig } from "@/lib/api";

function brl(v: number | string | null | undefined) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataBR(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR");
}

function dataHoraBR(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR");
}

const COR_ESTADO: Record<string, string> = {
  aberta: "bg-slate-100 text-slate-800",
  notificado: "bg-blue-100 text-blue-800",
  lembrete: "bg-amber-100 text-amber-800",
  aguardando_regeracao: "bg-violet-100 text-violet-800",
  cobranca_1: "bg-orange-100 text-orange-800",
  cobranca_2: "bg-red-100 text-red-800",
  escalado: "bg-red-200 text-red-900",
  quitado: "bg-emerald-100 text-emerald-800",
  encerrado: "bg-slate-100 text-slate-600",
};

function ConfigCard({ cfg }: { cfg: EcacConfig }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<EcacConfig>>({});
  useEffect(() => setForm({}), [cfg]);
  const v = <K extends keyof EcacConfig>(k: K): EcacConfig[K] => (form[k] !== undefined ? (form[k] as EcacConfig[K]) : cfg[k]);

  const salvar = useMutation({
    mutationFn: () => api.adminEcac.salvarConfig(form),
    onSuccess: () => {
      toast.success("Configuração salva.");
      qc.invalidateQueries({ queryKey: ["admin-ecac-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const importar = useMutation({
    mutationFn: () => api.adminEcac.importar(),
    onSuccess: (r) => {
      toast.success(r.pulado ? `Importação pulada: ${r.motivo}` : `Importação ${r.ciclo}: ${r.casadas} empresas, ${r.abertas} cobrança(s) aberta(s).`);
      qc.invalidateQueries({ queryKey: ["admin-ecac-config"] });
      qc.invalidateQueries({ queryKey: ["admin-ecac-cobrancas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const processar = useMutation({
    mutationFn: () => api.adminEcac.processar(),
    onSuccess: (r) => {
      const relevantes = r.feitos.filter((f) => !["nada", "aguardar"].includes(String(f.acao)));
      toast.success(`${r.total} cobrança(s) avaliada(s); ${relevantes.length} com ação.`);
      qc.invalidateQueries({ queryKey: ["admin-ecac-cobrancas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const central = cfg.central_ecac;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuração</CardTitle>
        <CardDescription>
          Importação e envio nascem desligados. Em <b>modo teste</b> toda mensagem vai para o e-mail/WhatsApp do escritório
          com o nome da empresa no assunto — é assim que se confere o texto antes de liberar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 text-sm">
          {cfg.integracao_configurada ? (
            central && !central.erro ? (
              <span className="flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> central-ecac respondendo
                {central.limite_gasto
                  ? ` · gasto do mês ${brl(central.limite_gasto.gasto_mes)}${central.limite_gasto.sem_teto ? " (sem teto)" : ` de ${brl(central.limite_gasto.limite)}`}`
                  : ""}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="h-4 w-4" /> central-ecac: {central?.erro || "sem resposta"}
              </span>
            )
          ) : (
            <span className="flex items-center gap-1 text-destructive">
              <XCircle className="h-4 w-4" /> Defina ECAC_API_URL e ECAC_INTEGRACAO_TOKEN (32+ caracteres) no ambiente da API.
            </span>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span>Importar todo mês</span>
            <Switch checked={v("importacao_ativa")} onCheckedChange={(c) => setForm((f) => ({ ...f, importacao_ativa: c }))} />
          </label>
          <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span>Enviar mensagens</span>
            <Switch checked={v("envio_ativo")} onCheckedChange={(c) => setForm((f) => ({ ...f, envio_ativo: c }))} />
          </label>
          <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span>Modo teste (só escritório)</span>
            <Switch checked={v("modo_teste")} onCheckedChange={(c) => setForm((f) => ({ ...f, modo_teste: c }))} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              ["dia_importacao", "Dia da importação (1–28)"],
              ["dias_lembrete", "Dias úteis até o lembrete"],
              ["dias_regeracao", "Dias úteis após recálculo"],
              ["dias_cobranca", "Dias úteis entre cobranças"],
              ["max_regeracoes", "Regerações por ciclo"],
            ] as Array<[keyof EcacConfig, string]>
          ).map(([k, rotulo]) => (
            <div key={k}>
              <Label htmlFor={`cfg-${k}`} className="text-xs">{rotulo}</Label>
              <Input
                id={`cfg-${k}`}
                type="number"
                min={k === "max_regeracoes" ? 0 : 1}
                max={k === "dia_importacao" ? 28 : 30}
                value={Number(v(k))}
                onChange={(e) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }))}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="cfg-nome" className="text-xs">Nome do escritório nas mensagens</Label>
            <Input id="cfg-nome" value={String(v("escritorio_nome") || "")} onChange={(e) => setForm((f) => ({ ...f, escritorio_nome: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="cfg-email" className="text-xs">E-mail do escritório (modo teste e escaladas)</Label>
            <Input id="cfg-email" type="email" value={String(v("escritorio_email") || "")} onChange={(e) => setForm((f) => ({ ...f, escritorio_email: e.target.value }))} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          WhatsApp do escritório: {cfg.escritorio_whatsapp || "não configurado"} (o mesmo dos alertas). Último ciclo importado:{" "}
          {cfg.ultimo_ciclo_importado || "nenhum"} {cfg.ultima_importacao ? `em ${dataHoraBR(cfg.ultima_importacao)}` : ""}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || Object.keys(form).length === 0}>
            {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
          </Button>
          <Button variant="outline" onClick={() => importar.mutate()} disabled={importar.isPending || !cfg.integracao_configurada}>
            {importar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Importar agora (custo zero)
          </Button>
          <Button variant="outline" onClick={() => processar.mutate()} disabled={processar.isPending}>
            {processar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Processar cobranças agora
          </Button>
        </div>

        {cfg.ultima_importacao_resumo && !cfg.ultima_importacao_resumo.pulado && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Última importação ({cfg.ultima_importacao_resumo.ciclo})</p>
            <p className="text-muted-foreground">
              {cfg.ultima_importacao_resumo.total_ecac} empresas no e-CAC · {cfg.ultima_importacao_resumo.casadas} casadas ·{" "}
              {cfg.ultima_importacao_resumo.com_atraso} com atraso · {cfg.ultima_importacao_resumo.abertas} cobrança(s) aberta(s)
            </p>
            {cfg.ultima_importacao_resumo.sem_cadastro.length > 0 && (
              <p className="mt-1 text-amber-700">
                Sem cadastro no portal ({cfg.ultima_importacao_resumo.sem_cadastro.length}):{" "}
                {cfg.ultima_importacao_resumo.sem_cadastro.slice(0, 8).map((s) => `${s.razao_social || ""} ${s.cnpj}`).join("; ")}
                {cfg.ultima_importacao_resumo.sem_cadastro.length > 8 ? "…" : ""}
              </p>
            )}
            {cfg.ultima_importacao_resumo.relatorios_velhos.length > 0 && (
              <p className="mt-1 text-amber-700">
                Relatório velho, não cobradas ({cfg.ultima_importacao_resumo.relatorios_velhos.length}):{" "}
                {cfg.ultima_importacao_resumo.relatorios_velhos.slice(0, 8).map((s) => s.name).join("; ")}
              </p>
            )}
            {cfg.ultima_importacao_resumo.erros.length > 0 && (
              <p className="mt-1 text-destructive">Erros: {cfg.ultima_importacao_resumo.erros.map((e) => `${e.cnpj}: ${e.erro}`).join("; ")}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DetalheDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-ecac-cobranca", id],
    queryFn: () => api.adminEcac.cobranca(id as number),
    enabled: id !== null,
  });
  const reenviar = useMutation({
    mutationFn: ({ etapa, canal }: { etapa: string; canal: "email" | "whatsapp" }) => api.adminEcac.reenviar(id as number, etapa, canal),
    onSuccess: (r) => {
      toast.success(r.resultados.map((x) => `${x.canal}: ${x.status}${x.motivo ? ` (${x.motivo})` : ""}`).join(" · "));
      qc.invalidateQueries({ queryKey: ["admin-ecac-cobranca", id] });
      qc.invalidateQueries({ queryKey: ["admin-ecac-cobrancas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data ? `${data.name} — ${data.rotulo}` : "Cobrança"}</DialogTitle>
        </DialogHeader>
        {data && (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Ciclo {data.ciclo} · relatório de {dataBR(data.relatorio_data)} · {data.em_atraso.length} guia(s) em atraso · {brl(data.total_atraso)}
              {data.ecac_pausado_motivo ? ` · PAUSADA: ${data.ecac_pausado_motivo}` : ""}
            </p>
            <div>
              <p className="font-medium">Em atraso</p>
              <ul className="mt-1 space-y-1">
                {data.em_atraso.map((d, i) => (
                  <li key={i}>
                    {d.tipo} {d.periodo_apuracao} · venc. {dataBR(d.data_vencimento)} · {brl(d.saldo_devedor_total)}
                  </li>
                ))}
              </ul>
              {data.invalidos.length > 0 && (
                <p className="mt-1 text-amber-700">
                  {data.invalidos.length} linha(s) do relatório ignorada(s) por parecerem fantasma do leitor de PDF:{" "}
                  {data.invalidos.map((d) => `${d.receita} ${d.periodo_apuracao} (${d.motivos.join(", ")})`).join("; ")}
                </p>
              )}
              {data.pgfn && <p className="mt-1">PGFN: {data.pgfn}</p>}
              {data.parcelamento && <p className="mt-1">Parcelamento: {data.parcelamento}</p>}
            </div>
            <div>
              <p className="font-medium">Mensagens</p>
              {data.notificacoes.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma ainda.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {data.notificacoes.map((n) => (
                    <li key={n.id} className="rounded border p-2">
                      <span className="font-medium">{n.etapa}</span> · {n.canal} · {n.status}
                      {n.modo_teste ? " (teste)" : ""} · para {n.destino || "—"} · {dataHoraBR(n.enviado_em || n.criado_em)}
                      {n.status_entrega ? ` · ${n.status_entrega}` : ""}
                      {n.clicado_em ? ` · clicou ${dataHoraBR(n.clicado_em)}` : n.aberto_em ? ` · abriu (pixel) ${dataHoraBR(n.aberto_em)}` : ""}
                      {n.erro ? <span className="text-destructive"> · {n.erro}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {(["notificado", "lembrete", "cobranca_1"] as const).map((et) => (
                  <Button key={et} size="sm" variant="outline" disabled={reenviar.isPending} onClick={() => reenviar.mutate({ etapa: et, canal: "email" })}>
                    Reenviar {et} (e-mail)
                  </Button>
                ))}
                {(["notificado", "lembrete", "cobranca_2"] as const).map((et) => (
                  <Button key={`${et}-w`} size="sm" variant="outline" disabled={reenviar.isPending} onClick={() => reenviar.mutate({ etapa: et, canal: "whatsapp" })}>
                    Reenviar {et} (WhatsApp)
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <p className="font-medium">Guias geradas ({data.guias.length})</p>
              <ul className="mt-1 space-y-1">
                {data.guias.map((g) => (
                  <li key={g.id}>
                    {g.tipo} {g.periodo_apuracao} · pagar até {g.vencimento ? dataBR(`${g.vencimento.slice(0, 4)}-${g.vencimento.slice(4, 6)}-${g.vencimento.slice(6, 8)}`) : "—"} ·{" "}
                    {brl(g.valor_total)} · {dataHoraBR(g.criado_em)} {g.reuso ? "(reaproveitada)" : ""}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium">Trilha</p>
              <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {data.eventos.map((e) => (
                  <li key={e.id}>
                    {dataHoraBR(e.criado_em)} · {e.tipo} {e.dados ? JSON.stringify(e.dados).slice(0, 160) : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const ImpostosEcacPage = () => {
  const qc = useQueryClient();
  const [somenteAbertas, setSomenteAbertas] = useState(true);
  const [detalhe, setDetalhe] = useState<number | null>(null);

  const cfg = useQuery({ queryKey: ["admin-ecac-config"], queryFn: () => api.adminEcac.config() });
  const cobrancas = useQuery({
    queryKey: ["admin-ecac-cobrancas", somenteAbertas],
    queryFn: () => api.adminEcac.cobrancas({ abertas: somenteAbertas }),
  });

  const pausar = useMutation({
    mutationFn: ({ c, motivo }: { c: EcacCobrancaResumo; motivo: string }) => api.adminEcac.pausar(c.company_id, motivo),
    onSuccess: () => {
      toast.success("Cobrança pausada para a empresa.");
      qc.invalidateQueries({ queryKey: ["admin-ecac-cobrancas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const retomar = useMutation({
    mutationFn: (c: EcacCobrancaResumo) => api.adminEcac.retomar(c.company_id),
    onSuccess: () => {
      toast.success("Cobrança retomada.");
      qc.invalidateQueries({ queryKey: ["admin-ecac-cobrancas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminLayout
      title="Impostos e-CAC — cobrança amigável"
      description="Pendências vindas do central-ecac; aviso, lembrete, recálculo e cobrança por e-mail/WhatsApp."
    >
      <div className="space-y-6">
        {cfg.data ? <ConfigCard cfg={cfg.data} /> : <p className="text-sm text-muted-foreground">Carregando configuração…</p>}

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Cobranças</CardTitle>
              <CardDescription>Uma por empresa e ciclo. Pausar vale para a empresa (em negociação, parcelando, cadastro a corrigir).</CardDescription>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={somenteAbertas} onCheckedChange={setSomenteAbertas} /> só abertas
            </label>
          </CardHeader>
          <CardContent>
            {cobrancas.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : !cobrancas.data?.length ? (
              <p className="text-sm text-muted-foreground">Nenhuma cobrança{somenteAbertas ? " aberta" : ""}. Importe a carteira para começar.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-2">Empresa</th>
                      <th className="py-2 pr-2">Ciclo</th>
                      <th className="py-2 pr-2">Estado</th>
                      <th className="py-2 pr-2 text-right">Atraso</th>
                      <th className="py-2 pr-2">Msgs</th>
                      <th className="py-2 pr-2">Sinais</th>
                      <th className="py-2 pr-2">Próxima ação</th>
                      <th className="py-2 pr-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cobrancas.data.map((c) => (
                      <tr key={c.id} className="border-b align-top">
                        <td className="py-2 pr-2">
                          <button className="text-left font-medium hover:underline" onClick={() => setDetalhe(c.id)}>
                            {c.name}
                          </button>
                          <div className="text-xs text-muted-foreground">{c.cnpj} · {c.contact_email || "sem e-mail"}</div>
                          {!c.ecac_cobranca_ativa && (
                            <Badge variant="outline" className="mt-1 border-amber-400 text-amber-700">pausada{c.ecac_pausado_motivo ? `: ${c.ecac_pausado_motivo}` : ""}</Badge>
                          )}
                          {!c.alertas_ativos && <Badge variant="outline" className="mt-1">alertas desligados</Badge>}
                        </td>
                        <td className="py-2 pr-2">{c.ciclo}</td>
                        <td className="py-2 pr-2">
                          <span className={`rounded px-2 py-0.5 text-xs ${COR_ESTADO[c.estado] || ""}`}>{c.rotulo}</span>
                          <div className="text-xs text-muted-foreground">desde {dataBR(c.estado_desde)}</div>
                        </td>
                        <td className="py-2 pr-2 text-right">
                          {c.qtd_atraso} · {brl(c.total_atraso)}
                        </td>
                        <td className="py-2 pr-2 text-xs">
                          {c.emails} e-mail · {c.whatsapps} wpp
                          {Number(c.falhas) > 0 && <div className="text-destructive">{c.falhas} falha(s)</div>}
                        </td>
                        <td className="py-2 pr-2 text-xs">
                          {c.ultimo_clique ? `clicou ${dataBR(c.ultimo_clique)}` : c.ultima_abertura ? `abriu ${dataBR(c.ultima_abertura)}` : "—"}
                          {Number(c.guias) > 0 && <div>{c.guias} guia(s) gerada(s)</div>}
                          {c.regeracoes > 0 && <div>{c.regeracoes} regeração(ões)</div>}
                        </td>
                        <td className="py-2 pr-2 text-xs">
                          {c.encerrado_em ? c.encerrado_motivo || "encerrada" : `${c.proxima_acao || "—"} ${c.proxima_acao_em ? dataBR(c.proxima_acao_em) : ""}`}
                        </td>
                        <td className="py-2 pr-2">
                          {c.ecac_cobranca_ativa ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Pausar cobrança desta empresa"
                              onClick={() => {
                                const motivo = window.prompt("Motivo da pausa (em negociação, parcelando, cadastro errado…):", "");
                                if (motivo !== null) pausar.mutate({ c, motivo });
                              }}
                            >
                              <Pause className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" title="Retomar" onClick={() => retomar.mutate(c)}>
                              <Play className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Escalado = aviso, lembrete e duas cobranças sem retorno: precisa de contato humano. Quitado = relatório novo sem débito.
            </p>
          </CardContent>
        </Card>
      </div>
      <DetalheDialog id={detalhe} onClose={() => setDetalhe(null)} />
    </AdminLayout>
  );
};

export default ImpostosEcacPage;
