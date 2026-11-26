import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Nome limpo para a vaga (até 80 letras) ou undefined. */
export function nomeDaVaga(v: string): string | undefined {
  const s = v.trim().replace(/\s+/g, " ").slice(0, 80);
  return s || undefined;
}

/**
 * Vaga simulada com o nome de uma pessoa de verdade (ex.: quem vai ser admitido ou ainda não
 * chegou da folha). Entra na escala como os demais; o cadastro de funcionário não muda.
 */
export function NovaVaga({
  sugestao,
  unidades,
  unidadeInicial,
  onFechar,
  onCriar,
}: {
  sugestao: string;
  unidades: string[];
  unidadeInicial?: string;
  onFechar: () => void;
  onCriar: (p: { nome: string; unidade?: string }) => void;
}) {
  const [nome, setNome] = useState("");
  const [unidade, setUnidade] = useState(unidadeInicial ?? unidades[0] ?? "");
  const criar = () => onCriar({ nome: nomeDaVaga(nome) ?? sugestao, unidade: unidade || undefined });
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova vaga simulada</DialogTitle>
          <DialogDescription>Escreva o nome da pessoa (ex.: quem vai ser admitido). Em branco, fica “{sugestao}”.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Nome</span>
            <Input
              autoFocus
              value={nome}
              maxLength={80}
              placeholder={sugestao}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              aria-label="Nome da vaga"
            />
          </label>
          {unidades.length > 0 && (
            <label className="block space-y-1">
              <span className="text-xs font-medium">Unidade</span>
              <select className="h-9 w-full rounded border bg-background px-2" value={unidade} onChange={(e) => setUnidade(e.target.value)} aria-label="Unidade da vaga">
                {unidades.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
                <option value="">Sem unidade</option>
              </select>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={criar}>Criar vaga</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
