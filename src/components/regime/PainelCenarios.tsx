import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Trophy } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { ANOS_SIMULADOS, prazosAbertos } from "@/lib/regime/regras";
import { CENARIOS, pendencias, recomendacao, simular, type Cenario, type DadosRegime, type ResultadoCenario } from "@/lib/regime/simular";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const ORDEM: Cenario[] = ["puro", "hibrido", "presumido"];
const COR: Record<Cenario, string> = { puro: "#2563eb", hibrido: "#16a34a", presumido: "#d97706" };

function Linha({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-2 text-sm", destaque && "font-semibold")}>
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="tabular-nums">{brl(valor)}</span>
    </div>
  );
}

function CartaoCenario({ r, melhor, diferenca }: { r: ResultadoCenario; melhor: boolean; diferenca: number }) {
  const c = CENARIOS[r.cenario];
  return (
    <Card className={cn(melhor && "border-emerald-500 ring-1 ring-emerald-500")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{c.nome}</CardTitle>
          {melhor && <Badge className="bg-emerald-600 hover:bg-emerald-600">Melhor</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{c.explicacao}</p>
      </CardHeader>
      <CardContent className="space-y-1">
        <Linha rotulo="Sobra no ano" valor={r.sobra} destaque />
        {!melhor && <p className="text-right text-xs text-destructive">{brl(diferenca)} a menos que o melhor</p>}
        <div className="my-2 border-t" />
        {r.das > 0 && <Linha rotulo="DAS" valor={r.das} />}
        {r.cenario !== "puro" && <Linha rotulo="IBS/CBS a recolher (vem do cliente na nota, menos créditos)" valor={r.ibsCbs} />}
        {r.creditosCompras > 0 && <Linha rotulo="Créditos nas compras" valor={r.creditosCompras} />}
        {r.irpjCsll > 0 && <Linha rotulo="IRPJ + CSLL" valor={r.irpjCsll} />}
        {r.inss > 0 && <Linha rotulo="INSS patronal fora do DAS" valor={r.inss} />}
        {r.icmsIss > 0 && <Linha rotulo="ICMS/ISS" valor={r.icmsIss} />}
        <div className="my-2 border-t" />
        <Linha rotulo="Crédito que os clientes PJ tomam" valor={r.creditoAoComprador} />
      </CardContent>
    </Card>
  );
}

/**
 * Os três regimes lado a lado no ano escolhido, a evolução de 2027 a 2033, a
 * recomendação com os motivos e o "e se" da fatia de vendas a empresas do regime regular.
 */
export function PainelCenarios({ dados, hoje }: { dados: DadosRegime; hoje: string }) {
  const [ano, setAno] = useState(2027);
  const [pctTeste, setPctTeste] = useState<number | null>(null);

  // "E se": troca só a fatia do regime regular; as outras encolhem na proporção.
  const d = useMemo<DadosRegime>(() => {
    if (pctTeste === null) return dados;
    const v = dados.vendas;
    const outros = v.simples + v.consumidor + v.governo + v.exportacao;
    const e = outros > 0 ? (100 - pctTeste) / outros : 0;
    return {
      ...dados,
      vendas: {
        regular: pctTeste,
        simples: v.simples * e,
        consumidor: outros > 0 ? v.consumidor * e : 100 - pctTeste,
        governo: v.governo * e,
        exportacao: v.exportacao * e,
      },
    };
  }, [dados, pctTeste]);

  const pend = pendencias(d);
  const bloqueado = pend.some((p) => p.bloqueia);
  const anos = useMemo(() => (bloqueado ? [] : simular(d)), [d, bloqueado]);
  const prazos = prazosAbertos(hoje);

  if (bloqueado) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-sm">
          <p className="font-medium">Faltam dados para simular:</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {pend.filter((p) => p.bloqueia).map((p) => <li key={p.campo}>{p.texto}</li>)}
          </ul>
        </CardContent>
      </Card>
    );
  }

  const rec = recomendacao(d, anos);
  const doAno = anos.find((a) => a.ano === ano)!;
  const melhorSobra = doAno.cenarios[doAno.melhor].sobra;
  const grafico = anos.map((a) => ({ ano: a.ano, ...Object.fromEntries(ORDEM.map((c) => [c, Math.round(a.cenarios[c].sobra)])) }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-emerald-500/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-emerald-600" /> Recomendação para {rec.ano}: {CENARIOS[rec.melhor].nome}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Sobram {brl(rec.diferenca)} a mais no ano do que na segunda opção, mantendo o preço que o cliente sente.
              {pctTeste !== null && " (Simulação com a fatia de vendas alterada abaixo.)"}
            </p>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {rec.motivos.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" /> Prazos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {prazos.length === 0 && <p className="text-muted-foreground">Nenhum prazo cadastrado à frente.</p>}
            {prazos.map((p) => (
              <div key={p.fim} className={cn("rounded-md border p-2", p.aberto && "border-amber-500 bg-amber-50 dark:bg-amber-950/30")}>
                <p className="font-medium">{p.aberto ? `Até ${dataBr(p.fim)}` : `${dataBr(p.inicio)} a ${dataBr(p.fim)}`}</p>
                <p className="text-xs text-muted-foreground">{p.oQue}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {pend.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {pend.map((p) => (
            <p key={p.campo + p.texto} className="flex items-start gap-1">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {p.texto}
            </p>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              E se <strong>{(pctTeste ?? dados.vendas.regular).toFixed(0)}%</strong> das vendas fossem para empresas do regime regular?
            </span>
            {pctTeste !== null && (
              <button type="button" className="text-xs text-primary underline" onClick={() => setPctTeste(null)}>
                Voltar ao informado ({dados.vendas.regular.toFixed(0)}%)
              </button>
            )}
          </div>
          <Slider min={0} max={100} step={1} value={[pctTeste ?? dados.vendas.regular]} onValueChange={([v]) => setPctTeste(v)} aria-label="Vendas para empresas do regime regular" />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Ano">
        {ANOS_SIMULADOS.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={a === ano}
            onClick={() => setAno(a)}
            className={cn("rounded-md border px-3 py-1 text-sm", a === ano ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/60")}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {ORDEM.map((c) => (
          <CartaoCenario key={c} r={doAno.cenarios[c]} melhor={doAno.melhor === c} diferenca={melhorSobra - doAno.cenarios[c].sobra} />
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quanto sobra para a empresa, ano a ano</CardTitle>
          <p className="text-xs text-muted-foreground">De 2029 a 2033 o ICMS/ISS vira IBS e o crédito que o Simples puro repassa cresce.</p>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={grafico} margin={{ left: 8, right: 16, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="ano" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={90} tickFormatter={(v: number) => brl(v)} domain={["auto", "auto"]} />
              <Tooltip formatter={(v: number, n: string) => [brl(v), CENARIOS[n as Cenario]?.nome ?? n]} />
              <Legend formatter={(n: string) => CENARIOS[n as Cenario]?.nome ?? n} />
              {ORDEM.map((c) => (
                <Line key={c} type="monotone" dataKey={c} stroke={COR[c]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
