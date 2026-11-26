import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ComoExcluir = "inativar" | "excluir";

/**
 * Tirar alguém da equipe pela escala. Vaga simulada só some. Funcionário de verdade:
 * "saiu da empresa" inativa (o histórico de advertências e atestados fica guardado) e
 * "cadastro errado" apaga o cadastro de vez.
 */
export function ExcluirFuncionario({
  nome,
  vaga,
  onFechar,
  onConfirmar,
}: {
  nome: string;
  vaga: boolean;
  onFechar: () => void;
  onConfirmar: (como: ComoExcluir) => Promise<void> | void;
}) {
  const [como, setComo] = useState<ComoExcluir>("inativar");
  const [indo, setIndo] = useState(false);
  async function confirmar() {
    setIndo(true);
    try {
      await onConfirmar(vaga ? "excluir" : como);
    } finally {
      setIndo(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !indo && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir {nome}</DialogTitle>
          <DialogDescription>
            {vaga
              ? "A vaga simulada sai desta escala depois que você salvar."
              : "A pessoa sai da equipe e da escala. Para só tirar da escala e manter na equipe, use “Fora da escala”."}
          </DialogDescription>
        </DialogHeader>
        {!vaga && (
          <div className="space-y-2 text-sm" role="radiogroup" aria-label="Como excluir">
            <label className="flex cursor-pointer items-start gap-2 rounded border p-2">
              <input type="radio" name="como" className="mt-1" checked={como === "inativar"} onChange={() => setComo("inativar")} />
              <span>
                <span className="font-medium">Saiu da empresa</span>
                <span className="block text-xs text-muted-foreground">Fica nos Inativos, com o histórico guardado. Dá para reativar.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded border p-2">
              <input type="radio" name="como" className="mt-1" checked={como === "excluir"} onChange={() => setComo("excluir")} />
              <span>
                <span className="font-medium">Cadastro errado ou repetido</span>
                <span className="block text-xs text-muted-foreground">Apaga o cadastro de vez. Não dá para desfazer.</span>
              </span>
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={indo}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirmar} disabled={indo}>
            {vaga ? "Excluir vaga" : como === "inativar" ? "Inativar" : "Excluir de vez"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
