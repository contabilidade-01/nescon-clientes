import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, EyeOff, FileUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { CompanyPicker } from "@/components/admin/CompanyPicker";
import { Indicador } from "@/components/hub/Hub";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type CertidaoImportResultado, type CertidaoItem } from "@/lib/api";
import { maskCNPJ } from "@/lib/masks";
import { openDeliverableFile } from "@/lib/openFile";
import { cn } from "@/lib/utils";

type Situacao = "retida" | "publicada" | "substituida";

function situacao(c: CertidaoItem): Situacao {
  if (!c.released_at) return "retida";
  return c.cancelado ? "substituida" : "publicada";
}

const SITUACAO: Record<Situacao, { label: string; pill: string }> = {
  retida: { label: "Aguardando validação", pill: "bg-warning/15 text-warning" },
  publicada: { label: "Publicada para o cliente", pill: "bg-success/15 text-success" },
  substituida: { label: "Substituída por outra mais nova", pill: "bg-secondary text-muted-foreground" },
};

const STATUS_IMPORT: Record<CertidaoImportResultado["status"], string> = {
  importada: "Importada (aguardando validação)",
  duplicada: "Já estava importada",
  sem_empresa: "Empresa não encontrada: escolha abaixo",
  nao_certidao: "Não parece certidão de inteiro teor",
  erro: "Erro ao processar",
};

type Pendente = { file: File; resultado: CertidaoImportResultado; companyId: string };

/**
 * Certidão de inteiro teor por empresa. O PDF entra RETIDO (só o painel vê); depois de
 * conferir, o admin libera e ele aparece em Documentos do cliente. Liberar uma certidão
 * nova tira as anteriores da mesma empresa da tela do cliente.
 */
export default function CertidoesPage() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [filtro, setFiltro] = useState<Situacao | null>("retida");
  const [busca, setBusca] = useState("");
  const [enviando, setEnviando] = useState<{ feito: number; total: number } | null>(null);
  const [resultados, setResultados] = useState<CertidaoImportResultado[]>([]);
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [descartar, setDescartar] = useState<CertidaoItem | null>(null);
  const [liberarTodas, setLiberarTodas] = useState(false);

  const { data: itens, isLoading } = useQuery({
    queryKey: ["certidoes-inteiro-teor"],
    queryFn: () => api.certidoes.listar(),
  });
  const atualizar = () => qc.invalidateQueries({ queryKey: ["certidoes-inteiro-teor"] });

  const contagem = useMemo(() => {
    const c: Record<Situacao, number> = { retida: 0, publicada: 0, substituida: 0 };
    for (const i of itens ?? []) c[situacao(i)]++;
    return c;
  }, [itens]);

  const termo = busca.trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");
  const lista = (itens ?? []).filter(
    (i) =>
      (!filtro || situacao(i) === filtro) &&
      (!termo ||
        i.company_name.toLowerCase().includes(termo) ||
        (digitos && i.company_cnpj.replace(/\D/g, "").includes(digitos)))
  );
  const retidasVisiveis = lista.filter((i) => situacao(i) === "retida");

  // Um arquivo por requisição: o lote inteiro numa só passaria do limite de upload.
  async function importar(files: File[]) {
    if (!files.length) return;
    setResultados([]);
    setEnviando({ feito: 0, total: files.length });
    const novos: CertidaoImportResultado[] = [];
    const semEmpresa: Pendente[] = [];
    for (const [idx, file] of files.entries()) {
      try {
        const { resultados: r } = await api.certidoes.importar([file]);
        novos.push(...r);
        if (r[0]?.status === "sem_empresa") semEmpresa.push({ file, resultado: r[0], companyId: "" });
      } catch (e) {
        novos.push({ arquivo: file.name, status: "erro", erro: e instanceof Error ? e.message : String(e) });
      }
      setEnviando({ feito: idx + 1, total: files.length });
    }
    setEnviando(null);
    setResultados(novos);
    setPendentes((p) => [...p, ...semEmpresa]);
    const ok = novos.filter((r) => r.status === "importada").length;
    toast.success(`${ok} de ${files.length} certidões importadas para validação.`);
    atualizar();
  }

  const enviarPendente = useMutation({
    mutationFn: async (p: Pendente) => api.certidoes.importar([p.file], p.companyId),
    onSuccess: (r, p) => {
      const st = r.resultados[0]?.status;
      if (st === "importada" || st === "duplicada") {
        toast.success(`${p.file.name}: ${STATUS_IMPORT[st]}.`);
        setPendentes((lista) => lista.filter((x) => x !== p));
        atualizar();
      } else {
        toast.error(`${p.file.name}: ${st ? STATUS_IMPORT[st] : "erro"}`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const liberar = useMutation({
    mutationFn: (id: string) => api.certidoes.liberar(id),
    onSuccess: (r) => {
      toast.success(
        r.substituidas
          ? `Publicada. ${r.substituidas} certidão(ões) anterior(es) saiu(íram) da tela do cliente.`
          : "Publicada em Documentos do cliente."
      );
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const liberarLote = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api.certidoes.liberar(id);
      return ids.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} certidões publicadas.`);
      setLiberarTodas(false);
      atualizar();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      atualizar();
    },
  });

  const reter = useMutation({
    mutationFn: (id: string) => api.certidoes.reter(id),
    onSuccess: () => {
      toast.success("Retirada da tela do cliente.");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const apagar = useMutation({
    mutationFn: (id: string) => api.certidoes.descartar(id),
    onSuccess: () => {
      toast.success("Certidão descartada.");
      setDescartar(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ver = (i: CertidaoItem) =>
    openDeliverableFile(i.id, i.file_name).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));

  return (
    <AdminLayout
      title="Certidão de inteiro teor"
      description="Importe as certidões da JUCESP, confira cada uma e publique em Documentos do cliente"
    >
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(Object.keys(SITUACAO) as Situacao[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFiltro(filtro === s ? null : s)}
            className={cn("rounded-xl text-left ring-primary", filtro === s && "ring-2")}
          >
            <Indicador
              label={SITUACAO[s].label}
              valor={itens ? contagem[s] : "—"}
              tom={s === "retida" && contagem.retida ? "warning" : s === "publicada" ? "success" : undefined}
            />
          </button>
        ))}
      </section>

      <section className="space-y-3 rounded-2xl border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              importar(files);
            }}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={Boolean(enviando)}>
            <FileUp className="mr-2 h-4 w-4" />
            {enviando ? `Enviando ${enviando.feito} de ${enviando.total}...` : "Importar certidões (PDF)"}
          </Button>
          <p className="text-xs text-muted-foreground">
            A empresa é achada pelo CNPJ dentro do PDF (ou no começo do nome do arquivo). Nada aparece para o cliente
            antes de você publicar.
          </p>
        </div>

        {resultados.length > 0 && (
          <ul className="space-y-1 text-sm">
            {resultados.map((r, idx) => (
              <li key={`${r.arquivo}-${idx}`} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{r.arquivo}</span>
                <span
                  className={cn(
                    "text-muted-foreground",
                    r.status === "importada" && "text-success",
                    (r.status === "erro" || r.status === "nao_certidao") && "text-destructive"
                  )}
                >
                  {STATUS_IMPORT[r.status]}
                  {r.empresa ? ` · ${r.empresa}` : ""}
                  {r.erro ? ` · ${r.erro}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        {pendentes.length > 0 && (
          <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-3">
            <p className="text-sm font-medium">Escolha a empresa destas certidões</p>
            {pendentes.map((p, idx) => (
              <div key={`${p.file.name}-${idx}`} className="grid gap-2 md:grid-cols-[1fr_320px_auto] md:items-center">
                <div className="text-sm">
                  <p className="font-medium">{p.resultado.nome || p.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.file.name}
                    {p.resultado.cnpjs?.length ? ` · CNPJ no PDF: ${p.resultado.cnpjs.map(maskCNPJ).join(", ")}` : " · sem CNPJ no PDF"}
                  </p>
                </div>
                <CompanyPicker
                  value={p.companyId}
                  allowAll={false}
                  placeholder="Escolher empresa"
                  onChange={(id) =>
                    setPendentes((lista) => lista.map((x) => (x === p ? { ...x, companyId: id } : x)))
                  }
                />
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    disabled={!p.companyId || enviarPendente.isPending}
                    onClick={() => enviarPendente.mutate(p)}
                  >
                    Importar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendentes((l) => l.filter((x) => x !== p))}>
                    Ignorar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          placeholder="Buscar empresa por nome ou CNPJ"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-sm"
        />
        {retidasVisiveis.length > 1 && (
          <Button variant="outline" onClick={() => setLiberarTodas(true)}>
            <CheckCircle2 className="mr-2 h-4 w-4" /> Publicar as {retidasVisiveis.length} desta lista
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : lista.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma certidão neste filtro.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-secondary/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Empresa</th>
                <th className="px-4 py-2 font-medium">Certidão</th>
                <th className="px-4 py-2 font-medium">Situação</th>
                <th className="px-4 py-2 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((i) => {
                const s = situacao(i);
                return (
                  <tr key={i.id} className="border-t">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{i.company_name}</p>
                      <p className="text-xs text-muted-foreground">{maskCNPJ(i.company_cnpj)}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <p>{i.title}</p>
                      <p className="text-xs text-muted-foreground">{i.file_name}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", SITUACAO[s].pill)}>
                        {SITUACAO[s].label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => ver(i)} aria-label="Ver PDF">
                          <Eye className="mr-1 h-4 w-4" /> Ver
                        </Button>
                        {s !== "publicada" && (
                          <Button size="sm" disabled={liberar.isPending} onClick={() => liberar.mutate(i.id)}>
                            <CheckCircle2 className="mr-1 h-4 w-4" /> Publicar
                          </Button>
                        )}
                        {s === "publicada" && (
                          <Button size="sm" variant="outline" disabled={reter.isPending} onClick={() => reter.mutate(i.id)}>
                            <EyeOff className="mr-1 h-4 w-4" /> Tirar do cliente
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setDescartar(i)} aria-label="Descartar">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={liberarTodas} onOpenChange={setLiberarTodas}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publicar {retidasVisiveis.length} certidões?</DialogTitle>
            <DialogDescription>
              Cada uma passa a aparecer em Documentos do respectivo cliente. Publique em lote só as que você já conferiu.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLiberarTodas(false)}>Cancelar</Button>
            <Button disabled={liberarLote.isPending} onClick={() => liberarLote.mutate(retidasVisiveis.map((i) => i.id))}>
              {liberarLote.isPending ? "Publicando..." : "Publicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(descartar)} onOpenChange={(o) => !o && setDescartar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar esta certidão?</DialogTitle>
            <DialogDescription>
              {descartar?.company_name}: {descartar?.title}. O arquivo é apagado do portal (o original na sua pasta não é
              mexido).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDescartar(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={apagar.isPending} onClick={() => descartar && apagar.mutate(descartar.id)}>
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
