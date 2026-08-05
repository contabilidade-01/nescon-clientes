import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CompanyPicker } from "@/components/admin/CompanyPicker";
import { api, type LicenseType } from "@/lib/api";
import { LICENSE_TYPES, LICENSE_TYPE_LABELS } from "@/lib/licenses";

export type LicenseDialogValue = {
  /** Preenchido = edição; vazio = cadastro novo. */
  licenseId?: string | null;
  companyId?: string;
  tipo?: LicenseType;
  numero?: string | null;
  orgao?: string | null;
  emitida_em?: string | null;
  vence_em?: string | null;
  observacao?: string | null;
};

/**
 * Cadastro/edição manual de uma licença. Só a data de vencimento é obrigatória —
 * é dela que sai todo o painel. Renovar = cadastrar outra licença do mesmo tipo:
 * a de vencimento mais distante passa a ser a vigente e o histórico fica guardado.
 */
export function LicenseDialog({
  open,
  onOpenChange,
  value,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: LicenseDialogValue;
}) {
  const queryClient = useQueryClient();
  const editando = Boolean(value.licenseId);

  const [companyId, setCompanyId] = useState("");
  const [tipo, setTipo] = useState<LicenseType>("funcionamento");
  const [numero, setNumero] = useState("");
  const [orgao, setOrgao] = useState("");
  const [emitidaEm, setEmitidaEm] = useState("");
  const [venceEm, setVenceEm] = useState("");
  const [observacao, setObservacao] = useState("");

  // Reabrir o diálogo sempre parte dos dados da linha escolhida.
  useEffect(() => {
    if (!open) return;
    setCompanyId(value.companyId ?? "");
    setTipo(value.tipo ?? "funcionamento");
    setNumero(value.numero ?? "");
    setOrgao(value.orgao ?? "");
    setEmitidaEm(value.emitida_em ? String(value.emitida_em).slice(0, 10) : "");
    setVenceEm(value.vence_em ? String(value.vence_em).slice(0, 10) : "");
    setObservacao(value.observacao ?? "");
  }, [open, value]);

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["licencas-overview"] });
    queryClient.invalidateQueries({ queryKey: ["licencas-itens"] });
    queryClient.invalidateQueries({ queryKey: ["licencas-empresas"] });
  };

  const salvar = useMutation({
    mutationFn: () => {
      const campos = {
        numero: numero.trim() || null,
        orgao: orgao.trim() || null,
        emitida_em: emitidaEm || null,
        vence_em: venceEm,
        observacao: observacao.trim() || null,
      };
      if (value.licenseId) return api.licencas.atualizar(value.licenseId, campos);
      return api.licencas.criar({ company_id: companyId, tipo, ...campos });
    },
    onSuccess: () => {
      invalidar();
      toast.success(editando ? "Licença atualizada" : "Licença cadastrada");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const apagar = useMutation({
    mutationFn: () => api.licencas.apagar(value.licenseId as string),
    onSuccess: () => {
      invalidar();
      toast.success("Licença removida");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const podeSalvar = Boolean(venceEm) && (editando || Boolean(companyId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar licença" : "Nova licença"}</DialogTitle>
          <DialogDescription>
            A situação (ativa, a vencer, vencida) é calculada a partir do vencimento — não precisa
            marcar nada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Empresa</Label>
            {editando ? (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                Empresa não muda na edição.
              </p>
            ) : (
              <CompanyPicker
                value={companyId}
                onChange={setCompanyId}
                allowAll={false}
                placeholder="Selecione a empresa"
              />
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Tipo de licença</Label>
            <Select
              value={tipo}
              onValueChange={(v) => setTipo(v as LicenseType)}
              disabled={editando}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LICENSE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {LICENSE_TYPE_LABELS[t].title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {editando && (
              <p className="text-[11px] text-muted-foreground">
                Empresa e tipo não mudam na edição — se errou, remova e cadastre de novo.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Número / protocolo (opcional)</Label>
              <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ex.: 2026/00123" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Órgão emissor (opcional)</Label>
              <Input value={orgao} onChange={(e) => setOrgao(e.target.value)} placeholder="Ex.: Prefeitura, CBMSP" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data de emissão (opcional)</Label>
              <Input type="date" value={emitidaEm} onChange={(e) => setEmitidaEm(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Data de vencimento <span className="text-destructive">*</span>
              </Label>
              <Input type="date" value={venceEm} onChange={(e) => setVenceEm(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              placeholder="Ex.: renovação protocolada, aguardando vistoria"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {editando ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" size="sm" disabled={apagar.isPending}>
                  Remover
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remover esta licença?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O histórico dela some. Se a licença foi renovada, o certo é{" "}
                    <strong>cadastrar a nova</strong> em vez de apagar esta — a de vencimento mais
                    distante passa a valer sozinha.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => apagar.mutate()}>Remover</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <span />
          )}
          <Button type="button" onClick={() => salvar.mutate()} disabled={!podeSalvar || salvar.isPending}>
            {editando ? "Guardar" : "Cadastrar licença"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
