import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { compararCenarios, type Demanda } from "@/lib/escala/contingente";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function reais(v: number | null) {
  return v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

/**
 * Quantas pessoas a empresa precisa em cada fase da emenda para cobrir a demanda por dia
 * da semana, comparado com o quadro de hoje. A conta está em src/lib/escala/contingente.ts.
 */
export function PainelContingente({
  demanda,
  horasPorDia,
  salarioMedio,
  quadroAtual,
  onChange,
}: {
  demanda: Demanda;
  horasPorDia: number;
  salarioMedio: number | null;
  quadroAtual: number;
  onChange: (p: { demanda?: Demanda; horasPorDia?: number; salarioMedio?: number | null }) => void;
}) {
  const cenarios = compararCenarios(demanda, horasPorDia, salarioMedio);
  const hoje = cenarios[0];
  const semDemanda = demanda.every((n) => n === 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Simulação de contingente</CardTitle>
        <p className="text-xs text-muted-foreground">
          Quantas pessoas precisam estar trabalhando em cada dia da semana. A simulação calcula o quadro mínimo em
          cada fase da emenda.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          {DIAS.map((d, i) => (
            <div key={d} className="w-14 space-y-1">
              <Label className="text-xs">{d}</Label>
              <Input
                type="number"
                min={0}
                value={demanda[i]}
                onChange={(e) => {
                  const nova = [...demanda] as Demanda;
                  nova[i] = Math.max(0, Math.floor(Number(e.target.value) || 0));
                  onChange({ demanda: nova });
                }}
                aria-label={`Pessoas necessárias ${d}`}
              />
            </div>
          ))}
          <div className="w-28 space-y-1">
            <Label className="text-xs">Horas por dia</Label>
            <Input
              type="number"
              min={1}
              max={12}
              step={0.5}
              value={horasPorDia}
              onChange={(e) => onChange({ horasPorDia: Math.min(12, Math.max(1, Number(e.target.value) || 8)) })}
            />
          </div>
          <div className="w-36 space-y-1">
            <Label className="text-xs">Salário médio (R$)</Label>
            <Input
              type="number"
              min={0}
              step={50}
              value={salarioMedio ?? ""}
              placeholder="opcional"
              onChange={(e) => onChange({ salarioMedio: Number(e.target.value) > 0 ? Number(e.target.value) : null })}
            />
          </div>
        </div>

        {semDemanda ? (
          <p className="text-sm text-muted-foreground">Preencha a demanda por dia para ver o quadro necessário.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3 font-normal">Cenário</th>
                  <th className="py-1 pr-3 font-normal">Dias por pessoa/semana</th>
                  <th className="py-1 pr-3 font-normal">Pessoas necessárias</th>
                  <th className="py-1 pr-3 font-normal">Diferença p/ hoje</th>
                  <th className="py-1 font-normal">Custo mensal (salário + FGTS)</th>
                </tr>
              </thead>
              <tbody>
                {cenarios.map((c) => {
                  const dif = c.pessoas - hoje.pessoas;
                  return (
                    <tr key={c.nome} className="border-t">
                      <td className="py-1.5 pr-3">{c.nome}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{c.diasPorPessoa.toFixed(1).replace(".", ",")}</td>
                      <td className="py-1.5 pr-3 font-semibold tabular-nums">{c.pessoas}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{c === hoje ? "—" : dif > 0 ? `+${dif}` : dif}</td>
                      <td className="py-1.5 tabular-nums">{reais(c.custoMensal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Quadro na escala deste mês: {quadroAtual} pessoa(s). É o mínimo para cobrir a demanda, sem contar férias,
              faltas e afastamentos.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
