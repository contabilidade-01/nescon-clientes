import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, FileText, Info, Loader2 } from "lucide-react";
import { PortalPage } from "@/components/PortalPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api, type EcacDebito, type EcacGuia } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const ROTULO_TIPO: Record<string, string> = {
  SN: "DAS — Simples Nacional",
  MEI: "DAS — MEI",
  INSS: "INSS / DCTFWeb",
  MAED: "Multa por atraso de declaração",
  IRRF: "IRRF",
  OUTROS: "Tributo federal",
};

function brl(v: number | string | null | undefined) {
  const n = Number(v) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataBR(iso: string | null | undefined) {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const m2 = /^(\d{4})(\d{2})(\d{2})$/.exec(iso);
  return m2 ? `${m2[3]}/${m2[2]}/${m2[1]}` : iso;
}

function amanhaISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function rotulo(d: EcacDebito) {
  const t = String(d.tipo || "OUTROS").toUpperCase();
  if (t === "OUTROS" && d.receita) return d.receita;
  return ROTULO_TIPO[t] || d.receita || t;
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

function DebitoCard({ d, onGerar, gerando }: { d: EcacDebito; onGerar: (d: EcacDebito, data: string) => void; gerando: boolean }) {
  const [data, setData] = useState(amanhaISO());
  const podeRecalcular = d.recalculo_disponivel && d.periodo_aaaamm;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{rotulo(d)}</p>
          <p className="text-sm text-muted-foreground">
            Competência {d.periodo_apuracao} · venceu em {dataBR(d.data_vencimento)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Saldo no relatório</p>
          <p className="text-lg font-semibold">{brl(d.saldo_devedor_total)}</p>
          <p className="text-xs text-muted-foreground">original {brl(d.valor_original)}</p>
        </div>
      </div>
      {podeRecalcular ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground" htmlFor={`data-${d.periodo_aaaamm}-${d.tipo}`}>
              Vou pagar em
            </label>
            <Input
              id={`data-${d.periodo_aaaamm}-${d.tipo}`}
              type="date"
              value={data}
              min={amanhaISO()}
              onChange={(e) => setData(e.target.value)}
              className="w-44"
            />
          </div>
          <Button onClick={() => onGerar(d, data)} disabled={gerando}>
            {gerando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            Gerar guia atualizada
          </Button>
        </div>
      ) : (
        <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          Esta guia vencida não pode ser recalculada pelo portal. Fale com o escritório que a gente emite para você.
        </p>
      )}
    </div>
  );
}

const ImpostosPendentesPage = () => {
  const { company } = useAuth();
  const queryClient = useQueryClient();
  const [gerandoChave, setGerandoChave] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["ecac-pendencias"],
    queryFn: () => api.ecac.pendencias(),
    enabled: !!company,
  });

  const gerar = useMutation({
    mutationFn: ({ d, dataPagamento }: { d: EcacDebito; dataPagamento: string }) =>
      api.ecac.gerarGuia({
        tipo: (String(d.tipo).toUpperCase() === "MEI" ? "MEI" : "SN"),
        periodo_apuracao: d.periodo_aaaamm || "",
        data_pagamento: dataPagamento,
      }),
    onSuccess: async (r) => {
      toast.success(r.reuso ? "Guia já emitida hoje — abrindo a mesma guia." : "Guia gerada. Baixando o PDF…");
      queryClient.invalidateQueries({ queryKey: ["ecac-pendencias"] });
      try {
        const blob = await api.ecac.baixarGuia(r.guia.id);
        baixarBlob(blob, `${r.guia.tipo}_${r.guia.periodo_apuracao}.pdf`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível baixar o PDF.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setGerandoChave(null),
  });

  const baixar = useMutation({
    mutationFn: (g: EcacGuia) => api.ecac.baixarGuia(g.id).then((b) => ({ b, g })),
    onSuccess: ({ b, g }) => baixarBlob(b, `${g.tipo}_${g.periodo_apuracao}.pdf`),
    onError: (e: Error) => toast.error(e.message),
  });

  const totalAtraso = useMemo(() => data?.total_atraso ?? 0, [data]);

  return (
    <PortalPage title="Impostos em aberto" subtitle={company?.name} wide>
      <div className="space-y-6">
        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error instanceof Error ? error.message : "Erro ao carregar"}
          </p>
        ) : isLoading || !data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : !data.disponivel ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
            <Info className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">Ainda não há relatório da Receita para a sua empresa</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.motivo || "Assim que o escritório consultar a situação fiscal, o resultado aparece aqui."}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Relatório da Receita Federal de <b>{dataBR(data.relatorio?.data)}</b>. {data.aviso_valores}
            </p>

            {data.em_atraso.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600/70" />
                <p className="mt-2 text-sm font-medium">Nada em atraso</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  O último relatório não mostra guia vencida em aberto. Bom trabalho!
                </p>
              </div>
            ) : (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
                    <AlertTriangle className="h-4 w-4" /> Em atraso ({data.em_atraso.length})
                  </h2>
                  <span className="text-sm font-semibold">{brl(totalAtraso)}</span>
                </div>
                {data.em_atraso.map((d) => {
                  const chave = `${d.tipo}-${d.periodo_aaaamm}`;
                  return (
                    <DebitoCard
                      key={chave}
                      d={d}
                      gerando={gerandoChave === chave}
                      onGerar={(deb, dataPagamento) => {
                        setGerandoChave(chave);
                        gerar.mutate({ d: deb, dataPagamento });
                      }}
                    />
                  );
                })}
                <p className="text-xs text-muted-foreground">
                  Já pagou? O pagamento leva alguns dias para aparecer na Receita. Se quiser parcelar, fale com o escritório.
                </p>
              </section>
            )}

            {(data.parcelamento || data.pgfn || data.omissoes.length > 0) && (
              <section className="space-y-2 rounded-lg border bg-amber-50/60 p-4 text-sm dark:bg-amber-950/20">
                <p className="font-medium">Outras situações no relatório</p>
                {data.parcelamento && <p>Parcelamento: {data.parcelamento}</p>}
                {data.pgfn && <p>Dívida ativa (PGFN): {data.pgfn} — esse caso a gente trata junto com você, fale com o escritório.</p>}
                {data.omissoes.length > 0 && (
                  <p>
                    Declarações pendentes:{" "}
                    {data.omissoes.map((o) => `${o.tipo} ${o.ano}${o.meses?.length ? ` (${o.meses.join(", ")})` : ""}`).join("; ")}
                  </p>
                )}
              </section>
            )}

            {data.a_vencer.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">A vencer ({data.a_vencer.length})</h2>
                {data.a_vencer.map((d) => (
                  <div key={`${d.tipo}-${d.periodo_aaaamm}`} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                    <span>
                      {rotulo(d)} · {d.periodo_apuracao} · vence {dataBR(d.data_vencimento)}
                    </span>
                    <span className="font-medium">{brl(d.saldo_devedor_total)}</span>
                  </div>
                ))}
              </section>
            )}

            {data.guias.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Guias geradas pelo portal</h2>
                {data.guias.map((g) => (
                  <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                    <span>
                      {ROTULO_TIPO[g.tipo] || g.tipo} · competência {g.periodo_apuracao}
                      {g.vencimento ? ` · pagar até ${dataBR(g.vencimento)}` : ""}
                      {g.valor_total ? ` · ${brl(g.valor_total)}` : ""}
                      <Badge variant="outline" className="ml-2">{dataBR(g.criado_em)}</Badge>
                    </span>
                    <Button size="sm" variant="outline" onClick={() => baixar.mutate(g)} disabled={baixar.isPending}>
                      <Download className="mr-1 h-4 w-4" /> PDF
                    </Button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </PortalPage>
  );
};

export default ImpostosPendentesPage;
