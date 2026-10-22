import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Loader2, Mail, MessageCircle, Pause, Play, RefreshCw, Search, Send, XCircle } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api, type EcacCobrancaResumo, type EcacConfig, type EcacGuia } from "@/lib/api";
import { agruparDebitos, mesAno, rotuloDebito, TIPOS_PARCELA, type DebitoTela } from "@/lib/ecacDebitos";

function brl(v: number | string | null | undefined) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataBR(iso: string | null | undefined) {
  if (!iso) return "—";
  // Data pura (AAAA-MM-DD) não passa por Date: em UTC-3 viraria o dia anterior.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  if (m && (String(iso).length === 10 || /T00:00:00(\.000)?Z$/.test(String(iso)))) return `${m[3]}/${m[2]}/${m[1]}`;
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
  aberta: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  notificado: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  lembrete: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  aguardando_regeracao: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  cobranca_1: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  cobranca_2: "bg-red-500/15 text-red-600 dark:text-red-400",
  respondeu: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  escalado: "bg-red-500/25 text-red-700 dark:text-red-300",
  quitado: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  encerrado: "bg-slate-500/10 text-slate-500",
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
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
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
              <p className="mt-1 text-amber-600 dark:text-amber-400">
                Sem cadastro no portal ({cfg.ultima_importacao_resumo.sem_cadastro.length}):{" "}
                {cfg.ultima_importacao_resumo.sem_cadastro.slice(0, 8).map((s) => `${s.razao_social || ""} ${s.cnpj}`).join("; ")}
                {cfg.ultima_importacao_resumo.sem_cadastro.length > 8 ? "…" : ""}
              </p>
            )}
            {cfg.ultima_importacao_resumo.relatorios_velhos.length > 0 && (
              <p className="mt-1 text-amber-600 dark:text-amber-400">
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

function amanhaISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function cnpjFmt(v: string | null | undefined) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v || "";
}

/** 'AAAAMMDD' ou ISO → dd/mm/aaaa */
function dataCurta(v: string | null | undefined) {
  if (!v) return "—";
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dataBR(v);
}

const ROTULO_ETAPA: Record<string, string> = {
  aberta: "Aviso",
  notificar: "Aviso",
  notificado: "Aviso",
  lembrete: "Lembrete",
  cobranca_1: "Cobrança 1 (e-mail)",
  cobranca_2: "Cobrança 2 (WhatsApp)",
  consultar: "Conferir pagamento",
  aguardando_regeracao: "Conferir pagamento",
  escalado: "Escalar ao escritório",
  quitado: "Agradecimento",
};

/** "cobranca_1 (envio desligado)" → { acao: "Cobrança 1 (e-mail)", obs: "envio desligado" } */
function proximaAcao(v: string | null | undefined) {
  if (!v) return { acao: "—", obs: "" };
  const m = /^([^(]+?)\s*(?:\((.*)\))?$/.exec(v.trim());
  const chave = (m?.[1] || v).trim();
  return { acao: ROTULO_ETAPA[chave] || chave, obs: m?.[2] || "" };
}

const ROTULO_STATUS_MSG: Record<string, string> = {
  enviado: "enviado",
  pendente: "na fila",
  falhou: "falhou",
  ignorado: "ignorado",
  duplicado: "duplicado",
};

const ROTULO_EVENTO: Record<string, string> = {
  cobranca_aberta: "Cobrança aberta",
  estado: "Mudou de etapa",
  mensagem: "Mensagem",
  link_clicado: "Cliente clicou no link",
  pixel_aberto: "E-mail aberto",
  guia_gerada: "Guia gerada",
  regeracao_pedida: "Reconsulta da Receita agendada",
  importacao: "Importação",
};

function resumoEvento(e: { tipo: string; dados: Record<string, unknown> | null }) {
  const d = (e.dados || {}) as Record<string, unknown>;
  if (e.tipo === "estado") {
    const de = ROTULO_ETAPA[String(d.de)] || String(d.de ?? "");
    const para = ROTULO_ETAPA[String(d.para)] || String(d.para ?? "");
    return `${de} → ${para}`;
  }
  if (e.tipo === "mensagem") {
    const etapa = ROTULO_ETAPA[String(d.etapa)] || String(d.etapa ?? "");
    const res = Array.isArray(d.resultados)
      ? (d.resultados as Array<Record<string, unknown>>)
          .map((r) => `${r.canal}: ${ROTULO_STATUS_MSG[String(r.status)] || r.status}${r.motivo ? ` (${r.motivo})` : ""}`)
          .join(" · ")
      : "";
    return `${etapa}${res ? ` — ${res}` : ""}`;
  }
  if (e.tipo === "link_clicado") return `${d.canal ?? ""} · ${ROTULO_ETAPA[String(d.etapa)] || d.etapa || ""}`;
  return "";
}

function chaveGuia(tipo: string, periodo: string | null | undefined) {
  return `${String(tipo).toUpperCase()}-${String(periodo || "").replace(/\D/g, "")}`;
}

function Stat({ rotulo, valor, destaque }: { rotulo: string; valor: React.ReactNode; destaque?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={`text-base font-semibold ${destaque ? "text-destructive" : ""}`}>{valor}</p>
    </div>
  );
}

function DetalheDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [dataPg, setDataPg] = useState(amanhaISO());
  const [gerando, setGerando] = useState<string | null>(null);
  const [etapa, setEtapa] = useState("notificado");
  const [canal, setCanal] = useState<"email" | "whatsapp">("email");
  const { data } = useQuery({
    queryKey: ["admin-ecac-cobranca", id],
    queryFn: () => api.adminEcac.cobranca(id as number),
    enabled: id !== null,
  });
  useEffect(() => setDataPg(amanhaISO()), [id]);

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["admin-ecac-cobranca", id] });
    qc.invalidateQueries({ queryKey: ["admin-ecac-cobrancas"] });
  };

  const reenviar = useMutation({
    mutationFn: () => api.adminEcac.reenviar(id as number, etapa, canal),
    onSuccess: (r) => {
      toast.success(r.resultados.map((x) => `${x.canal}: ${x.status}${x.motivo ? ` (${x.motivo})` : ""}`).join(" · "));
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Escritório gera a guia de QUALQUER empresa (liberada ou não no portal). Mesma rota do
  // cliente com company_id: mesmas travas no central-ecac (reaproveita guia válida, teto,
  // limite diário) — chamada paga só quando precisa.
  const gerar = useMutation({
    mutationFn: (d: DebitoTela) =>
      api.ecac.gerarGuia({
        tipo: d.tipo_guia || "SN",
        periodo_apuracao: d.periodo_aaaamm || "",
        data_pagamento: dataPg,
        company_id: data?.company_id,
      }),
    onSuccess: async (r) => {
      toast.success(r.reuso ? "Guia já emitida para essa data — reaproveitada sem custo." : "Guia gerada.");
      atualizar();
      try {
        const blob = await api.ecac.baixarGuia(r.guia.id, data?.company_id);
        baixarBlob(blob, `${r.guia.tipo}_${r.guia.periodo_apuracao}.pdf`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível baixar o PDF.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setGerando(null),
  });

  const revogar = useMutation({
    mutationFn: () => api.adminEcac.revogarLinks(data?.company_id as string),
    onSuccess: (r) => {
      toast.success(r.revogados ? `${r.revogados} link(s) cancelado(s).` : "Nenhum link ativo para cancelar.");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baixar = useMutation({
    mutationFn: (g: EcacGuia) => api.ecac.baixarGuia(g.id, data?.company_id).then((b) => ({ b, g })),
    onSuccess: ({ b, g }) => baixarBlob(b, `${g.tipo}_${g.periodo_apuracao}.pdf`),
    onError: (e: Error) => toast.error(e.message),
  });

  const guiaPorDebito = new Map<string, EcacGuia>();
  for (const g of data?.guias || []) {
    const k = chaveGuia(g.tipo, g.periodo_apuracao);
    if (!guiaPorDebito.has(k)) guiaPorDebito.set(k, g); // lista vem da mais nova para a mais antiga
  }
  const prox = proximaAcao(data?.proxima_acao);
  const linhas = agruparDebitos(data?.em_atraso || []);

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug">{data ? data.name : "Cobrança"}</DialogTitle>
        </DialogHeader>
        {data && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{cnpjFmt(data.cnpj)}</span>
              {data.contact_email && <span>· {data.contact_email}</span>}
              <span className={`rounded px-2 py-0.5 font-medium ${COR_ESTADO[data.estado] || ""}`}>{data.rotulo}</span>
              {data.portal_liberado ? (
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">Portal liberado</span>
              ) : (
                <span className="rounded bg-muted px-2 py-0.5">Portal não liberado — só o escritório gera</span>
              )}
              {!data.ecac_cobranca_ativa && (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400">
                  Pausada{data.ecac_pausado_motivo ? `: ${data.ecac_pausado_motivo}` : ""}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat rotulo="Guias em atraso" valor={linhas.length} />
              <Stat rotulo="Total no relatório" valor={brl(data.total_atraso)} destaque={Number(data.total_atraso) > 0} />
              <Stat rotulo="Relatório da Receita" valor={dataBR(data.relatorio_data)} />
              <Stat
                rotulo="Próxima ação"
                valor={
                  data.encerrado_em ? (
                    <span className="text-sm">{data.encerrado_motivo || "encerrada"}</span>
                  ) : (
                    <span className="text-sm">
                      {prox.acao}
                      {data.proxima_acao_em ? ` · ${dataBR(data.proxima_acao_em)}` : ""}
                    </span>
                  )
                }
              />
            </div>

            <section className="space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h3 className="font-semibold">Débitos em atraso</h3>
                <div className="flex items-center gap-2">
                  <Label htmlFor="ecac-data-pg" className="text-xs text-muted-foreground">Data de pagamento</Label>
                  <Input id="ecac-data-pg" type="date" value={dataPg} min={amanhaISO()} onChange={(e) => setDataPg(e.target.value)} className="h-8 w-40" />
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Tributo</th>
                      <th className="px-3 py-2">Competência</th>
                      <th className="px-3 py-2">Vencimento</th>
                      <th className="px-3 py-2 text-right">Saldo</th>
                      <th className="px-3 py-2 text-right">Guia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((d, i) => {
                      const k = chaveGuia(d.tipo_guia || d.tipo, d.periodo_aaaamm);
                      const g = guiaPorDebito.get(k);
                      const pode = d.tipo_guia && d.recalculo_disponivel && d.periodo_aaaamm;
                      return (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">
                            <p className="font-medium">{rotuloDebito(d)}</p>
                            {d.codigos.length > 0 && (
                              <p className="text-xs text-muted-foreground">{d.codigos.join(" + ")}</p>
                            )}
                          </td>
                          <td className="px-3 py-2">{d.periodo_apuracao}</td>
                          <td className="px-3 py-2">{dataBR(d.data_vencimento)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{brl(d.saldo_devedor_total)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-2">
                              {g && (
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title={`Guia para pagar até ${dataCurta(g.vencimento)} · ${brl(g.valor_total)}`} onClick={() => baixar.mutate(g)}>
                                  <Download className="mr-1 h-3.5 w-3.5" /> {dataCurta(g.vencimento)}
                                </Button>
                              )}
                              {pode ? (
                                <Button
                                  size="sm"
                                  variant={g ? "outline" : "default"}
                                  className="h-7 min-w-[96px] text-xs"
                                  disabled={gerar.isPending || !dataPg}
                                  onClick={() => {
                                    setGerando(k);
                                    gerar.mutate(d);
                                  }}
                                >
                                  {gerando === k ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : g ? "Gerar de novo" : d.tipo_guia === "DCTFWEB" ? "Gerar DARF" : "Gerar guia"}
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">emitir manualmente</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Multa e juros são atualizados até a data de pagamento. Guia já emitida para a mesma data é reaproveitada sem custo.
              </p>
              {data.invalidos.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {data.invalidos.length} linha(s) do relatório ignorada(s) por parecerem erro de leitura do PDF:{" "}
                  {data.invalidos.map((d) => `${d.receita} ${d.periodo_apuracao}`).join("; ")}
                </p>
              )}
            </section>

            <ParcelasSecao
              companyId={data.company_id}
              parcelamento={data.parcelamento}
              guias={data.guias}
              onGerada={atualizar}
            />

            {data.pgfn && (
              <section className="space-y-1">
                <h3 className="font-semibold">Dívida ativa (PGFN)</h3>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                  <p>{data.pgfn}</p>
                  <p className="mt-1 text-muted-foreground">
                    A PGFN (SISPAR) não faz parte da API da Receita que o sistema usa: emita a guia no{" "}
                    <a className="underline" href="https://www.regularize.pgfn.gov.br/" target="_blank" rel="noreferrer">Regularize</a>.
                  </p>
                </div>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="font-semibold">Mensagens ({data.notificacoes.length})</h3>
              {data.notificacoes.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma ainda.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Quando</th>
                        <th className="px-3 py-2">Etapa</th>
                        <th className="px-3 py-2">Canal</th>
                        <th className="px-3 py-2">Situação</th>
                        <th className="px-3 py-2">Retorno</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.notificacoes.map((n) => (
                        <tr key={n.id} className="border-t" title={n.destino ? `Para ${n.destino}` : undefined}>
                          <td className="whitespace-nowrap px-3 py-2">{dataHoraBR(n.enviado_em || n.criado_em)}</td>
                          <td className="px-3 py-2">{ROTULO_ETAPA[n.etapa] || n.etapa}</td>
                          <td className="px-3 py-2">{n.canal === "whatsapp" ? "WhatsApp" : "E-mail"}</td>
                          <td className="px-3 py-2">
                            <span className={n.status === "falhou" ? "text-destructive" : ""}>{ROTULO_STATUS_MSG[n.status] || n.status}</span>
                            {n.modo_teste && <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">teste</span>}
                            {n.erro && <div className="text-destructive">{n.erro}</div>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {n.clicado_em ? `clicou ${dataHoraBR(n.clicado_em)}` : n.aberto_em ? `abriu ${dataHoraBR(n.aberto_em)}` : n.status_entrega || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">Reenviar</span>
                <Select value={etapa} onValueChange={setEtapa}>
                  <SelectTrigger className="h-8 w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="notificado">Aviso</SelectItem>
                    <SelectItem value="lembrete">Lembrete</SelectItem>
                    <SelectItem value="cobranca_1">Cobrança 1</SelectItem>
                    <SelectItem value="cobranca_2">Cobrança 2</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={canal} onValueChange={(v) => setCanal(v as "email" | "whatsapp")}>
                  <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">por e-mail</SelectItem>
                    <SelectItem value="whatsapp">por WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-8" disabled={reenviar.isPending} onClick={() => reenviar.mutate()}>
                  {reenviar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />} Reenviar
                </Button>
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Links sem senha</h3>
                <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={revogar.isPending || !(data.links || []).some((l) => !l.revogado_em && new Date(l.expira_em) > new Date())} onClick={() => revogar.mutate()}>
                  <XCircle className="mr-1 h-3.5 w-3.5" /> Cancelar links ativos
                </Button>
              </div>
              {(data.links || []).length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum link gerado ainda. O link é criado quando o cliente clica na mensagem ou recebe o aviso de guia do mês.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Origem</th>
                        <th className="px-3 py-2">Criado</th>
                        <th className="px-3 py-2">Vence</th>
                        <th className="px-3 py-2">Acessos</th>
                        <th className="px-3 py-2">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.links || []).map((l) => {
                        const ativo = !l.revogado_em && new Date(l.expira_em) > new Date();
                        return (
                          <tr key={l.id} className="border-t">
                            <td className="px-3 py-2">{l.origem === "cobranca" ? "Cobrança (recálculo)" : "Guias do mês"}</td>
                            <td className="px-3 py-2">{dataHoraBR(l.criado_em)}</td>
                            <td className="px-3 py-2">{dataHoraBR(l.expira_em).slice(0, 10)}</td>
                            <td className="px-3 py-2">{l.acessos}{l.ultimo_acesso_em ? ` · último ${dataHoraBR(l.ultimo_acesso_em)}` : ""}</td>
                            <td className="px-3 py-2">{l.revogado_em ? "cancelado" : ativo ? "ativo" : "vencido"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <Collapsible>
              <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                Histórico ({data.eventos.length})
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2 text-xs">
                  {data.eventos.map((e) => (
                    <li key={e.id} className="flex gap-2">
                      <span className="shrink-0 text-muted-foreground">{dataHoraBR(e.criado_em)}</span>
                      <span>
                        <b className="font-medium">{ROTULO_EVENTO[e.tipo] || e.tipo}</b>
                        {resumoEvento(e) ? ` · ${resumoEvento(e)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Parcelas de parcelamento (Simples/MEI, PERT, RELP). Consultar é chamada paga — a do dia
 * fica guardada no central-ecac e é reaproveitada sem custo. Emitir só aceita parcela que
 * consta na última consulta. A Receita calcula a parcela para o mês da emissão (sem data).
 */
function ParcelasSecao({ companyId, parcelamento, guias, onGerada }: {
  companyId: string;
  parcelamento: string | null;
  guias: EcacGuia[];
  onGerada: () => void;
}) {
  const sugestao = /\bMEI\b|SIMEI/i.test(parcelamento || "") ? "PARC_MEI" : "PARC_SN";
  const [tipo, setTipo] = useState(sugestao);
  const [aberto, setAberto] = useState(Boolean(parcelamento));
  const [gerando, setGerando] = useState<string | null>(null);
  useEffect(() => {
    setTipo(sugestao);
    setAberto(Boolean(parcelamento));
  }, [companyId, sugestao, parcelamento]);

  const qc = useQueryClient();
  const chave = ["admin-ecac-parcelas", companyId, tipo];
  const consulta = useQuery({ queryKey: chave, queryFn: () => api.adminEcac.parcelas(companyId, tipo), enabled: aberto });
  const consultar = useMutation({
    mutationFn: (forcar: boolean) => api.adminEcac.consultarParcelas(companyId, tipo, forcar),
    onSuccess: (r) => {
      qc.setQueryData(chave, r);
      toast.success(r.reuso ? "Consulta de hoje reaproveitada (sem custo)." : `${r.parcelas.length} parcela(s) disponível(is).`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const gerar = useMutation({
    mutationFn: (parcela: string) => api.ecac.gerarGuia({ tipo, periodo_apuracao: parcela, company_id: companyId }),
    onSuccess: async (r) => {
      toast.success(r.reuso ? "DAS da parcela já emitido hoje — reaproveitado sem custo." : "DAS da parcela gerado.");
      onGerada();
      try {
        baixarBlob(await api.ecac.baixarGuia(r.guia.id, companyId), `${tipo}_${r.guia.periodo_apuracao}.pdf`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível baixar o PDF.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setGerando(null),
  });
  const baixar = useMutation({
    mutationFn: (g: EcacGuia) => api.ecac.baixarGuia(g.id, companyId).then((b) => ({ b, g })),
    onSuccess: ({ b, g }) => baixarBlob(b, `${g.tipo}_${g.periodo_apuracao}.pdf`),
    onError: (e: Error) => toast.error(e.message),
  });

  const c = consulta.data;
  const guiaDaParcela = (parcela: string) => guias.find((g) => chaveGuia(g.tipo, g.periodo_apuracao) === chaveGuia(tipo, parcela));

  if (!aberto) {
    return (
      <button className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setAberto(true)}>
        Parcelamentos da Receita (Simples/MEI, PERT, RELP)…
      </button>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 className="font-semibold">Parcelamento</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="h-8 w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS_PARCELA.map((t) => (
                <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {c?.consultado && c.hoje ? (
            <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={consultar.isPending} title="Nova consulta paga" onClick={() => consultar.mutate(true)}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Consultar de novo
            </Button>
          ) : (
            <Button size="sm" className="h-8" disabled={consultar.isPending || consulta.isLoading} onClick={() => consultar.mutate(false)}>
              {consultar.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}
              Consultar parcelas
            </Button>
          )}
        </div>
      </div>
      {parcelamento && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs">{parcelamento}</p>
      )}
      {consulta.isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : !c?.consultado ? (
        <p className="text-xs text-muted-foreground">
          Ainda não consultado. A consulta é paga (cerca de R$ 0,24) e fica valendo o dia todo sem novo custo.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Consultado em {dataHoraBR(c.consultado_em)}{c.hoje ? "" : " — consulte de novo para ver a situação de hoje"}.
            {c.mensagem ? ` Receita: ${c.mensagem}` : ""}
          </p>
          {c.parcelas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma parcela para emitir neste tipo. Se o relatório mostra parcelamento, tente PERT ou RELP.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Parcela</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2 text-right">DAS</th>
                  </tr>
                </thead>
                <tbody>
                  {c.parcelas.map((p) => {
                    const g = guiaDaParcela(p.parcela);
                    return (
                      <tr key={p.parcela} className="border-t">
                        <td className="px-3 py-2 font-medium">{mesAno(p.parcela)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.valor != null ? brl(p.valor) : "—"}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            {g && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => baixar.mutate(g)}>
                                <Download className="mr-1 h-3.5 w-3.5" /> {dataHoraBR(g.criado_em).slice(0, 10)}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant={g ? "outline" : "default"}
                              className="h-7 min-w-[96px] text-xs"
                              disabled={gerar.isPending}
                              onClick={() => {
                                setGerando(p.parcela);
                                gerar.mutate(p.parcela);
                              }}
                            >
                              {gerando === p.parcela ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : g ? "Gerar de novo" : "Gerar DAS"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">A Receita calcula a parcela (com juros, se atrasada) para o mês da emissão.</p>
        </>
      )}
    </section>
  );
}

function PausarDialog({ alvo, onClose, onConfirmar }: { alvo: EcacCobrancaResumo | null; onClose: () => void; onConfirmar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState("");
  useEffect(() => setMotivo(""), [alvo]);
  return (
    <Dialog open={alvo !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pausar cobrança</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{alvo?.name} não recebe mais mensagens automáticas até você retomar.</p>
        <div className="space-y-1">
          <Label htmlFor="motivo-pausa" className="text-xs">Motivo</Label>
          <Input id="motivo-pausa" autoFocus value={motivo} placeholder="Em negociação, parcelando, cadastro errado…" onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onConfirmar(motivo.trim())}>Pausar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ImpostosEcacPage = () => {
  const qc = useQueryClient();
  const [somenteAbertas, setSomenteAbertas] = useState(true);
  const [detalhe, setDetalhe] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  const [pausarAlvo, setPausarAlvo] = useState<EcacCobrancaResumo | null>(null);

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
  const retomarCobranca = useMutation({
    mutationFn: (c: EcacCobrancaResumo) => api.adminEcac.retomarCobranca(c.id),
    onSuccess: () => {
      toast.success("Cobrança retomada: as mensagens automáticas voltam a contar a partir de hoje.");
      qc.invalidateQueries({ queryKey: ["admin-ecac-cobrancas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const lista = useMemo(() => cobrancas.data || [], [cobrancas.data]);
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    const dig = q.replace(/\D/g, "");
    return lista.filter((c) => c.name.toLowerCase().includes(q) || (dig.length >= 3 && String(c.cnpj).replace(/\D/g, "").includes(dig)));
  }, [lista, busca]);
  const totalGeral = useMemo(() => lista.filter((c) => !c.encerrado_em).reduce((s, c) => s + (Number(c.total_atraso) || 0), 0), [lista]);
  const liberadas = useMemo(() => lista.filter((c) => c.portal_liberado).length, [lista]);
  const atencao = useMemo(() => lista.filter((c) => !c.encerrado_em && (c.estado === "respondeu" || c.estado === "escalado")).length, [lista]);
  const hojeISO = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

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
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Cobranças</CardTitle>
                <CardDescription>Uma por empresa e ciclo. Clique na empresa para ver os débitos e gerar a guia.</CardDescription>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={somenteAbertas} onCheckedChange={setSomenteAbertas} /> só abertas
              </label>
            </div>
            {lista.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat rotulo="Cobranças" valor={lista.length} />
                <Stat rotulo="Total em atraso" valor={brl(totalGeral)} destaque={totalGeral > 0} />
                <Stat rotulo="Liberadas no portal" valor={liberadas} />
                <Stat rotulo="Precisam de você" valor={atencao} destaque={atencao > 0} />
              </div>
            )}
            <div className="relative max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou CNPJ" className="h-9 pl-8" />
            </div>
          </CardHeader>
          <CardContent>
            {cobrancas.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : !lista.length ? (
              <p className="text-sm text-muted-foreground">Nenhuma cobrança{somenteAbertas ? " aberta" : ""}. Importe a carteira para começar.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Empresa</th>
                      <th className="py-2 pr-3">Situação</th>
                      <th className="py-2 pr-3 text-right">Em atraso</th>
                      <th className="py-2 pr-3">Contato</th>
                      <th className="py-2 pr-3">Próxima ação</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtradas.map((c) => {
                      const prox = proximaAcao(c.proxima_acao);
                      const vencida = !c.encerrado_em && c.proxima_acao_em && c.proxima_acao_em.slice(0, 10) <= hojeISO;
                      return (
                        <tr key={c.id} className="cursor-pointer border-b align-top transition-colors hover:bg-muted/40" onClick={() => setDetalhe(c.id)}>
                          <td className="py-3 pr-3">
                            <p className="font-medium leading-tight">{c.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {cnpjFmt(c.cnpj)} · {c.contact_email || "sem e-mail"}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {c.portal_liberado && (
                                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">portal liberado</span>
                              )}
                              {!c.ecac_cobranca_ativa && (
                                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                  pausada{c.ecac_pausado_motivo ? `: ${c.ecac_pausado_motivo}` : ""}
                                </span>
                              )}
                              {!c.alertas_ativos && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">alertas desligados</span>}
                            </div>
                          </td>
                          <td className="py-3 pr-3">
                            <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${COR_ESTADO[c.estado] || ""}`}>{c.rotulo}</span>
                            <p className="mt-1 text-xs text-muted-foreground">desde {dataBR(c.estado_desde)} · ciclo {c.ciclo}</p>
                          </td>
                          <td className="py-3 pr-3 text-right">
                            <p className="font-semibold tabular-nums">{brl(c.total_atraso)}</p>
                            <p className="text-xs text-muted-foreground">{c.qtd_atraso} guia(s)</p>
                          </td>
                          <td className="whitespace-nowrap py-3 pr-3 text-xs">
                            <p className="flex items-center gap-2">
                              <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{c.emails}</span>
                              <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{c.whatsapps}</span>
                            </p>
                            <p className="mt-0.5 text-muted-foreground">
                              {c.ultimo_clique ? `clicou ${dataBR(c.ultimo_clique)}` : c.ultima_abertura ? `abriu ${dataBR(c.ultima_abertura)}` : "sem retorno"}
                            </p>
                            {Number(c.falhas) > 0 && <p className="text-destructive">{c.falhas} falha(s)</p>}
                            {Number(c.guias) > 0 && <p className="text-emerald-600 dark:text-emerald-400">{c.guias} guia(s) gerada(s)</p>}
                          </td>
                          <td className="py-3 pr-3 text-xs">
                            {c.encerrado_em ? (
                              <span className="text-muted-foreground">{c.encerrado_motivo || "encerrada"}</span>
                            ) : (
                              <>
                                <p className="font-medium">{prox.acao}</p>
                                <p className={vencida ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                                  {c.proxima_acao_em ? dataBR(c.proxima_acao_em) : "—"}
                                  {prox.obs ? ` · ${prox.obs}` : ""}
                                </p>
                              </>
                            )}
                          </td>
                          <td className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              {c.estado === "respondeu" && !c.encerrado_em && (
                                <Button size="sm" variant="outline" className="h-8" title="Cliente respondeu no WhatsApp; retomar as mensagens automáticas" onClick={() => retomarCobranca.mutate(c)}>
                                  Retomar
                                </Button>
                              )}
                              {c.ecac_cobranca_ativa ? (
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Pausar cobrança desta empresa" onClick={() => setPausarAlvo(c)}>
                                  <Pause className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Retomar cobrança desta empresa" onClick={() => retomar.mutate(c)}>
                                  <Play className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtradas.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma empresa encontrada para “{busca}”.</p>}
              </div>
            )}
            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Precisam de você = cliente respondeu ou escalado (aviso, lembrete e duas cobranças sem retorno). Quitado = relatório novo sem débito.
            </p>
          </CardContent>
        </Card>
      </div>
      <DetalheDialog id={detalhe} onClose={() => setDetalhe(null)} />
      <PausarDialog
        alvo={pausarAlvo}
        onClose={() => setPausarAlvo(null)}
        onConfirmar={(motivo) => {
          if (pausarAlvo) pausar.mutate({ c: pausarAlvo, motivo });
          setPausarAlvo(null);
        }}
      />
    </AdminLayout>
  );
};

export default ImpostosEcacPage;
