/**
 * Cabeçalho de edição de um aditivo: data de efeito, motivo, reajuste rápido e a lista
 * do que está mudando (de → para), com "reverter" por campo.
 */
import { useState } from "react";
import { Percent, Undo2 } from "lucide-react";
import { Campo } from "@/components/contratos/FormularioContrato";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { alteracoesEntre, definirCampo, fmtValor, reajustar } from "@/lib/contratoCampos";
import { dataExtenso, type ContratoDados } from "@/lib/contratoModelo";
import { num } from "@/lib/inputNum";

export type AditivoMeta = {
  numero: number;
  paiId: string;
  paiTitulo: string;
  paiAssinadoEm: string;
  base: ContratoDados;
  efeito: string;
  motivo: string;
};

export function PainelAditivo({
  meta,
  dados,
  onMeta,
  onDados,
  ro,
}: {
  meta: AditivoMeta;
  dados: ContratoDados;
  onMeta: (patch: Partial<AditivoMeta>) => void;
  onDados: (fn: (d: ContratoDados) => ContratoDados) => void;
  ro?: boolean;
}) {
  const [pct, setPct] = useState(0);
  const [extras, setExtras] = useState(false);
  const alts = alteracoesEntre(meta.base, dados);

  return (
    <Card className="border-sky-300">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Aditivo nº {meta.numero}</CardTitle>
        <CardDescription>
          Altera o contrato “{meta.paiTitulo}”
          {meta.paiAssinadoEm ? `, assinado em ${dataExtenso(meta.paiAssinadoEm.slice(0, 10))}` : ""}. As cláusulas de alteração saem sozinhas do que você mudar abaixo; o resto do contrato é ratificado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Vale a partir de">
            <Input type="date" value={meta.efeito} onChange={(e) => onMeta({ efeito: e.target.value })} disabled={ro} />
          </Campo>
          <Campo label="Motivo (opcional)">
            <Input placeholder="ex.: reajuste anual de 2027" value={meta.motivo} onChange={(e) => onMeta({ motivo: e.target.value })} disabled={ro} />
          </Campo>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Campo label="Reajuste da mensalidade (%)">
            <Input className="w-28" type="number" step="0.01" value={pct} onChange={(e) => setPct(num(e.target.value))} disabled={ro} />
          </Campo>
          <label className="flex items-center gap-2 text-sm pb-2">
            <Checkbox checked={extras} onCheckedChange={(v) => setExtras(Boolean(v))} disabled={ro} /> também no valor por empregado extra
          </label>
          <Button size="sm" variant="outline" disabled={ro || !pct} onClick={() => onDados((d) => reajustar(d, pct, { extras }))}>
            <Percent className="h-4 w-4 mr-1" /> Aplicar
          </Button>
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">{alts.length ? `${alts.length} alteração(ões)` : "Nenhuma alteração ainda"}</p>
          {alts.map((a) => (
            <div key={a.def.chave} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary" className="font-normal">
                {a.def.rotulo}: {fmtValor(a.def, a.de)} → <b className="ml-1">{fmtValor(a.def, a.para)}</b>
              </Badge>
              {!ro ? (
                <button type="button" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground" onClick={() => onDados((d) => definirCampo(d, a.def.chave, a.de))}>
                  <Undo2 className="h-3 w-3" /> reverter
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Só valores, prazos e regras entram como alteração. Foro, data de início e modelo do contrato não mudam por aditivo.</p>
      </CardContent>
    </Card>
  );
}
