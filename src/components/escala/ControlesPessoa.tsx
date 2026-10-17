import { cn } from "@/lib/utils";
import { MODELOS, configPadrao, proximaFolga, segundaFolga, ultimoDiaDa6x1, type ConfigPessoa, type ModeloChave } from "@/lib/escala/planejamento";
import { PARES_5X2 } from "@/lib/escala/porPessoa";

const NOMES_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const sel = "h-7 rounded border bg-background px-1";

function abrev(d: number) {
  return NOMES_DIA[d].slice(0, 3).toLowerCase();
}

/**
 * Modelo, horário e folgas de uma pessoa. Serve à grade (no painel do nome) e à simulação
 * por funcionário; a trava das regras fica com quem recebe o `onChange`.
 */
export function ControlesPessoa({
  c,
  repousos,
  viradaEm,
  onChange,
}: {
  c: ConfigPessoa;
  repousos: number;
  /** Dia em que entram as 2 folgas, quando cai neste mês: mostra a 6x1 até a véspera. */
  viradaEm?: string;
  onChange: (p: Partial<ConfigPessoa>) => void;
}) {
  const transicao = viradaEm && c.modelo !== "6x1" && c.modelo !== "12x36";
  const ultimo = viradaEm ? ultimoDiaDa6x1(viradaEm) : "";
  const ate6x1 = ultimo ? `${ultimo.slice(8, 10)}/${ultimo.slice(5, 7)}` : "";
  return (
  <div className="flex flex-wrap items-center gap-1">
      <select
        className={sel}
        value={c.modelo}
        onChange={(e) => {
          const modelo = e.target.value as ModeloChave;
          const p = configPadrao(c.id, c.nome, modelo);
          onChange({ modelo, entrada: p.entrada, saida: p.saida });
        }}
        aria-label="Modelo de escala"
      >
        {(Object.keys(MODELOS) as ModeloChave[]).map((m) => (
          <option key={m} value={m} disabled={m === "6x1" && repousos > 1 && c.modelo !== "6x1"}>
            {MODELOS[m]}
            {m === "6x1" && repousos > 1 ? " (proibida)" : ""}
          </option>
        ))}
      </select>
      <input type="time" className={sel} value={c.entrada} onChange={(e) => onChange({ entrada: e.target.value })} aria-label="Entrada" />
      <input type="time" className={sel} value={c.saida} onChange={(e) => onChange({ saida: e.target.value })} aria-label="Saída" />
      <input
        type="number"
        min={0}
        step={15}
        className={cn(sel, "w-14")}
        value={c.intervaloMin}
        onChange={(e) => onChange({ intervaloMin: Math.max(0, Number(e.target.value) || 0) })}
        aria-label="Intervalo em minutos"
        title="Intervalo (min)"
      />
      {c.modelo === "6x1" && (
        <select className={sel} value={c.folga6x1} onChange={(e) => onChange({ folga6x1: Number(e.target.value) })} aria-label="Dia da folga">
          {NOMES_DIA.map((n, i) => (
            <option key={n} value={i}>
              Folga {abrev(i)}
            </option>
          ))}
        </select>
      )}
      {c.modelo === "5x2" && (
        <select
          className={sel}
          value={c.folgas5x2.join(",")}
          onChange={(e) => onChange({ folgas5x2: e.target.value.split(",").map(Number) })}
          aria-label="Dias de folga"
        >
          {PARES_5X2.map((p) => (
            <option key={p.join(",")} value={p.join(",")}>
              Folga {abrev(p[0])}+{abrev(p[1])}
            </option>
          ))}
        </select>
      )}
      {c.modelo === "5x2_fechado" && (
        <>
          <select className={sel} value={c.diaFechado} onChange={(e) => onChange({ diaFechado: Number(e.target.value) })} aria-label="Dia em que a casa fecha">
            {NOMES_DIA.map((n, i) => (
              <option key={n} value={i}>
                Fecha {abrev(i)}
              </option>
            ))}
          </select>
          <select
            className={sel}
            value={segundaFolga(c.diaFechado, c.folgaFixa)}
            onChange={(e) => onChange({ folgaFixa: Number(e.target.value) })}
            aria-label="Segunda folga"
          >
            {[1, 2, 3, 4, 5, 6]
              .filter((d) => d !== c.diaFechado)
              .map((d) => (
                <option key={d} value={d}>
                  + folga {abrev(d)}
                </option>
              ))}
          </select>
          {c.diaFechado !== 0 && (
            <>
              <select
                className={sel}
                value={c.semanasRodizio}
                onChange={(e) => onChange({ semanasRodizio: Number(e.target.value), rodizio: 0 })}
                aria-label="Domingo de folga a cada"
              >
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "Dom. toda semana" : `Dom. a cada ${n} sem.`}
                  </option>
                ))}
              </select>
              {c.semanasRodizio > 1 && (
                <select className={sel} value={c.rodizio % c.semanasRodizio} onChange={(e) => onChange({ rodizio: Number(e.target.value) })} aria-label="Grupo do rodízio">
                  {Array.from({ length: c.semanasRodizio }, (_, i) => (
                    <option key={i} value={i}>
                      Grupo {i + 1}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </>
      )}
      {(c.modelo === "5x2_rev" || c.modelo === "4x3") && (
        <select className={sel} value={c.folgaFixa} onChange={(e) => onChange({ folgaFixa: Number(e.target.value) })} aria-label="Folga da semana">
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <option key={d} value={d}>
              {c.modelo === "4x3" ? `Folga dom+${abrev(d)}+${abrev(proximaFolga(d))}` : `Folga ${abrev(d)}`}
            </option>
          ))}
        </select>
      )}
      {c.modelo === "5x2_rev" && (
        <>
          <select
            className={sel}
            value={c.semanasRodizio}
            onChange={(e) => onChange({ semanasRodizio: Number(e.target.value), rodizio: 0 })}
            aria-label="Domingo de folga a cada"
          >
            <option value={2}>Dom. a cada 2 sem.</option>
            <option value={3}>Dom. a cada 3 sem.</option>
          </select>
          <select className={sel} value={c.rodizio % c.semanasRodizio} onChange={(e) => onChange({ rodizio: Number(e.target.value) })} aria-label="Grupo do rodízio">
            {Array.from({ length: c.semanasRodizio }, (_, i) => (
              <option key={i} value={i}>
                Grupo {i + 1}
              </option>
            ))}
          </select>
        </>
      )}
      {c.modelo === "12x36" && (
        <select className={sel} value={c.turma} onChange={(e) => onChange({ turma: e.target.value as "A" | "B" })} aria-label="Turma">
          <option value="A">Turma A</option>
          <option value="B">Turma B</option>
        </select>
      )}
      {transicao && (
        <div className="flex w-full flex-wrap items-center gap-1 border-t pt-1 text-xs">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={c.seisPorUmAteVirada} onChange={(e) => onChange({ seisPorUmAteVirada: e.target.checked })} />
            Até {ate6x1} segue na 6x1
          </label>
          {c.seisPorUmAteVirada && (
            <select className={sel} value={c.folga6x1} onChange={(e) => onChange({ folga6x1: Number(e.target.value) })} aria-label="Folga da 6x1 até a etapa">
              {NOMES_DIA.map((n, i) => (
                <option key={n} value={i}>
                  Folga {abrev(i)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
