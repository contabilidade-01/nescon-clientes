import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { FeriadoLocal } from "@/lib/escala/feriados";

function rotulo(f: FeriadoLocal) {
  const [a, m, d] = f.data.length === 5 ? ["", ...f.data.split("-")] : f.data.split("-");
  return `${d}/${m}${a ? `/${a}` : ""}`;
}

/** Feriados municipais e estaduais que a empresa cadastra à mão. Os nacionais já vêm prontos. */
export function FeriadosLocais({ feriados, onChange }: { feriados: FeriadoLocal[]; onChange: (f: FeriadoLocal[]) => void }) {
  const [data, setData] = useState("");
  const [nome, setNome] = useState("");
  const [anual, setAnual] = useState(true);

  function adicionar() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return;
    const chave = anual ? data.slice(5) : data;
    if (feriados.some((f) => f.data === chave)) return;
    onChange([...feriados, { data: chave, nome: nome.trim() || "Feriado local" }].sort((a, b) => a.data.slice(-5).localeCompare(b.data.slice(-5))));
    setData("");
    setNome("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" className="w-40" value={data} onChange={(e) => setData(e.target.value)} aria-label="Data do feriado" />
        <Input className="w-48" placeholder="Nome (ex.: Aniversário da cidade)" value={nome} onChange={(e) => setNome(e.target.value)} />
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox checked={anual} onCheckedChange={(v) => setAnual(Boolean(v))} />
          Repete todo ano
        </label>
        <Button type="button" size="sm" variant="outline" onClick={adicionar} disabled={!data}>
          <Plus className="mr-1 h-4 w-4" /> Incluir
        </Button>
      </div>
      {feriados.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {feriados.map((f) => (
            <span key={f.data} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs">
              {rotulo(f)} · {f.nome}
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onChange(feriados.filter((x) => x.data !== f.data))}
                aria-label={`Remover ${f.nome}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
