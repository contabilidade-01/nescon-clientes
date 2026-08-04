import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useGclickPendencias } from "@/hooks/useGclickPendencias";

const CHAVE_SESSAO = "gclick_alerta_visto";

/**
 * Aviso ao entrar no painel: entrou cliente novo no G-Click, ou algum mudou de status.
 *
 * Abre UMA vez por sessão para não virar incômodo a cada troca de página. Fechar aqui
 * não resolve nada: a faixa na visão geral e o número no menu continuam até você
 * decidir — o registro de verdade está na fila de pendências, no banco.
 */
export function GclickAlertaDialog() {
  const navigate = useNavigate();
  const { data, pode } = useGclickPendencias();
  const [aberto, setAberto] = useState(false);

  const total = data?.total ?? 0;

  useEffect(() => {
    if (!pode || total === 0) return;
    if (sessionStorage.getItem(CHAVE_SESSAO)) return;
    sessionStorage.setItem(CHAVE_SESSAO, "1");
    setAberto(true);
  }, [pode, total]);

  if (!data || total === 0) return null;

  const novos = data.novos_count;
  const mudancas = data.mudancas_count;

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <UserPlus className="h-5 w-5 shrink-0 text-primary" />
            {novos > 0 ? "Cliente novo no G-Click" : "Mudança no G-Click"}
          </DialogTitle>
          <DialogDescription className="text-left">
            {novos > 0 && (
              <>
                <strong>
                  {novos} cliente{novos > 1 ? "s" : ""} novo{novos > 1 ? "s" : ""}
                </strong>{" "}
                {novos > 1 ? "aguardam" : "aguarda"} sua decisão: cadastrar no portal ou não.
              </>
            )}
            {novos > 0 && mudancas > 0 && " "}
            {mudancas > 0 && (
              <>
                <strong>
                  {mudancas} mudança{mudancas > 1 ? "s" : ""} de situação
                </strong>{" "}
                {mudancas > 1 ? "esperam" : "espera"} seu OK.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-56 space-y-1.5 overflow-y-auto text-sm">
          {[...data.novos, ...data.mudancas].slice(0, 8).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <span className="min-w-0 truncate">{p.dados?.nome || p.nome || p.cnpj}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {p.tipo === "novo_cliente"
                  ? "novo"
                  : `${p.dados?.de || "—"} → ${p.dados?.para || "—"}`}
              </span>
            </li>
          ))}
          {total > 8 && (
            <li className="px-3 py-1 text-xs text-muted-foreground">e mais {total - 8}...</li>
          )}
        </ul>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={() => setAberto(false)}>
            Ver depois
          </Button>
          <Button
            type="button"
            onClick={() => {
              setAberto(false);
              navigate("/admin/clientes-gclick");
            }}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Resolver agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
