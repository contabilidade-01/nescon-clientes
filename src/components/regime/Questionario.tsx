import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Factory, Info, Briefcase, ShoppingBag, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { REDUCOES, REFERENCIA_ESTIMADA } from "@/lib/regime/regras";
import { anexoDe, type Atividade, type DadosRegime } from "@/lib/regime/simular";
import { ANEXOS } from "@/lib/regime/simples";

const ATIVIDADES: Array<{ id: Atividade; nome: string; icone: LucideIcon; resumo: string }> = [
  { id: "comercio", nome: "Comércio", icone: ShoppingBag, resumo: "Revenda de mercadorias (Anexo I)." },
  { id: "industria", nome: "Indústria", icone: Factory, resumo: "Fabricação ou transformação (Anexo II)." },
  { id: "servico", nome: "Serviços", icone: Briefcase, resumo: "Prestação de serviços (Anexos III, IV ou V)." },
];

export const PASSOS = [
  { titulo: "Atividade", porque: "Define o anexo do Simples, a partilha do DAS e se há redução de IBS/CBS." },
  { titulo: "Quem compra", porque: "É o que mais pesa: empresa do regime regular toma crédito integral só se você estiver no híbrido." },
  { titulo: "Faturamento e folha", porque: "Faturamento define a faixa; folha define o fator R e o INSS fora do Simples." },
  { titulo: "Compras", porque: "No híbrido e no Presumido as compras geram crédito de IBS/CBS; no Simples puro, não." },
  { titulo: "Se sair do Simples", porque: "Para comparar com o Lucro Presumido e ajustar as alíquotas quando saírem as oficiais." },
] as const;

function Campo({
  id,
  rotulo,
  ajuda,
  valor,
  onChange,
  sufixo,
  passo = 1,
}: {
  id: string;
  rotulo: string;
  ajuda?: string;
  valor: number;
  onChange: (v: number) => void;
  sufixo?: string;
  passo?: number;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm">
        {rotulo}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          min={0}
          step={passo}
          value={Number.isFinite(valor) ? valor : 0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="max-w-[12rem]"
        />
        {sufixo && <span className="text-sm text-muted-foreground">{sufixo}</span>}
      </div>
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

/**
 * Questionário da atividade em cinco passos. Cada passo diz por que pede o que pede; o
 * cliente pode salvar pela metade e voltar depois.
 */
export function Questionario({
  dados,
  onChange,
  onConcluir,
  salvando,
}: {
  dados: DadosRegime;
  onChange: (d: DadosRegime) => void;
  onConcluir: () => void;
  salvando?: boolean;
}) {
  const [passo, setPasso] = useState(0);
  const d = dados;
  const set = (p: Partial<DadosRegime>) => onChange({ ...d, ...p });
  const setVenda = (k: keyof DadosRegime["vendas"], v: number) => set({ vendas: { ...d.vendas, [k]: v } });
  const somaVendas = Object.values(d.vendas).reduce((a, b) => a + b, 0);
  const { anexo, fatorR } = anexoDe(d);
  const ultimo = passo === PASSOS.length - 1;

  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Passos do questionário">
          {PASSOS.map((p, i) => (
            <button
              key={p.titulo}
              type="button"
              onClick={() => setPasso(i)}
              aria-current={i === passo ? "step" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition",
                i === passo ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/60",
              )}
            >
              {i + 1}. {p.titulo}
            </button>
          ))}
        </div>
        <Progress value={((passo + 1) / PASSOS.length) * 100} className="h-1.5" />
        <div>
          <CardTitle className="text-base">{PASSOS[passo].titulo}</CardTitle>
          <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {PASSOS[passo].porque}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {passo === 0 && (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              {ATIVIDADES.map((a) => {
                const Icone = a.icone;
                const ativo = d.atividade === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => set({ atividade: a.id })}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition",
                      ativo ? "border-primary bg-primary/5" : "hover:border-primary/60",
                    )}
                  >
                    <Icone className="mt-0.5 h-5 w-5 text-primary" />
                    <span>
                      <span className="block text-sm font-medium">{a.nome}</span>
                      <span className="block text-xs text-muted-foreground">{a.resumo}</span>
                    </span>
                    {ativo && <Check className="ml-auto h-4 w-4 text-primary" />}
                  </button>
                );
              })}
            </div>
            {d.atividade === "servico" && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Switch id="fatorR" checked={d.sujeitoFatorR} onCheckedChange={(v) => set({ sujeitoFatorR: v })} />
                  <Label htmlFor="fatorR" className="text-sm">
                    A atividade é sujeita ao fator R (Anexo V que vai ao III com folha de 28% ou mais)
                  </Label>
                </div>
                {!d.sujeitoFatorR && (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Anexo do serviço">
                    {(["III", "IV", "V"] as const).map((a) => (
                      <Button key={a} type="button" size="sm" variant={d.anexoServico === a ? "default" : "outline"} onClick={() => set({ anexoServico: a })}>
                        Anexo {a}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium">O que a empresa vende tem redução de IBS/CBS?</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {REDUCOES.map((r) => (
                  <button
                    key={r.valor}
                    type="button"
                    aria-pressed={d.reducao === r.valor}
                    onClick={() => set({ reducao: r.valor })}
                    className={cn(
                      "rounded-lg border p-2 text-left text-xs transition",
                      d.reducao === r.valor ? "border-primary bg-primary/5" : "hover:border-primary/60",
                    )}
                  >
                    <span className="block text-sm font-medium">{r.nome}</span>
                    <span className="text-muted-foreground">{r.exemplo}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {passo === 1 && (
          <>
            <p className="text-sm text-muted-foreground">Em média, de cada R$ 100 vendidos, quanto vai para cada tipo de cliente?</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="vRegular" rotulo="Empresas do Lucro Presumido ou Real" sufixo="%" valor={d.vendas.regular} onChange={(v) => setVenda("regular", v)}
                ajuda="Tomam crédito de IBS/CBS. Quanto maior, mais o híbrido tende a compensar." />
              <Campo id="vConsumidor" rotulo="Consumidor final (pessoa física)" sufixo="%" valor={d.vendas.consumidor} onChange={(v) => setVenda("consumidor", v)}
                ajuda="Não toma crédito: paga o preço cheio em qualquer regime." />
              <Campo id="vSimples" rotulo="Empresas do Simples e MEI" sufixo="%" valor={d.vendas.simples} onChange={(v) => setVenda("simples", v)}
                ajuda="No Simples puro não tomam crédito." />
              <Campo id="vGoverno" rotulo="Governo (órgãos públicos)" sufixo="%" valor={d.vendas.governo} onChange={(v) => setVenda("governo", v)} />
              <Campo id="vExportacao" rotulo="Exportação" sufixo="%" valor={d.vendas.exportacao} onChange={(v) => setVenda("exportacao", v)}
                ajuda="Não paga IBS/CBS; no híbrido, os créditos das compras aproveitam inteiros." />
            </div>
            <p className={cn("text-sm font-medium", Math.abs(somaVendas - 100) > 0.5 ? "text-destructive" : "text-emerald-600")}>
              Soma: {somaVendas.toFixed(0)}% {Math.abs(somaVendas - 100) > 0.5 ? "(precisa dar 100%)" : "✓"}
            </p>
            {d.atividade !== "servico" && (
              <Campo id="st" rotulo="Vendas com ICMS por substituição tributária" sufixo="% das vendas" valor={d.pctIcmsSt} onChange={(v) => set({ pctIcmsSt: Math.min(100, v) })}
                ajuda="Nesta parte o DAS não cobra a parcela de ICMS." />
            )}
          </>
        )}

        {passo === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="receita" rotulo="Faturamento médio por mês" sufixo="R$" passo={100} valor={d.receitaMensal} onChange={(v) => set({ receitaMensal: v })}
              ajuda="Média dos últimos 12 meses, pelo valor das notas. ×12 dá a RBT12." />
            <Campo id="folha" rotulo="Salários por mês (sem pró-labore)" sufixo="R$" passo={100} valor={d.folhaSalarios} onChange={(v) => set({ folhaSalarios: v })} />
            <Campo id="prolabore" rotulo="Pró-labore por mês" sufixo="R$" passo={100} valor={d.proLabore} onChange={(v) => set({ proLabore: v })} />
            <div className="rounded-lg border bg-muted/40 p-3 text-xs">
              <p className="font-medium">Enquadramento hoje</p>
              <p>{ANEXOS[anexo].nome}</p>
              {fatorR !== null && <p>Fator R: {(fatorR * 100).toFixed(1)}%</p>}
            </div>
          </div>
        )}

        {passo === 3 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="cRegular" rotulo="Compras de fornecedores do Lucro Presumido ou Real, por mês" sufixo="R$" passo={100} valor={d.comprasRegular} onChange={(v) => set({ comprasRegular: v })}
              ajuda="Mercadorias, insumos, aluguel de empresa, energia, telefone, serviços de empresas. Valor total da nota." />
            <Campo id="cSimples" rotulo="Compras de fornecedores do Simples, por mês" sufixo="R$" passo={100} valor={d.comprasSimples} onChange={(v) => set({ comprasSimples: v })}
              ajuda="Geram crédito pequeno (só o IBS/CBS que veio no DAS do fornecedor)." />
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Não entram: folha, pró-labore, aluguel pago a pessoa física, tarifas bancárias e compras de MEI — não dão crédito em nenhum regime.
            </p>
          </div>
        )}

        {passo === 4 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="icmsIss" rotulo={d.atividade === "servico" ? "ISS que pagaria fora do Simples" : "ICMS efetivo que pagaria fora do Simples"} sufixo="% da receita" passo={0.1}
              valor={d.icmsIssForaSimples} onChange={(v) => set({ icmsIssForaSimples: v })}
              ajuda={d.atividade === "servico" ? "Alíquota do ISS do município (2% a 5%)." : "ICMS das vendas menos o crédito das compras, em % do faturamento."} />
            <div />
            <Campo id="cbsRef" rotulo="Alíquota de referência da CBS" sufixo="%" passo={0.1} valor={d.cbsReferencia} onChange={(v) => set({ cbsReferencia: v })}
              ajuda={`Estimativa: ${REFERENCIA_ESTIMADA.cbs}%. A oficial de 2027 sai por resolução do Senado.`} />
            <Campo id="ibsRef" rotulo="Alíquota de referência do IBS (estado + município)" sufixo="%" passo={0.1} valor={d.ibsReferencia} onChange={(v) => set({ ibsReferencia: v })}
              ajuda={`Estimativa: ${REFERENCIA_ESTIMADA.ibs}%. Vale cheia em 2033.`} />
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-4">
          <Button type="button" variant="ghost" disabled={passo === 0} onClick={() => setPasso((p) => p - 1)}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
          </Button>
          {ultimo ? (
            <Button type="button" onClick={onConcluir} disabled={salvando}>
              Ver os cenários <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" onClick={() => setPasso((p) => p + 1)}>
              Próximo <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
