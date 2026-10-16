import { useState } from "react";
import { ArrowRight, Building2, Check, HardHat, ShoppingBag, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SEGMENTOS, type Segmento } from "@/lib/escala/regras";

const ATIVIDADES: Array<{ id: Segmento; icone: LucideIcon; resumo: string }> = [
  { id: "comercio", icone: ShoppingBag, resumo: "Lojas e varejo. Domingo de folga ao menos a cada 3 semanas; feriado só com convenção." },
  { id: "restaurante", icone: UtensilsCrossed, resumo: "Bares, restaurantes e cozinhas. Abre fim de semana; domingo de folga a cada 7 semanas." },
  { id: "construcao_civil", icone: HardHat, resumo: "Obras e canteiros. Normalmente de segunda a sexta ou sábado." },
  { id: "outro", icone: Building2, resumo: "Escritórios, serviços e indústria. Regra geral da CLT." },
];

export type EscolhaAtividade = { segmento: Segmento; temAcordoColetivo: boolean; usa12x36: boolean };

/**
 * Primeiro passo: o cliente marca a atividade antes de simular. A atividade muda a régua
 * (domingos e feriados) e os cenários que a tela oferece.
 */
export function EscolherAtividade({
  inicial,
  onConfirmar,
  onCancelar,
  salvando,
}: {
  inicial: EscolhaAtividade;
  onConfirmar: (e: EscolhaAtividade) => void;
  onCancelar?: () => void;
  salvando?: boolean;
}) {
  const [e, setE] = useState(inicial);
  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 py-5">
        <p className="text-xs font-medium uppercase tracking-wide text-primary">Passo 1 de 3</p>
        <h2 className="mt-1 text-lg font-semibold">Qual é a atividade da empresa?</h2>
        <p className="text-sm text-muted-foreground">
          A atividade define a regra de domingos e de feriados. As simulações só oferecem escalas que cumprem essa regra.
        </p>
      </div>
      <CardContent className="space-y-5 p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Atividade">
          {ATIVIDADES.map(({ id, icone: Icone, resumo }) => {
            const ativo = e.segmento === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={ativo}
                onClick={() => setE({ ...e, segmento: id })}
                className={cn(
                  "relative flex flex-col gap-2 rounded-xl border p-4 text-left transition hover:border-primary/60 hover:shadow-sm",
                  ativo && "border-primary bg-primary/5 ring-2 ring-primary/30",
                )}
              >
                {ativo && <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />}
                <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg bg-muted", ativo && "bg-primary text-primary-foreground")}>
                  <Icone className="h-5 w-5" />
                </span>
                <span className="font-medium">{SEGMENTOS[id].nome}</span>
                <span className="text-xs text-muted-foreground">{resumo}</span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Switch checked={e.temAcordoColetivo} onCheckedChange={(v) => setE({ ...e, temAcordoColetivo: v })} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Tem acordo ou convenção coletiva de compensação</span>
              <span className="text-xs text-muted-foreground">
                Libera compensar horas e folgas dentro do mês, intervalo de 30min e a escala 4x3 de 10h.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Switch checked={e.usa12x36} onCheckedChange={(v) => setE({ ...e, usa12x36: v })} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Trabalha em plantão 12x36</span>
              <span className="text-xs text-muted-foreground">A escala do mês começa em 12x36, com as turmas A e B se revezando.</span>
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {onCancelar && (
            <Button variant="ghost" onClick={onCancelar}>
              Voltar sem mudar
            </Button>
          )}
          <Button size="lg" onClick={() => onConfirmar(e)} disabled={salvando}>
            Começar simulação <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
