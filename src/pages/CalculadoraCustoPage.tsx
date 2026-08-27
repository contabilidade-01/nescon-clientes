import { useEffect, useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Calculadora de Custo de Contratação — PÚBLICA (sem login).
 *
 * Porte fiel do calculadora-custo-funcionario.html (fórmula já validada):
 *  - Simples Nacional: só FGTS 8% (INSS patronal está no DAS).
 *  - Presumido/Real: FGTS 8% + INSS 20% + RAT 2% + Terceiros 5,8% = 35,8%.
 *  - Provisões mensais: 13º (1/12), férias + 1/3 (1/12) e os encargos sobre elas.
 */

type Regime = "simples" | "presumido";

const TAXAS: Record<Regime, { fgts: number; patronal: number; rot: string; hint: string; nota: string }> = {
  simples: {
    fgts: 0.08,
    patronal: 0,
    rot: "FGTS (8%)",
    hint: "No Simples, o INSS patronal já está no DAS — só incide FGTS 8%.",
    nota: "Regime Simples Nacional: o INSS patronal está incluído no DAS, por isso o único encargo direto sobre a folha é o FGTS de 8%.",
  },
  presumido: {
    fgts: 0.08,
    patronal: 0.278,
    rot: "Encargos patronais (35,8%)",
    hint: "Inclui INSS patronal 20% + RAT 2% + Terceiros 5,8% + FGTS 8%.",
    nota: "Regime Lucro Presumido/Real: incidem FGTS 8% + INSS patronal 20% + RAT 2% + Terceiros 5,8% = 35,8% sobre a folha (o RAT pode variar de 1% a 3% conforme a atividade).",
  },
};

const brl = (n: number) =>
  "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const CalculadoraCustoPage = () => {
  const [salario, setSalario] = useState("2500");
  const [regime, setRegime] = useState<Regime>("simples");
  const [honorario, setHonorario] = useState("50");
  const [vt, setVt] = useState("0");
  const [vr, setVr] = useState("0");
  const [incluiProv, setIncluiProv] = useState(true);

  useEffect(() => {
    document.title = "Calculadora de Custo de Contratação — Nescon Contabilidade";
  }, []);

  const r = useMemo(() => {
    const sal = num(salario);
    const hon = num(honorario);
    const valeT = num(vt);
    const valeR = num(vr);
    const t = TAXAS[regime];
    const taxaFolha = t.fgts + t.patronal;

    const encSal = sal * taxaFolha;
    const direto = sal + encSal + valeT + valeR + hon;

    const d13 = sal / 12;
    const dFer = (sal * (4 / 3)) / 12; // férias + 1/3
    const encProv = (d13 + dFer) * taxaFolha;
    const prov = incluiProv ? d13 + dFer + encProv : 0;

    const total = direto + prov;
    const ano = total * 12;
    const pct = sal > 0 ? Math.round((total / sal) * 100) : 0;

    return { sal, hon, valeT, valeR, t, encSal, direto, d13, dFer, encProv, prov, total, ano, pct };
  }, [salario, regime, honorario, vt, vr, incluiProv]);

  const Linha = ({ label, valor, small = false }: { label: string; valor: string; small?: boolean }) => (
    <div
      className={`flex items-baseline justify-between border-b border-dashed border-border/60 py-2 ${
        small ? "text-xs text-muted-foreground" : "text-sm"
      }`}
    >
      <span>{label}</span>
      <span className={`font-semibold whitespace-nowrap ${small ? "text-muted-foreground" : "text-primary"}`}>
        {valor}
      </span>
    </div>
  );

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <Card className="mx-auto w-full max-w-3xl overflow-hidden">
        {/* Cabeçalho */}
        <div className="bg-gradient-to-r from-primary/90 to-primary/60 px-6 py-6 text-primary-foreground">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
              <Calculator className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide opacity-85">Nescon Contabilidade</p>
              <h1 className="text-xl font-bold leading-tight">Calculadora de Custo de Contratação</h1>
              <p className="text-sm opacity-90">Descubra o custo mensal real de admitir um funcionário</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Formulário */}
          <div className="space-y-4 border-b border-border p-6 md:border-b-0 md:border-r">
            <div className="space-y-1.5">
              <Label htmlFor="salario">Salário bruto mensal (R$)</Label>
              <Input id="salario" type="number" min="0" step="50" value={salario} onChange={(e) => setSalario(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Regime tributário</Label>
              <div className="flex gap-2">
                {(["simples", "presumido"] as Regime[]).map((v) => (
                  <Button
                    key={v}
                    type="button"
                    variant={regime === v ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setRegime(v)}
                  >
                    {v === "simples" ? "Simples Nacional" : "Presumido / Real"}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{r.t.hint}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="honorario">
                Honorário contábil adicional (R$){" "}
                <span className="font-normal text-muted-foreground">por funcionário a mais</span>
              </Label>
              <Input id="honorario" type="number" min="0" step="10" value={honorario} onChange={(e) => setHonorario(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vt">
                Vale-transporte / mês (R$){" "}
                <span className="font-normal text-muted-foreground">custo do empregador, opcional</span>
              </Label>
              <Input id="vt" type="number" min="0" step="10" value={vt} onChange={(e) => setVt(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vr">
                Vale-refeição / alimentação / mês (R$){" "}
                <span className="font-normal text-muted-foreground">opcional</span>
              </Label>
              <Input id="vr" type="number" min="0" step="10" value={vr} onChange={(e) => setVr(e.target.value)} />
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
              <Checkbox checked={incluiProv} onCheckedChange={(c) => setIncluiProv(c === true)} />
              <span className="text-sm font-medium">Incluir provisões de 13º e férias (custo real)</span>
            </label>
          </div>

          {/* Resultado */}
          <div className="bg-muted/30 p-6">
            <Linha label="Salário bruto" valor={brl(r.sal)} />
            <Linha label={r.t.rot} valor={brl(r.encSal)} />
            {r.valeT > 0 && <Linha label="Vale-transporte" valor={brl(r.valeT)} />}
            {r.valeR > 0 && <Linha label="Vale-refeição" valor={brl(r.valeR)} />}
            <Linha label="Honorário contábil" valor={brl(r.hon)} />
            <div className="flex items-baseline justify-between border-b-2 border-primary py-2 text-sm font-bold">
              <span>Custo mensal direto</span>
              <span className="whitespace-nowrap text-primary">{brl(r.direto)}</span>
            </div>

            {incluiProv && (
              <div className="mt-2">
                <Linha label="13º salário (1/12)" valor={brl(r.d13)} small />
                <Linha label="Férias + 1/3 (1/12)" valor={brl(r.dFer)} small />
                <Linha
                  label={regime === "simples" ? "FGTS sobre 13º e férias" : "Encargos sobre 13º e férias"}
                  valor={brl(r.encProv)}
                  small
                />
                <div className="flex items-baseline justify-between border-b-2 border-primary py-2 text-sm font-bold">
                  <span>Provisões mensais</span>
                  <span className="whitespace-nowrap text-primary">{brl(r.prov)}</span>
                </div>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                Custo mensal total
              </p>
              <p className="mt-0.5 text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">{brl(r.total)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Projeção anual: {brl(r.ano)} • equivale a {r.pct}% do salário
              </p>
            </div>
          </div>
        </div>

        <CardContent className="border-t border-border bg-muted/20 py-4 text-[11px] leading-relaxed text-muted-foreground">
          <b className="text-foreground">Observação.</b> {r.t.nota} Não inclui outros benefícios de convenção
          coletiva, adicionais, horas extras ou rescisão. Valores estimados para fins gerenciais.
        </CardContent>
        <div className="py-3 text-center text-[11px] text-muted-foreground">
          Nescon Contabilidade • CNPJ 35.736.034/0001-23
        </div>
      </Card>
    </div>
  );
};

export default CalculadoraCustoPage;
