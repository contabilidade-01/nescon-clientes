import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { CertificadoForm } from "@/components/hub/CertificadoForm";
import { Indicador } from "@/components/hub/Hub";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { api, type CertificadoDados, type CertificadoItem, type CertificadoStatus } from "@/lib/api";
import { canSeeArea } from "@/lib/adminAreas";
import {
  CERT_STATUSES,
  CERT_STATUS_LABELS,
  CERT_TIPO_LABELS,
  CERT_TITULAR_LABELS,
  dataBr,
  prazoTexto,
} from "@/lib/certificadoDigital";
import { cn } from "@/lib/utils";

const PILL: Record<CertificadoStatus, string> = {
  ativo: "bg-success/15 text-success",
  a_vencer: "bg-warning/15 text-warning",
  vencido: "bg-destructive/15 text-destructive",
  ausente: "bg-secondary text-muted-foreground",
};

/**
 * Certificado digital das empresas: quem vence logo, quem já venceu e quem nunca teve a
 * validade informada. O aviso pelo WhatsApp só sai quando alguém clica.
 */
export default function CertificadosPage() {
  const qc = useQueryClient();
  const { admin } = useAuth();
  const podeAvisar = canSeeArea("alertas", admin?.areas, admin?.isOwner);
  const [filtro, setFiltro] = useState<CertificadoStatus | null>(null);
  const [busca, setBusca] = useState("");
  const [editar, setEditar] = useState<{ item: CertificadoItem; renovar: boolean } | null>(null);
  const [avisar, setAvisar] = useState<CertificadoItem | null>(null);

  const { data: overview } = useQuery({
    queryKey: ["certificados-overview"],
    queryFn: () => api.certificados.overview(),
  });
  const { data: itens, isLoading } = useQuery({
    queryKey: ["certificados-itens"],
    queryFn: () => api.certificados.itens(),
  });

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["certificados-itens"] });
    qc.invalidateQueries({ queryKey: ["certificados-overview"] });
  };

  const salvar = useMutation({
    mutationFn: async ({ item, renovar, dados }: { item: CertificadoItem; renovar: boolean; dados: CertificadoDados }) =>
      !renovar && item.certificado_id
        ? api.certificados.editar(item.certificado_id, dados)
        : api.certificados.criar({ ...dados, company_id: item.company_id }),
    onSuccess: () => {
      toast.success("Certificado salvo.");
      setEditar(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enviarAviso = useMutation({
    mutationFn: (item: CertificadoItem) => api.certificados.avisar(item.company_id),
    onSuccess: (r) => {
      toast.success(`Aviso enviado para ${r.numero}.`);
      setAvisar(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const termo = busca.trim().toLowerCase();
  const lista = (itens ?? []).filter(
    (i) =>
      (!filtro || i.status === filtro) &&
      (!termo || i.name.toLowerCase().includes(termo) || i.cnpj.replace(/\D/g, "").includes(termo.replace(/\D/g, "") || "§"))
  );

  return (
    <AdminLayout title="Certificado digital" description="Validade do e-CNPJ/e-CPF dos clientes e aviso de vencimento">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {CERT_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFiltro(filtro === s ? null : s)}
            className={cn("rounded-xl text-left ring-primary", filtro === s && "ring-2")}
          >
            <Indicador
              label={CERT_STATUS_LABELS[s].title}
              valor={overview ? overview.por_status[s] : "—"}
              dica={s === "a_vencer" && overview ? `vencem em até ${overview.dias_aviso} dias` : CERT_STATUS_LABELS[s].description}
              tom={CERT_STATUS_LABELS[s].tom === "muted" ? undefined : CERT_STATUS_LABELS[s].tom}
            />
          </button>
        ))}
      </section>

      <Input
        placeholder="Buscar empresa por nome ou CNPJ"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="max-w-sm"
      />

      {isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : lista.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma empresa neste filtro.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-secondary/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Empresa</th>
                <th className="px-4 py-2 font-medium">Validade</th>
                <th className="px-4 py-2 font-medium">Situação</th>
                <th className="px-4 py-2 font-medium">Certificado</th>
                <th className="px-4 py-2 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.company_id} className="border-t">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">{i.cnpj}</p>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {dataBr(i.vence_em)}
                    {i.dias_restantes !== null && (
                      <p className="text-xs text-muted-foreground">{prazoTexto(i.dias_restantes)}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", PILL[i.status])}>
                      {CERT_STATUS_LABELS[i.status].title}
                    </span>
                    {i.avisado_em && (
                      <p className="mt-1 text-[11px] text-muted-foreground">avisado em {dataBr(i.avisado_em)}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {i.tipo ? `${CERT_TITULAR_LABELS[i.titular!]} · ${CERT_TIPO_LABELS[i.tipo]}` : "—"}
                    {i.origem === "cliente" && <p>informado pelo cliente</p>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      {i.certificado_id && (
                        <Button size="sm" variant="ghost" onClick={() => setEditar({ item: i, renovar: false })} aria-label="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setEditar({ item: i, renovar: true })}>
                        <Plus className="mr-1 h-4 w-4" /> {i.certificado_id ? "Renovação" : "Cadastrar"}
                      </Button>
                      {podeAvisar && i.status !== "ativo" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!i.whatsapp}
                          title={i.whatsapp ? "Avisar pelo WhatsApp" : "Empresa sem WhatsApp cadastrado"}
                          onClick={() => setAvisar(i)}
                        >
                          <MessageCircle className="mr-1 h-4 w-4" /> Avisar
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(editar)} onOpenChange={(o) => !o && setEditar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editar?.renovar ? "Registrar certificado" : "Editar certificado"}</DialogTitle>
            <DialogDescription>{editar?.item.name}</DialogDescription>
          </DialogHeader>
          {editar && (
            <CertificadoForm
              key={`${editar.item.company_id}-${editar.renovar}`}
              inicial={
                editar.renovar
                  ? { tipo: editar.item.tipo ?? "a1", titular: editar.item.titular ?? "e_cnpj", emissor: editar.item.emissor }
                  : {
                      tipo: editar.item.tipo ?? "a1",
                      titular: editar.item.titular ?? "e_cnpj",
                      emissor: editar.item.emissor,
                      emitido_em: editar.item.emitido_em,
                      vence_em: editar.item.vence_em ?? "",
                    }
              }
              salvando={salvar.isPending}
              onCancelar={() => setEditar(null)}
              onSalvar={(dados) => salvar.mutate({ item: editar.item, renovar: editar.renovar, dados })}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(avisar)} onOpenChange={(o) => !o && setAvisar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Avisar pelo WhatsApp?</DialogTitle>
            <DialogDescription>
              A mensagem vai para {avisar?.whatsapp} ({avisar?.name}) dizendo que o certificado{" "}
              {avisar?.status === "ausente" ? "não tem validade registrada" : prazoTexto(avisar?.dias_restantes)} e pedindo a renovação.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAvisar(null)}>Cancelar</Button>
            <Button disabled={enviarAviso.isPending} onClick={() => avisar && enviarAviso.mutate(avisar)}>
              {enviarAviso.isPending ? "Enviando..." : "Enviar aviso"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
