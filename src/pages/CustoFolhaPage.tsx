/**
 * Painel de folha do CLIENTE — o custo da empresa dele, no portal dele.
 *
 * Mesma API do painel do escritório (`/api/folha/*`), com a empresa resolvida pela
 * sessão. Uma consulta só para os dois lados evita o que acontece quando são duas: os
 * números divergirem porque alguém corrigiu um lado e esqueceu o outro.
 *
 * A leitura aqui é diferente da do escritório, e o texto acompanha: o cliente não quer
 * comparar carteira, quer saber quanto a folha dele custou e quanto vai custar o 13º.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, Gift, HeartPulse, Users } from "lucide-react";
import { PortalPage } from "@/components/PortalPage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const brl = (v: number | string | null | undefined) => {
  const n = v === null || v === undefined ? null : Number(v);
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
};

const num = (v: number | string | null | undefined) => {
  const n = v === null || v === undefined ? null : Number(v);
  return n === null || !Number.isFinite(n) ? 0 : n;
};

function competenciaCurta(c: string): string {
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const [a, m] = c.split("-");
  return `${meses[Number(m) - 1] ?? m}/${a.slice(2)}`;
}

const CustoFolhaPage = () => {
  const { company } = useAuth();
  const anoAtual = new Date().getFullYear();
  const [de, setDe] = useState(`${anoAtual}-01`);

  const serie = useQuery({
    queryKey: ["cliente-folha", de],
    queryFn: () => api.folha.serie({ de: de || undefined }),
    enabled: !!company,
  });

  const decimo = useQuery({
    queryKey: ["cliente-13", anoAtual],
    queryFn: () => api.folha.decimoTerceiro({ ano: anoAtual }),
    enabled: !!company,
  });

  const linhas = useMemo(() => serie.data ?? [], [serie.data]);
  const ultimo = linhas[linhas.length - 1];
  const max = Math.max(...linhas.map((l) => num(l.folha_bruta)), 1);

  const acumulado = useMemo(
    () => ({
      bruta: linhas.reduce((a, l) => a + num(l.folha_bruta), 0),
      fgts: linhas.reduce((a, l) => a + num(l.fgts), 0),
      inss: linhas.reduce((a, l) => a + num(l.inss), 0),
      atestado: linhas.reduce((a, l) => a + num(l.afastamento_valor), 0),
      atestadoDias: linhas.reduce((a, l) => a + num(l.afastamento_dias), 0),
    }),
    [linhas]
  );

  return (
    <PortalPage title="Custo de folha" subtitle="O que a sua folha custou, mês a mês" wide>
      {serie.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      ) : linhas.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Ainda não há folha processada para mostrar aqui. Assim que o Extrato Mensal
            entrar, o custo aparece.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="de" className="text-xs">
                A partir de
              </Label>
              <Input
                id="de"
                type="month"
                className="h-9 w-40"
                value={de}
                onChange={(e) => setDe(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icone: CircleDollarSign,
                rotulo: "Folha bruta — último mês",
                valor: brl(ultimo?.folha_bruta),
                detalhe: ultimo ? competenciaCurta(ultimo.competencia) : "",
              },
              {
                icone: CircleDollarSign,
                rotulo: "Encargos — último mês",
                valor: brl(num(ultimo?.fgts) + num(ultimo?.inss)),
                detalhe: `FGTS ${brl(ultimo?.fgts)} · INSS ${brl(ultimo?.inss)}`,
              },
              {
                icone: HeartPulse,
                rotulo: "Atestado no período",
                valor: brl(acumulado.atestado),
                detalhe: `${acumulado.atestadoDias.toFixed(0)} dias pagos pela empresa`,
              },
              {
                icone: Users,
                rotulo: "Quadro — último mês",
                valor: String(ultimo?.empregados ?? "—"),
                detalhe: `${ultimo?.admitidos ?? 0} admitido(s) · ${ultimo?.demitidos ?? 0} desligado(s)`,
              },
            ].map((c) => (
              <Card key={c.rotulo} className="rounded-2xl">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{c.rotulo}</p>
                    <c.icone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{c.valor}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.detalhe}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Folha bruta por mês</CardTitle>
              <CardDescription>
                Acumulado no período: <strong>{brl(acumulado.bruta)}</strong> · encargos{" "}
                {brl(acumulado.fgts + acumulado.inss)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: 150 }}>
                {linhas.map((l) => (
                  <div key={l.competencia} className="flex min-w-[40px] flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {Math.round(num(l.folha_bruta) / 1000)}k
                    </span>
                    <div
                      className="w-full rounded-t bg-primary/80"
                      style={{ height: `${Math.max(2, (num(l.folha_bruta) / max) * 100)}px` }}
                      title={brl(l.folha_bruta)}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {competenciaCurta(l.competencia)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-primary/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Gift className="h-4 w-4" /> Quanto vai custar o 13º de {anoAtual}
              </CardTitle>
              <CardDescription>
                A <strong>1ª parcela</strong> vence em 30/11 e é metade do valor, sem
                desconto. A <strong>2ª</strong> vence em 20/12 e sai menor, porque é dela
                que se desconta o INSS do funcionário.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">1ª parcela — até 30/11</p>
                  <p className="text-xl font-bold tabular-nums">{brl(decimo.data?.primeira_parcela)}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">2ª parcela — até 20/12</p>
                  <p className="text-xl font-bold tabular-nums">{brl(decimo.data?.segunda_parcela)}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">Total com FGTS</p>
                  <p className="text-xl font-bold tabular-nums">{brl(decimo.data?.custo_total)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Estimativa sobre {decimo.data?.funcionarios ?? 0} funcionário(s), proporcional
                ao tempo de casa de cada um.
                {decimo.data?.sem_salario
                  ? ` ${decimo.data.sem_salario} sem salário na folha mais recente ficaram de fora — o total está incompleto.`
                  : ""}{" "}
                Não inclui o INSS da empresa, que depende do regime tributário.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </PortalPage>
  );
};

export default CustoFolhaPage;
