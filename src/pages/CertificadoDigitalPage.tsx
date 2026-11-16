import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileBadge, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PortalPage } from "@/components/PortalPage";
import { HubCard, IconBox } from "@/components/hub/Hub";
import { CertificadoForm } from "@/components/hub/CertificadoForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type CertificadoDados } from "@/lib/api";
import {
  CERT_STATUS_LABELS,
  CERT_TIPO_LABELS,
  CERT_TITULAR_LABELS,
  dataBr,
  prazoTexto,
} from "@/lib/certificadoDigital";

/** Certificado digital da empresa: validade, aviso e onde informar a renovação. */
export default function CertificadoDigitalPage() {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["certificado-digital"],
    queryFn: () => api.certificadoDigital.meu(),
  });

  const salvar = useMutation({
    mutationFn: (d: CertificadoDados) => api.certificadoDigital.informar(d),
    onSuccess: () => {
      toast.success("Validade registrada. Obrigado por avisar.");
      setEditando(false);
      qc.invalidateQueries({ queryKey: ["certificado-digital"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cert = data?.certificado ?? null;
  const status = data?.status ?? "ausente";
  const meta = CERT_STATUS_LABELS[status];

  return (
    <PortalPage title="Certificado digital" subtitle="Meus documentos">
      <div className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-36 rounded-2xl" />
        ) : (
          <HubCard icon={FileBadge} titulo="Validade" tom={meta.tom === "muted" ? "primary" : meta.tom}>
            {cert ? (
              <>
                <p className="mt-3 text-2xl font-bold tabular-nums">{dataBr(cert.vence_em)}</p>
                <p className="text-sm text-muted-foreground">
                  <span
                    className={
                      meta.tom === "destructive"
                        ? "font-semibold text-destructive"
                        : meta.tom === "warning"
                          ? "font-semibold text-warning"
                          : "font-semibold text-success"
                    }
                  >
                    {meta.title}
                  </span>
                  {" · "}
                  {prazoTexto(cert.dias_restantes)}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Titular</dt>
                    <dd>{CERT_TITULAR_LABELS[cert.titular]}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Tipo</dt>
                    <dd>{CERT_TIPO_LABELS[cert.tipo]}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Emitido em</dt>
                    <dd>{dataBr(cert.emitido_em)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Certificadora</dt>
                    <dd className="truncate">{cert.emissor || "—"}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Ainda não temos a validade do certificado da sua empresa. Informe abaixo para receber o aviso antes de vencer.
              </p>
            )}
          </HubCard>
        )}

        {(status === "vencido" || status === "a_vencer") && (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <p className="font-semibold">O que fazer</p>
            <p className="mt-1 text-muted-foreground">
              Sem o certificado não conseguimos emitir notas nem entregar as declarações da empresa. Renove com a
              certificadora de sua preferência e depois informe a nova validade aqui.
            </p>
          </div>
        )}

        <HubCard
          icon={ShieldCheck}
          titulo={cert ? "Renovou? Informe a nova validade" : "Informar a validade"}
          acao={
            !editando && (
              <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
                {cert ? "Informar" : "Começar"}
              </Button>
            )
          }
        >
          {editando ? (
            <div className="mt-4">
              <CertificadoForm
                salvando={salvar.isPending}
                onSalvar={(d) => salvar.mutate(d)}
                onCancelar={() => setEditando(false)}
                textoBotao="Registrar validade"
              />
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Pedimos só as datas. O arquivo e a senha do certificado nunca são enviados pelo portal.
            </p>
          )}
        </HubCard>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <IconBox icon={FileBadge} tom="muted" className="h-6 w-6" />
          Avisamos no Início a partir de {data?.dias_aviso ?? 30} dias antes do vencimento.
        </p>
      </div>
    </PortalPage>
  );
}
