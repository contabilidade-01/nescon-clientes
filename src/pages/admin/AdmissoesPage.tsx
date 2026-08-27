import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Search } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import {
  DADOS_FIELD_LABELS,
  ORIGEM_LABEL,
  STATUS_LABEL,
  formatAdmissionField,
  mergeAdmissionDados,
  type AdmissionDados,
  type AdmissionDetail,
  type AdmissionOrigem,
  type AdmissionStatus,
} from "@/lib/admissionFicha";
import { downloadAdmissionPdf } from "@/lib/generateAdmissionPdf";
import { maskCNPJ } from "@/lib/masks";

function getToken(): string | null {
  try {
    const session = localStorage.getItem("company_session");
    if (!session) return null;
    return JSON.parse(session).token || null;
  } catch {
    return null;
  }
}

const AdmissoesPage = () => {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [origem, setOrigem] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [aberta, setAberta] = useState<AdmissionDetail | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-admissoes", origem, status, q],
    queryFn: () =>
      api.admin.admissoes.list({
        origem: origem || undefined,
        status: status || undefined,
        q: q || undefined,
      }),
  });

  const setStatusMut = useMutation({
    mutationFn: ({ id, status: st }: { id: string; status: AdmissionStatus }) =>
      api.admin.admissoes.setStatus(id, st),
    onSuccess: (det) => {
      setAberta(det);
      qc.invalidateQueries({ queryKey: ["admin-admissoes"] });
      toast.success("Status atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lista = data || [];
  const novos = useMemo(() => lista.filter((x) => x.status === "novo").length, [lista]);

  const abrir = async (id: string) => {
    try {
      const d = await api.admin.admissoes.get(id);
      setAberta(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao abrir");
    }
  };

  const baixarAnexo = async (formId: string, anexoId: string, nome: string) => {
    const token = getToken();
    const url = api.admin.admissoes.anexoUrl(formId, anexoId);
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      toast.error("Não foi possível baixar o anexo");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <AdminLayout title="Admissões" description="Fichas de registro enviadas pelo portal ou pelo link público">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Empresa, CNPJ ou funcionário" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="h-10 rounded-md border bg-background px-2 text-sm" value={origem} onChange={(e) => setOrigem(e.target.value)}>
          <option value="">Todas as origens</option>
          <option value="portal">Portal</option>
          <option value="publico_cliente">Público (cliente)</option>
          <option value="publico_externo">Público (fora)</option>
        </select>
        <select className="h-10 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="novo">Novo</option>
          <option value="em_andamento">Em andamento</option>
          <option value="concluido">Concluído</option>
        </select>
        {novos > 0 && <Badge>{novos} nova(s)</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Fila</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[36rem] space-y-2 overflow-y-auto text-sm">
            {isLoading ? (
              <p className="text-muted-foreground">Carregando...</p>
            ) : lista.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma ficha ainda.</p>
            ) : (
              lista.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => abrir(f.id)}
                  className="flex w-full flex-col rounded-lg border p-3 text-left hover:border-primary/40"
                >
                  <span className="font-medium">{f.funcionario_nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.empresa_nome} · {maskCNPJ(f.empresa_cnpj)}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="secondary">{ORIGEM_LABEL[f.origem as AdmissionOrigem]}</Badge>
                    <Badge variant={f.status === "novo" ? "default" : "outline"}>{STATUS_LABEL[f.status as AdmissionStatus]}</Badge>
                    {f.anexos_count > 0 && <Badge variant="outline">{f.anexos_count} anexo(s)</Badge>}
                    {!f.company_id && f.contato_email && (
                      <span className="text-[10px] text-muted-foreground">{f.contato_email} · {f.contato_telefone}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Detalhe
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!aberta ? (
              <p className="text-muted-foreground">Selecione uma ficha à esquerda.</p>
            ) : (
              <>
                <p>
                  <b>{mergeAdmissionDados(aberta.dados).nome}</b>
                  <br />
                  {aberta.empresa_nome} · {maskCNPJ(aberta.empresa_cnpj)}
                </p>
                {aberta.contato_email && (
                  <p className="text-xs text-muted-foreground">
                    Contato: {aberta.contato_email} · {aberta.contato_telefone}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {(["novo", "em_andamento", "concluido"] as AdmissionStatus[]).map((st) => (
                    <Button
                      key={st}
                      size="sm"
                      variant={aberta.status === st ? "default" : "outline"}
                      onClick={() => setStatusMut.mutate({ id: aberta.id, status: st })}
                    >
                      {STATUS_LABEL[st]}
                    </Button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadAdmissionPdf({
                      empresaNome: aberta.empresa_nome,
                      empresaCnpj: aberta.empresa_cnpj,
                      contatoEmail: aberta.contato_email,
                      contatoTelefone: aberta.contato_telefone,
                      dados: mergeAdmissionDados(aberta.dados),
                    })
                  }
                >
                  <Download className="mr-2 h-4 w-4" /> PDF da ficha
                </Button>
                {aberta.anexos.length > 0 && (
                  <ul className="text-xs">
                    {aberta.anexos.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          className="text-primary underline"
                          onClick={() => baixarAnexo(aberta.id, a.id, a.file_name)}
                        >
                          {a.file_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <dl className="grid max-h-80 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {(Object.keys(DADOS_FIELD_LABELS) as (keyof AdmissionDados)[]).map((key) => (
                    <div key={key} className="contents">
                      <dt>{DADOS_FIELD_LABELS[key]}</dt>
                      <dd className="text-foreground">{formatAdmissionField(key, mergeAdmissionDados(aberta.dados))}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdmissoesPage;
