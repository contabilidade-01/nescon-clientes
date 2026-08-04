import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";

/**
 * Aviso de LGPD no primeiro acesso do cliente.
 *
 * Aparece UMA vez e NÃO bloqueia o portal: fechar sem aceitar marca "visto" no servidor
 * e o aviso não volta. O texto vem da API (fonte única, ver api/src/lgpd.js), então o
 * que o cliente lê é o mesmo que fica registrado na auditoria do admin.
 */
export function LgpdConsentDialog({
  aberto,
  onResolvido,
}: {
  aberto: boolean;
  /** Chamado depois de aceitar ou de fechar — o portal para de perguntar. */
  onResolvido: () => void;
}) {
  const [open, setOpen] = useState(aberto);
  const [marcado, setMarcado] = useState(false);

  useEffect(() => {
    setOpen(aberto);
    if (aberto) setMarcado(false);
  }, [aberto]);

  const { data: termo } = useQuery({
    queryKey: ["lgpd-termo"],
    queryFn: () => api.lgpd.termo(),
    enabled: aberto,
  });

  const concordar = useMutation({
    mutationFn: () => api.lgpd.concordar(),
    onSettled: () => {
      // Falha de rede não pode prender o cliente na tela: fechamos de qualquer forma
      // e a marca continua nula, então o aviso volta no próximo acesso.
      setOpen(false);
      onResolvido();
    },
  });

  const fechar = () => {
    setOpen(false);
    api.lgpd.marcarVisto().catch(() => undefined);
    onResolvido();
  };

  if (!termo) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : fechar())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
            {termo.titulo}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Consentimento para tratamento de dados conforme a LGPD
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          {termo.paragrafos.map((p) => (
            <p key={p.slice(0, 40)}>{p}</p>
          ))}
        </div>

        <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
          <Checkbox
            checked={marcado}
            onCheckedChange={(v) => setMarcado(v === true)}
            className="mt-0.5"
          />
          <span>{termo.checkbox}</span>
        </label>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={fechar}>
            Agora não
          </Button>
          <Button
            type="button"
            onClick={() => concordar.mutate()}
            disabled={!marcado || concordar.isPending}
          >
            Concordar e continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
