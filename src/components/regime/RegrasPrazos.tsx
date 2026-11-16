import { CheckCircle2, CircleDashed } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ANOS_SIMULADOS, FONTES, PRAZOS, REGRAS_ATUALIZADAS_EM, regrasDoAno } from "@/lib/regime/regras";
import type { DadosRegime } from "@/lib/regime/simular";

const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const pct = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;

/** As regras que o cálculo usa, ano a ano, com a norma de cada uma. */
export function RegrasPrazos({ dados }: { dados: DadosRegime }) {
  const ref = { cbs: dados.cbsReferencia, ibs: dados.ibsReferencia };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Regras revistas até {dataBr(REGRAS_ATUALIZADAS_EM)}. Itens marcados como “a conferir” vieram de estimativa ou de fonte
        secundária e serão trocados pelo número oficial assim que publicado.
      </p>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Transição ano a ano</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ano</TableHead>
                <TableHead>CBS</TableHead>
                <TableHead>IBS</TableHead>
                <TableHead>ICMS/ISS que resta (fora do Simples)</TableHead>
                <TableHead>ICMS/ISS do DAS que virou IBS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ANOS_SIMULADOS.map((a) => {
                const r = regrasDoAno(a, ref);
                return (
                  <TableRow key={a}>
                    <TableCell className="font-medium">{a}</TableCell>
                    <TableCell>{pct(r.cbs)}</TableCell>
                    <TableCell>{pct(r.ibs)}</TableCell>
                    <TableCell>{(r.icmsIssRestante * 100).toFixed(0)}%</TableCell>
                    <TableCell>{(r.ibsNoDas * 100).toFixed(0)}%</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Prazos de opção</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {PRAZOS.map((p) => (
            <div key={p.fim} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
              <span>
                <strong>{dataBr(p.inicio)} a {dataBr(p.fim)}</strong> — {p.oQue}
              </span>
              <span className="text-xs text-muted-foreground">
                {p.fonte.norma} {p.fonte.conferido ? "" : "(a conferir)"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">De onde vem cada regra</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Regra</TableHead>
                <TableHead>Norma</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FONTES.map((f) => (
                <TableRow key={f.regra}>
                  <TableCell>{f.regra}</TableCell>
                  <TableCell className="text-xs">
                    {f.norma} — {f.trecho}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {f.conferido ? (
                      <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Conferido</span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-600"><CircleDashed className="h-3.5 w-3.5" /> A conferir</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
