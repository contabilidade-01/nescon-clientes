/**
 * Painel gerencial de folha.
 *
 * Mostra o **essencial**, e o essencial aqui é custo: folha bruta, encargos, o que a
 * empresa gasta com atestado e quanto o quadro gira. Descontos e líquido ficaram de
 * fora de propósito — são repasse ao funcionário, não custo do empregador, e no painel
 * gerencial só competiriam por atenção com o que decide alguma coisa.
 *
 * Os números vêm de `payroll_snapshots`, gravado a partir do Extrato Mensal. Nada é
 * recalculado do PDF na leitura: o gráfico responde a um filtro de data em milissegundos
 * e não muda sozinho se um arquivo antigo for retificado sem ninguém ver.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarRange,
  CircleDollarSign,
  Gift,
  HeartPulse,
  RefreshCw,
  Users,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";

const brl = (v: number | string | null | undefined) => {
  const n = v === null || v === undefined ? null : Number(v);
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
};

const num = (v: number | string | null | undefined) => {
  const n = v === null || v === undefined ? null : Number(v);
  return n === null || !Number.isFinite(n) ? 0 : n;
};

/** 'YYYY-MM' -> 'ago/26' */
function competenciaCurta(c: string): string {
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const [a, m] = c.split("-");
  return `${meses[Number(m) - 1] ?? m}/${a.slice(2)}`;
}

/** Cartão de destaque. A variação vem ao lado porque número sozinho não informa. */
function Indicador({
  icone: Icone,
  rotulo,
  valor,
  detalhe,
  variacao,
}: {
  icone: typeof CircleDollarSign;
  rotulo: string;
  valor: string;
  detalhe?: string;
  variacao?: number | null;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-muted-foreground">{rotulo}</p>
          <Icone className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
        <p className="mt-1 text-2xl font-bold tabular-nums">{valor}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {detalhe && <span className="text-xs text-muted-foreground">{detalhe}</span>}
          {variacao !== null && variacao !== undefined && Number.isFinite(variacao) && (
            <span
              className={`text-xs font-medium ${
                variacao > 0 ? "text-amber-600 dark:text-amber-500" : "text-emerald-600 dark:text-emerald-500"
              }`}
            >
              {variacao > 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(1)}% vs. mês anterior
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Gráfico de barras em SVG puro.
 *
 * Sem biblioteca de gráfico: são doze barras e uma escala. Trazer uma dependência de
 * centenas de KB para isto engordaria o bundle (que já avisa de tamanho) sem melhorar
 * nada que o olho perceba.
 */
function Barras({ dados }: { dados: Array<{ competencia: string; valor: number }> }) {
  if (!dados.length) return null;
  const max = Math.max(...dados.map((d) => d.valor), 1);
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: 160 }}>
      {dados.map((d) => (
        <div key={d.competencia} className="flex min-w-[38px] flex-1 flex-col items-center gap-1">
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {d.valor >= 1000 ? `${Math.round(d.valor / 1000)}k` : Math.round(d.valor)}
          </span>
          <div
            className="w-full rounded-t bg-primary/80 transition-all"
            style={{ height: `${Math.max(2, (d.valor / max) * 110)}px` }}
            title={brl(d.valor)}
          />
          <span className="text-[10px] text-muted-foreground">{competenciaCurta(d.competencia)}</span>
        </div>
      ))}
    </div>
  );
}

const FolhaPage = () => {
  const queryClient = useQueryClient();
  const anoAtual = new Date().getFullYear();
  const [de, setDe] = useState(`${anoAtual}-01`);
  const [ate, setAte] = useState("");
  // "" = carteira inteira. O painel é de gestão DE CADA CLIENTE — sem o seletor ele só
  // respondia a pergunta do escritório, e a pergunta de quem paga a folha é por empresa.
  const [empresa, setEmpresa] = useState("");

  const empresas = useQuery({
    queryKey: ["admin-companies-all"],
    queryFn: () => api.admin.companies(),
  });

  const serie = useQuery({
    queryKey: ["folha-serie", de, ate, empresa],
    queryFn: () =>
      api.folha.serie({ de: de || undefined, ate: ate || undefined, companyId: empresa || undefined }),
  });

  const decimo = useQuery({
    queryKey: ["folha-13", anoAtual, empresa],
    queryFn: () => api.folha.decimoTerceiro({ ano: anoAtual, companyId: empresa || undefined }),
  });

  const problemas = useQuery({
    queryKey: ["folha-problemas", empresa],
    queryFn: () => api.folha.problemas(empresa || undefined),
  });

  const reprocessar = useMutation({
    mutationFn: () => api.folha.reprocessar(de || undefined),
    onSuccess: (r) => {
      toast.success(
        `${r.gravados} de ${r.extratos} extrato(s) processado(s)` +
          (r.com_problema ? ` · ${r.com_problema} com aviso` : "")
      );
      queryClient.invalidateQueries({ queryKey: ["folha-serie"] });
      queryClient.invalidateQueries({ queryKey: ["folha-problemas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // useMemo para o array não mudar de identidade a cada render e reexecutar o resumo.
  const linhas = useMemo(() => serie.data ?? [], [serie.data]);
  const ultimo = linhas[linhas.length - 1];
  const penultimo = linhas[linhas.length - 2];

  const variacao = (campo: keyof typeof ultimo) => {
    if (!ultimo || !penultimo) return null;
    const a = num(penultimo[campo] as string);
    const b = num(ultimo[campo] as string);
    if (!a) return null;
    return ((b - a) / a) * 100;
  };

  const acumulado = useMemo(
    () => ({
      bruta: linhas.reduce((a, l) => a + num(l.folha_bruta), 0),
      fgts: linhas.reduce((a, l) => a + num(l.fgts), 0),
      inss: linhas.reduce((a, l) => a + num(l.inss), 0),
      afastamento: linhas.reduce((a, l) => a + num(l.afastamento_valor), 0),
      afastamentoDias: linhas.reduce((a, l) => a + num(l.afastamento_dias), 0),
    }),
    [linhas]
  );

  const naoConferidos = linhas.reduce((a, l) => a + (l.nao_conferidos || 0), 0);

  return (
    <AdminLayout
      title="Painel de folha"
      description="Custo de pessoal por competência, com o histórico lido dos Extratos Mensais"
    >
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-[220px] flex-1 space-y-1">
              <Label className="text-xs">Empresa</Label>
              <Select value={empresa || "todas"} onValueChange={(v) => setEmpresa(v === "todas" ? "" : v)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Toda a carteira (somado)</SelectItem>
                  {(empresas.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="de" className="text-xs">
                De
              </Label>
              <Input id="de" type="month" className="h-9 w-40" value={de} onChange={(e) => setDe(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ate" className="text-xs">
                Até
              </Label>
              <Input id="ate" type="month" className="h-9 w-40" value={ate} onChange={(e) => setAte(e.target.value)} />
            </div>
            <Button variant="outline" onClick={() => reprocessar.mutate()} disabled={reprocessar.isPending}>
              <RefreshCw className={`mr-2 h-4 w-4 ${reprocessar.isPending ? "animate-spin" : ""}`} />
              Reler extratos
            </Button>
            <p className="text-xs text-muted-foreground">
              Reler é preciso depois de uma carga histórica: o extrato só é processado
              quando o arquivo muda.
            </p>
          </CardContent>
        </Card>

        {naoConferidos > 0 && (
          <Card className="border-amber-500/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                {naoConferidos} competência(s) em que a leitura não fechou
              </CardTitle>
              <CardDescription>
                Agrupado por causa — sessenta linhas com o mesmo motivo são um problema,
                não sessenta. Enquanto não fecharem, esses meses podem estar incompletos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(problemas.data?.motivos ?? []).map((m) => (
                <div key={m.motivo} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                  <Badge variant="outline" className="shrink-0">
                    {m.quantas}×
                  </Badge>
                  <span className="min-w-0">{m.motivo}</span>
                </div>
              ))}
              {(problemas.data?.itens ?? []).length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Ver as competências afetadas</summary>
                  <ul className="mt-2 space-y-0.5">
                    {problemas.data?.itens.map((i, n) => (
                      <li key={`${i.empresa}-${i.competencia}-${n}`}>
                        {competenciaCurta(i.competencia)} · {i.empresa}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        )}

        {linhas.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma competência no período. Se você acabou de trazer os extratos pela
              carga histórica, clique em <strong>Reler extratos</strong>.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador
                icone={CircleDollarSign}
                rotulo="Folha bruta — último mês"
                valor={brl(ultimo?.folha_bruta)}
                detalhe={ultimo ? competenciaCurta(ultimo.competencia) : undefined}
                variacao={variacao("folha_bruta")}
              />
              <Indicador
                icone={BriefcaseBusiness}
                rotulo="FGTS — último mês"
                valor={brl(ultimo?.fgts)}
                detalhe={`INSS ${brl(ultimo?.inss)}`}
                variacao={variacao("fgts")}
              />
              <Indicador
                icone={HeartPulse}
                rotulo="Atestado (15 dias) — no período"
                valor={brl(acumulado.afastamento)}
                detalhe={`${acumulado.afastamentoDias.toFixed(0)} dias pagos pela empresa`}
              />
              <Indicador
                icone={Users}
                rotulo="Turnover — último mês"
                valor={ultimo?.turnover !== null && ultimo?.turnover !== undefined ? `${ultimo.turnover}%` : "—"}
                detalhe={`${ultimo?.admitidos ?? 0} adm · ${ultimo?.demitidos ?? 0} dem · ${ultimo?.empregados ?? 0} func.`}
              />
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarRange className="h-4 w-4" /> Folha bruta por competência
                </CardTitle>
                <CardDescription>
                  Acumulado no período: <strong>{brl(acumulado.bruta)}</strong> · FGTS{" "}
                  {brl(acumulado.fgts)} · INSS {brl(acumulado.inss)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Barras dados={linhas.map((l) => ({ competencia: l.competencia, valor: num(l.folha_bruta) }))} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Detalhe por competência</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 font-medium">Competência</th>
                      <th className="py-2 text-right font-medium">Folha bruta</th>
                      <th className="py-2 text-right font-medium">INSS</th>
                      <th className="py-2 text-right font-medium">FGTS</th>
                      <th className="py-2 text-right font-medium">Atestado</th>
                      <th className="py-2 text-right font-medium">Faltas</th>
                      <th className="py-2 text-right font-medium">Quadro</th>
                      <th className="py-2 text-right font-medium">Turnover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...linhas].reverse().map((l) => (
                      <tr key={l.competencia} className="border-b last:border-0">
                        <td className="py-2">
                          {competenciaCurta(l.competencia)}
                          {l.nao_conferidos > 0 && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              conferir
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">{brl(l.folha_bruta)}</td>
                        <td className="py-2 text-right tabular-nums">{brl(l.inss)}</td>
                        <td className="py-2 text-right tabular-nums">{brl(l.fgts)}</td>
                        <td className="py-2 text-right tabular-nums">{brl(l.afastamento_valor)}</td>
                        <td className="py-2 text-right tabular-nums">{num(l.faltas_dias).toFixed(0)}d</td>
                        <td className="py-2 text-right tabular-nums">{l.empregados ?? "—"}</td>
                        <td className="py-2 text-right tabular-nums">
                          {l.turnover !== null ? `${l.turnover}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}

        {/* Projeção do 13º: o número que o cliente pergunta em outubro. */}
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gift className="h-4 w-4" /> Projeção do 13º — {anoAtual}
            </CardTitle>
            <CardDescription>
              Sobre o quadro atual, com avos proporcionais à admissão (regra dos 15 dias).
              A <strong>1ª parcela</strong> vai até 30/11 e é metade do bruto, sem desconto;
              a <strong>2ª</strong> vai até 20/12, já sem o INSS do empregado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Bruto do 13º</p>
                <p className="text-xl font-bold tabular-nums">{brl(decimo.data?.bruto)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">1ª parcela (até 30/11)</p>
                <p className="text-xl font-bold tabular-nums">{brl(decimo.data?.primeira_parcela)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">2ª parcela (até 20/12)</p>
                <p className="text-xl font-bold tabular-nums">{brl(decimo.data?.segunda_parcela)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Custo total (com FGTS)</p>
                <p className="text-xl font-bold tabular-nums">{brl(decimo.data?.custo_total)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {decimo.data?.funcionarios ?? 0} funcionário(s) na conta
              {decimo.data?.sem_salario ? (
                <>
                  {" · "}
                  <span className="text-amber-600 dark:text-amber-500">
                    {decimo.data.sem_salario} sem salário na folha mais recente ficaram de
                    fora — o total está incompleto
                  </span>
                </>
              ) : null}
              . O <strong>INSS patronal não entra</strong>: a alíquota depende do regime
              (empresa do Simples nos anexos I, II, III e V não recolhe cota patronal), e um
              percentual único daria número exato e errado para a maioria.
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default FolhaPage;
