import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, Building2, CheckCircle2, Download, FileText, Loader2, LogIn, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, type AcessoGuias, type EcacGuia } from "@/lib/api";
import { agruparDebitos, rotuloDebito, type DebitoTela } from "@/lib/ecacDebitos";
import { competenciaLabel, dueText, dueTone, DUE_TONE_CLASS, formatDue } from "@/lib/deliverableDisplay";
import { cn } from "@/lib/utils";

function brl(v: number | string | null | undefined) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataBR(v: string | null | undefined) {
  if (!v) return "—";
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

function amanhaISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
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

const ROTULO_DOC: Record<string, string> = {
  DAS: "DAS — Simples Nacional",
  DCTF_WEB: "INSS (DCTFWeb)",
  FGTS: "FGTS",
  PARCELAMENTO: "Parcelamento",
};

/**
 * Tela aberta pelo link do WhatsApp/e-mail — SEM SENHA. Mostra só as guias da empresa:
 * as do mês (baixar) e, quando o link veio da cobrança, os impostos em atraso com a data
 * de pagamento para recalcular. Nada além disso do portal.
 */
const GuiasLinkPage = () => {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const [dataPg, setDataPg] = useState(amanhaISO());
  const [gerando, setGerando] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["acesso-guias", token],
    queryFn: () => api.acesso.get(token),
    retry: false,
    enabled: !!token,
  });

  const gerar = useMutation({
    mutationFn: (d: DebitoTela) =>
      api.acesso.gerar(token, { tipo: d.tipo_guia || "SN", periodo_apuracao: d.periodo_aaaamm || "", data_pagamento: dataPg }),
    onSuccess: async (r) => {
      toast.success(r.reuso ? "Guia já emitida para essa data — baixando a mesma." : "Guia pronta. Baixando…");
      qc.invalidateQueries({ queryKey: ["acesso-guias", token] });
      try {
        baixarBlob(await api.acesso.baixar(token, r.guia.id), `${r.guia.tipo}_${r.guia.periodo_apuracao}.pdf`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível baixar.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setGerando(null),
  });

  const baixarGerada = useMutation({
    mutationFn: (g: EcacGuia) => api.acesso.baixar(token, g.id).then((b) => ({ b, g })),
    onSuccess: ({ b, g }) => baixarBlob(b, `${g.tipo}_${g.periodo_apuracao}.pdf`),
    onError: (e: Error) => toast.error(e.message),
  });

  const atraso = agruparDebitos(data?.em_atraso || []);

  const falarEscritorio = data?.contato_whatsapp ? (
    <Button asChild variant="outline" size="sm" className="w-full">
      <a href={`https://wa.me/${data.contato_whatsapp}`} target="_blank" rel="noopener noreferrer">
        <MessageCircle className="mr-1 h-4 w-4" /> Pedir a guia atualizada ao escritório
      </a>
    </Button>
  ) : null;

  /**
   * Guia do mês vencida: não oferece a guia antiga (o banco recusa depois do vencimento).
   * Se o relatório da Receita mostra o débito em aberto e a empresa tem o recálculo
   * liberado, gera a guia atualizada aqui; senão, orienta a falar com o escritório.
   */
  const guiaVencida = (g: AcessoGuias["guias_mes"][number]) => {
    const deb = agruparDebitos(g.debitos || [])[0];
    if (g.situacao === "em_aberto" && deb) {
      if (data?.origem === "cobranca") {
        return <p className="text-sm text-muted-foreground">Venceu e consta em aberto na Receita — gere a guia atualizada em "Impostos em atraso", acima.</p>;
      }
      if (data?.recalculo_liberado && deb.pode_gerar) {
        const chave = `mes-${deb.tipo_guia}-${deb.periodo_aaaamm}`;
        return (
          <div className="space-y-2">
            <p className="text-sm">Venceu e consta em aberto na Receita ({brl(deb.saldo_devedor_total)} no relatório). Gere a guia atualizada:</p>
            <Input type="date" value={dataPg} min={amanhaISO()} onChange={(e) => setDataPg(e.target.value)} aria-label="Data de pagamento" />
            <Button
              className="w-full"
              size="lg"
              disabled={gerar.isPending || !dataPg}
              onClick={() => {
                setGerando(chave);
                gerar.mutate(deb);
              }}
            >
              {gerando === chave ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <FileText className="mr-2 h-5 w-5" />}
              Gerar guia para {dataBR(dataPg)}
            </Button>
          </div>
        );
      }
      return (
        <div className="space-y-2">
          <p className="text-sm">Venceu e consta em aberto na Receita. Peça a guia atualizada ao escritório.</p>
          {falarEscritorio}
        </div>
      );
    }
    if (g.situacao === "sem_registro") {
      return (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Venceu. O relatório da Receita de {dataBR(String(data?.relatorio_data || "").slice(0, 10))} não mostra débito — se já pagou, está tudo certo. Se não pagou, peça a guia atualizada.
          </p>
          {falarEscritorio}
        </div>
      );
    }
    const fgts = String(g.doc_type || "").toUpperCase() === "FGTS";
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {fgts
            ? "Venceu. A guia de FGTS atualizada sai pelo FGTS Digital — se ainda não pagou, peça ao escritório."
            : "Venceu. Se ainda não pagou, peça a guia atualizada ao escritório."}
        </p>
        {falarEscritorio}
      </div>
    );
  };
  const total = atraso.reduce((s, d) => s + (Number(d.saldo_devedor_total) || 0), 0);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
        {isLoading ? (
          <p className="py-20 text-center text-sm text-muted-foreground">Carregando suas guias…</p>
        ) : error || !data ? (
          <Card>
            <CardContent className="p-6 text-center">
              <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground/60" />
              <h1 className="mt-3 text-lg font-bold">Link vencido ou inválido</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Peça um novo link ao escritório ou entre no portal com seu login.
              </p>
              <Button asChild className="mt-4 w-full">
                <Link to="/login">
                  <LogIn className="mr-2 h-4 w-4" /> Entrar no portal
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Building2 className="h-4 w-4 shrink-0" /> <span className="truncate">{data.empresa.name}</span>
              </p>
              <h1 className="mt-1 text-xl font-bold">Suas guias</h1>
            </div>

            {data.origem === "cobranca" && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
                    <AlertTriangle className="h-4 w-4" /> Impostos em atraso
                  </h2>
                  {atraso.length > 0 && <span className="text-sm font-semibold">{brl(total)}</span>}
                </div>
                {atraso.length === 0 ? (
                  <Card>
                    <CardContent className="flex items-center gap-2 p-4 text-sm">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Nada em atraso no último relatório da Receita.
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <Card>
                      <CardContent className="space-y-1 p-4">
                        <label htmlFor="data-pg" className="text-sm font-medium">Quando você vai pagar?</label>
                        <Input id="data-pg" type="date" value={dataPg} min={amanhaISO()} onChange={(e) => setDataPg(e.target.value)} />
                        <p className="text-xs text-muted-foreground">A guia sai com multa e juros calculados até essa data.</p>
                      </CardContent>
                    </Card>
                    {atraso.map((d) => {
                      const chave = `${d.tipo_guia}-${d.periodo_aaaamm}`;
                      const pode = d.pode_gerar;
                      return (
                        <Card key={chave + d.receita}>
                          <CardContent className="space-y-3 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold">{rotuloDebito(d)}</p>
                                <p className="text-sm text-muted-foreground">
                                  Competência {d.periodo_apuracao} · venceu em {dataBR(d.data_vencimento)}
                                </p>
                              </div>
                              <p className="whitespace-nowrap font-semibold tabular-nums">{brl(d.saldo_devedor_total)}</p>
                            </div>
                            {pode ? (
                              <Button
                                className="w-full"
                                size="lg"
                                disabled={gerar.isPending || !dataPg}
                                onClick={() => {
                                  setGerando(chave);
                                  gerar.mutate(d);
                                }}
                              >
                                {gerando === chave ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <FileText className="mr-2 h-5 w-5" />}
                                Gerar guia para {dataBR(dataPg)}
                              </Button>
                            ) : (
                              <p className="text-sm text-muted-foreground">Esta guia o escritório emite para você — fale com a gente.</p>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                    {data.aviso_valores && <p className="text-xs text-muted-foreground">{data.aviso_valores}</p>}
                  </>
                )}
              </section>
            )}

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Guias do mês</h2>
              {data.guias_mes.length === 0 ? (
                <Card>
                  <CardContent className="p-4 text-sm text-muted-foreground">Nenhuma guia do mês disponível agora.</CardContent>
                </Card>
              ) : (
                data.guias_mes.map((g) => (
                  <Card key={g.arquivo_url}>
                    <CardContent className="space-y-3 p-4">
                      <div>
                        <p className="font-semibold">{(g.doc_type && ROTULO_DOC[g.doc_type]) || g.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {g.competencia ? `Competência ${competenciaLabel(g.competencia)}` : g.title}
                          {g.due_date && (
                            <>
                              {" · vence "}
                              {formatDue(g.due_date)}{" "}
                              <span className={cn(DUE_TONE_CLASS[dueTone(g.due_date, g.status as "pending" | "paid")])}>
                                {dueText(g.due_date, g.status as "pending" | "paid")}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      {!g.vencida ? (
                        <Button asChild variant="outline" size="lg" className="w-full">
                          <a href={api.acesso.arquivoUrl(g.arquivo_url)} target="_blank" rel="noopener noreferrer">
                            <Download className="mr-2 h-5 w-5" /> Baixar guia
                          </a>
                        </Button>
                      ) : (
                        guiaVencida(g)
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </section>

            {(data.guias_geradas || []).length > 0 && (
              <section className="space-y-1">
                <h2 className="text-sm font-semibold">Guias que você já gerou</h2>
                {(data.guias_geradas || []).map((g) => (
                  <button
                    key={g.id}
                    className="flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2 text-left text-sm hover:bg-muted/50"
                    onClick={() => baixarGerada.mutate(g)}
                  >
                    <span>{g.tipo === "DCTFWEB" ? "DARF INSS" : g.tipo === "MEI" ? "DAS MEI" : "DAS"} · {g.periodo_apuracao.slice(4)}/{g.periodo_apuracao.slice(0, 4)} · pagar até {dataBR(g.vencimento)}</span>
                    <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </section>
            )}

            <div className="space-y-2 rounded-lg border bg-card p-4 text-center text-xs text-muted-foreground">
              <p>Não é a sua empresa ou ficou alguma dúvida? Fale com o escritório.</p>
              {data.contato_whatsapp && (
                <Button asChild variant="ghost" size="sm">
                  <a href={`https://wa.me/${data.contato_whatsapp}`} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="mr-1 h-4 w-4" /> WhatsApp do escritório
                  </a>
                </Button>
              )}
              <p>Este link é pessoal e vale até {dataBR(String(data.expira_em).slice(0, 10))}. Não encaminhe.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default GuiasLinkPage;
