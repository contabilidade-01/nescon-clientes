import { useMemo, useState } from "react";
import { Plus, Shuffle, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ResultadoCenario } from "@/lib/escala/cenarios";
import { distribuir, type GrupoDistribuicao, type ResultadoDistribuicao } from "@/lib/escala/distribuir";
import { MODELOS, type ConfigEmpresa, type ModeloChave } from "@/lib/escala/planejamento";
import { resumoFolgas } from "@/lib/escala/porPessoa";
import { vigenciaEm } from "@/lib/escala/regras";

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const campo = "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring";

let proximoId = 1;
const novoGrupo = (modelo: ModeloChave, quantidade: number | null = null): GrupoDistribuicao => ({
  id: `g${proximoId++}`,
  modelo,
  quantidade,
  folgaFixa: null,
});

/**
 * Distribuição automática: o cliente monta os grupos (quantas pessoas em cada regra, folga
 * fixa ou variável, horário) e o sistema sorteia uma distribuição coesa que passa no motor.
 * "Outra distribuição" sorteia de novo; "Aplicar na grade" leva para a escala do mês.
 */
export function PainelDistribuicao({
  pessoas,
  mes,
  empresa,
  feriados,
  modeloPadrao,
  onAplicar,
}: {
  pessoas: Array<{ id: string; nome: string }>;
  mes: string;
  empresa: ConfigEmpresa;
  feriados: Set<string>;
  modeloPadrao: ModeloChave;
  onAplicar: (c: ResultadoCenario) => void;
}) {
  const [grupos, setGrupos] = useState<GrupoDistribuicao[]>(() => [novoGrupo(modeloPadrao)]);
  const [resultado, setResultado] = useState<ResultadoDistribuicao | null>(null);
  const [rodando, setRodando] = useState(false);
  const permite6x1 = vigenciaEm(`${mes}-01`).repousosSemanais < 2;

  const somaFixas = grupos.reduce((a, g) => a + (g.quantidade ?? 0), 0);
  const temResto = grupos.some((g) => g.quantidade === null);
  const aviso =
    somaFixas > pessoas.length
      ? `Os grupos pedem ${somaFixas} pessoas e a equipe tem ${pessoas.length}.`
      : !temResto && somaFixas < pessoas.length
        ? `${pessoas.length - somaFixas} pessoa(s) sem grupo vão para o último grupo.`
        : null;

  const mudar = (id: string, patch: Partial<GrupoDistribuicao>) => {
    setGrupos((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    setResultado(null);
  };

  const gerar = (semente = Math.floor(Math.random() * 1_000_000)) => {
    setRodando(true);
    // Deixa a tela mostrar "Distribuindo…" antes da conta (40 tentativas pelo motor).
    setTimeout(() => {
      setResultado(distribuir(pessoas, grupos, mes, empresa, feriados, semente));
      setRodando(false);
    }, 10);
  };

  const nomes = useMemo(() => new Map(pessoas.map((p) => [p.id, p.nome])), [pessoas]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <p className="text-sm font-medium">Distribuição automática</p>
            <p className="text-xs text-muted-foreground">
              Diga quantas pessoas ficam em cada regra. O sistema sorteia as folgas, espalhando para não juntar todo mundo no mesmo
              dia, e só aceita a distribuição que passa em todas as regras do mês.
            </p>
          </div>

          <div className="space-y-2">
            {grupos.map((g, i) => (
              <div key={g.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
                <span className="w-14 font-medium text-muted-foreground">Grupo {i + 1}</span>
                <input
                  className={`${campo} w-16`}
                  inputMode="numeric"
                  placeholder="resto"
                  value={g.quantidade ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    mudar(g.id, { quantidade: v ? Number(v) : null });
                  }}
                  aria-label="Quantas pessoas"
                  title="Quantas pessoas (vazio = todas as que sobrarem)"
                />
                <span>pessoas em</span>
                <select className={campo} value={g.modelo} onChange={(e) => mudar(g.id, { modelo: e.target.value as ModeloChave })} aria-label="Modelo">
                  {(Object.keys(MODELOS) as ModeloChave[])
                    .filter((m) => m !== "6x1" || permite6x1 || g.modelo === "6x1")
                    .map((m) => (
                      <option key={m} value={m}>
                        {MODELOS[m]}
                      </option>
                    ))}
                </select>
                {g.modelo !== "12x36" && (
                  <>
                    <span>{g.modelo === "5x2_fechado" ? "casa fecha" : "folga"}</span>
                    <select
                      className={campo}
                      value={g.folgaFixa ?? ""}
                      onChange={(e) => mudar(g.id, { folgaFixa: e.target.value === "" ? null : Number(e.target.value) })}
                      aria-label="Folga"
                    >
                      <option value="">variável</option>
                      {DIAS.map((d, k) => (
                        <option key={d} value={k}>
                          fixa: {d.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <input
                  type="time"
                  className={campo}
                  value={g.entrada ?? ""}
                  onChange={(e) => mudar(g.id, { entrada: e.target.value || undefined })}
                  aria-label="Entrada"
                  title="Entrada (vazio = padrão do modelo)"
                />
                <input
                  type="time"
                  className={campo}
                  value={g.saida ?? ""}
                  onChange={(e) => mudar(g.id, { saida: e.target.value || undefined })}
                  aria-label="Saída"
                  title="Saída (vazio = padrão do modelo)"
                />
                {grupos.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto h-7 w-7"
                    onClick={() => {
                      setGrupos((gs) => gs.filter((x) => x.id !== g.id));
                      setResultado(null);
                    }}
                    aria-label="Tirar grupo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {aviso && <p className="text-xs text-amber-600 dark:text-amber-400">{aviso}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setGrupos((gs) => [...gs, novoGrupo("5x2", 1)])}>
              <Plus className="mr-1 h-4 w-4" /> Grupo
            </Button>
            <Button size="sm" onClick={() => gerar()} disabled={rodando || !pessoas.length}>
              <Wand2 className="mr-1 h-4 w-4" /> {rodando ? "Distribuindo…" : "Distribuir"}
            </Button>
            {resultado && (
              <Button size="sm" variant="outline" onClick={() => gerar()} disabled={rodando}>
                <Shuffle className="mr-1 h-4 w-4" /> Outra distribuição
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {resultado && (
        <Card className={resultado.valida ? "border-primary/40" : "border-destructive/40"}>
          <CardContent className="space-y-3 p-4">
            {resultado.valida ? (
              <p className="text-sm">
                Distribuição dentro da regra ({resultado.validas} de {resultado.tentativas} sorteios serviram; esta é a que melhor cobre os
                dias).
              </p>
            ) : (
              <div className="text-sm text-destructive">
                Nenhum sorteio passou nas regras do mês. Principais motivos:
                <ul className="ml-4 list-disc text-xs">
                  {resultado.cenario.motivos.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
              {DIAS.map((d, k) => {
                const m = resultado.cenario.mediaPorDia[k] ?? 0;
                const dem = empresa.demanda[k] || 0;
                const falta = dem > 0 && m < dem;
                return (
                  <div key={d} className={`rounded border p-1 ${falta ? "border-destructive/40 bg-destructive/10" : "bg-muted/40"}`}>
                    <div className="text-muted-foreground">{d.slice(0, 3)}</div>
                    <div className="text-sm font-semibold tabular-nums">{m.toFixed(1).replace(".", ",")}</div>
                    {dem > 0 && <div className="text-muted-foreground">pede {dem}</div>}
                  </div>
                );
              })}
            </div>
            <div className="max-h-56 overflow-y-auto rounded border text-xs">
              {resultado.cenario.configs.map((c) => (
                <div key={c.id} className="flex justify-between gap-2 border-b px-2 py-1 last:border-0">
                  <span className="truncate">{nomes.get(c.id) ?? c.nome}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {MODELOS[c.modelo]} · {resumoFolgas(c)} · {c.entrada}–{c.saida}
                  </span>
                </div>
              ))}
            </div>
            <Button size="sm" disabled={!resultado.valida} onClick={() => onAplicar(resultado.cenario)}>
              Aplicar na grade
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
