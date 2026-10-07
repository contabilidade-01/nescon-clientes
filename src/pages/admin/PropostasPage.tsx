import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ClipboardList, Copy, Download, FileSignature, Loader2, Mail, Plus, Printer, Save, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ContratoPreview } from "@/components/ContratoPreview";
import { AssistentePropostas } from "@/components/propostas/AssistentePropostas";
import { CatalogoEditor } from "@/components/propostas/CatalogoEditor";
import { AbaCliente, AbaCondicoes, AbaServicos, type SetProposta } from "@/components/propostas/FormularioProposta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";
import { api } from "@/lib/api";
import { brl, fmtData } from "@/lib/contratoModelo";
import { gerarContratoPdf, pdfParaBase64 } from "@/lib/generateContratoPdf";
import { maskCNPJ } from "@/lib/masks";
import {
  STATUS_PROPOSTA_LABEL,
  adicionarItem,
  aplicarPacote,
  camposPendentesProposta,
  mesclarCatalogo,
  metaPropostaPdf,
  montarProposta,
  normalizarProposta,
  propostaNova,
  reconciliar,
  resumoWhatsapp,
  tituloProposta,
  totais,
  validadeAte,
  type CatalogoProposta,
  type PropostaDados,
  type PropostaResumo,
  type PropostaStatus,
} from "@/lib/propostaModelo";

const STATUS_CLS: Record<PropostaStatus, string> = {
  rascunho: "bg-slate-100 text-slate-800 hover:bg-slate-100",
  salva: "bg-sky-100 text-sky-900 hover:bg-sky-100",
  enviada: "bg-amber-100 text-amber-900 hover:bg-amber-100",
  aceita: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100",
  recusada: "bg-rose-100 text-rose-900 hover:bg-rose-100",
};

function StatusBadge({ s }: { s: PropostaStatus }) {
  return <Badge className={STATUS_CLS[s] || STATUS_CLS.rascunho}>{STATUS_PROPOSTA_LABEL[s] || s}</Badge>;
}

function abrirBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function useCatalogo() {
  const q = useQuery({ queryKey: ["admin-propostas", "catalogo"], queryFn: () => api.admin.propostas.catalogo() });
  const catalogo = useMemo(() => mesclarCatalogo(q.data?.catalogo), [q.data]);
  return { catalogo, carregando: q.isLoading };
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------
function Lista({ onAbrir, onNova }: { onAbrir: (id: string) => void; onNova: () => void }) {
  const queryClient = useQueryClient();
  const lista = useQuery({ queryKey: ["admin-propostas", "lista"], queryFn: () => api.admin.propostas.list() });
  const [filtro, setFiltro] = useState<PropostaStatus | "todas">("todas");
  const [busca, setBusca] = useState("");

  const remover = useMutation({
    mutationFn: (id: string) => api.admin.propostas.remove(id),
    onSuccess: () => {
      toast.success("Proposta excluída.");
      queryClient.invalidateQueries({ queryKey: ["admin-propostas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hoje = new Date().toISOString().slice(0, 10);
  const itens = (lista.data || []).filter(
    (p) => (filtro === "todas" || p.status === filtro) && (!busca.trim() || `${p.cliente_nome} ${p.titulo}`.toLowerCase().includes(busca.trim().toLowerCase())),
  );
  const contagem = (s: PropostaStatus) => (lista.data || []).filter((p) => p.status === s).length;
  const emAberto = (lista.data || []).filter((p) => p.status === "enviada" || p.status === "salva");
  const potencialMensal = emAberto.reduce((a, p) => a + p.total_mensal, 0);
  const potencialUnico = emAberto.reduce((a, p) => a + p.total_unico, 0);

  function vencida(p: PropostaResumo) {
    return Boolean(p.validade_ate && p.validade_ate < hoje && (p.status === "enviada" || p.status === "salva"));
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { rot: "Em aberto", val: String(emAberto.length), sub: `${brl(potencialUnico)} + ${brl(potencialMensal)}/mês` },
          { rot: "Enviadas", val: String(contagem("enviada")), sub: "aguardando resposta" },
          { rot: "Aceitas", val: String(contagem("aceita")), sub: "viraram cliente/serviço" },
          { rot: "Recusadas", val: String(contagem("recusada")), sub: "" },
        ].map((k) => (
          <Card key={k.rot}>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{k.rot}</div>
              <div className="text-2xl font-semibold">{k.val}</div>
              <div className="text-xs text-muted-foreground">{k.sub || " "}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente ou título…" className="w-full sm:w-72" />
        <div className="flex flex-wrap gap-1">
          {(["todas", "rascunho", "salva", "enviada", "aceita", "recusada"] as const).map((s) => (
            <Button key={s} size="sm" variant={filtro === s ? "secondary" : "ghost"} onClick={() => setFiltro(s)}>
              {s === "todas" ? "Todas" : STATUS_PROPOSTA_LABEL[s]}
            </Button>
          ))}
        </div>
        <div className="flex-1" />
        <Button onClick={onNova}>
          <Plus className="mr-1 h-4 w-4" /> Nova proposta
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Serviços</TableHead>
                <TableHead className="text-right">Mensal</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead>Atualizada</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.length ? (
                itens.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => onAbrir(p.id)}>
                    <TableCell>
                      <div className="font-medium">{p.cliente_nome || "(sem nome)"}</div>
                      <div className="text-xs text-muted-foreground">{p.company_name ? "Cliente do portal" : "Prospecto"}</div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge s={p.status} />
                    </TableCell>
                    <TableCell className="text-right">{p.total_unico ? brl(p.total_unico) : "—"}</TableCell>
                    <TableCell className="text-right">{p.total_mensal ? brl(p.total_mensal) : "—"}</TableCell>
                    <TableCell className={vencida(p) ? "text-rose-700" : ""}>
                      {p.validade_ate ? fmtData(p.validade_ate) : "—"}
                      {vencida(p) ? " (vencida)" : ""}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(p.updated_at).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Excluir"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Excluir a proposta de ${p.cliente_nome || "sem nome"}?`)) remover.mutate(p.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    {lista.isLoading ? "Carregando…" : "Nenhuma proposta. Clique em “Nova proposta” e converse com o assistente."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
function Editor({ id, catalogo, onVoltar }: { id: string | null; catalogo: CatalogoProposta; onVoltar: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const empresas = useAdminCompanies();
  const config = useQuery({ queryKey: ["admin-propostas", "config"], queryFn: () => api.admin.propostas.config() });
  const tabela = useQuery({ queryKey: ["admin-propostas", "tabela"], queryFn: () => api.admin.propostas.tabela(), retry: false });
  const existente = useQuery({ queryKey: ["admin-propostas", id], queryFn: () => api.admin.propostas.get(id as string), enabled: Boolean(id) });
  const tab = tabela.data?.padroes;

  const [propostaId, setPropostaId] = useState<string | null>(id);
  const [companyId, setCompanyId] = useState("");
  const [dados, setDadosState] = useState<PropostaDados>(() => propostaNova(catalogo));
  const [status, setStatus] = useState<PropostaStatus | null>(null);
  const [publicar, setPublicar] = useState(false);
  const [salvoJson, setSalvoJson] = useState<string | null>(id ? null : JSON.stringify(propostaNova(catalogo)));
  const [dialogEmail, setDialogEmail] = useState(false);
  const [para, setPara] = useState("");
  const [mensagem, setMensagem] = useState("");
  const padroesAplicados = useRef(false);

  // Proposta nova nasce com os padrões do catálogo (que podem chegar depois do primeiro render).
  useEffect(() => {
    if (id || padroesAplicados.current) return;
    padroesAplicados.current = true;
    const nova = propostaNova(catalogo);
    setDadosState(nova);
    setSalvoJson(JSON.stringify(nova));
  }, [id, catalogo]);

  useEffect(() => {
    if (!existente.data) return;
    const d = normalizarProposta(existente.data.dados, catalogo);
    setDadosState(d);
    setSalvoJson(JSON.stringify(d));
    setStatus(existente.data.status);
    setCompanyId(existente.data.company_id || "");
    setPropostaId(existente.data.id);
    setPublicar(Boolean(existente.data.deliverable_id));
  }, [existente.data, catalogo]);

  const setDados = (d: PropostaDados) => setDadosState(reconciliar(d, catalogo, tab));
  const set: SetProposta = (fn) => setDadosState((d) => reconciliar(fn(d), catalogo, tab));

  const blocos = useMemo(() => montarProposta(dados, catalogo.padroes), [dados, catalogo.padroes]);
  const meta = useMemo(() => metaPropostaPdf(dados, catalogo.padroes), [dados, catalogo.padroes]);
  const tot = useMemo(() => totais(dados), [dados]);
  const pendentes = useMemo(() => camposPendentesProposta(dados), [dados]);
  const titulo = tituloProposta(dados);
  const sujo = salvoJson !== null && JSON.stringify(dados) !== salvoJson;
  const travada = status === "aceita";

  function escolherEmpresa(cid: string) {
    setCompanyId(cid);
    const e = empresas.data?.find((x) => x.id === cid);
    if (!e) return;
    set((d) => ({
      ...d,
      cliente: {
        ...d.cliente,
        nome: e.name,
        cnpj: maskCNPJ(e.cnpj.replace(/\D/g, "")),
        email: e.contact_email || d.cliente.email,
        telefone: e.phone || d.cliente.telefone,
      },
    }));
  }

  function gerarPdf() {
    return gerarContratoPdf(blocos, meta, null);
  }

  function corpo(comPdf: boolean) {
    return {
      company_id: companyId || null,
      titulo,
      dados,
      pdf_base64: comPdf ? pdfParaBase64(gerarPdf()) : undefined,
      publicar_portal: companyId ? publicar : false,
      total_unico: tot.unico,
      total_mensal: tot.mensal,
      validade_ate: validadeAte(dados) || null,
    };
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const b = corpo(true);
      return propostaId ? api.admin.propostas.update(propostaId, b) : api.admin.propostas.create(b);
    },
    onSuccess: (p) => {
      setPropostaId(p.id);
      setStatus(p.status);
      setSalvoJson(JSON.stringify(dados));
      toast.success(companyId && publicar ? "Proposta salva e disponível no portal do cliente." : "Proposta salva.");
      queryClient.invalidateQueries({ queryKey: ["admin-propostas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mudarStatus = useMutation({
    mutationFn: (s: "enviada" | "aceita" | "recusada" | "salva") => api.admin.propostas.status(propostaId as string, s),
    onSuccess: (p) => {
      setStatus(p.status);
      toast.success(`Proposta marcada como ${STATUS_PROPOSTA_LABEL[p.status].toLowerCase()}.`);
      queryClient.invalidateQueries({ queryKey: ["admin-propostas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enviarEmail = useMutation({
    mutationFn: async () => {
      // Sempre manda o PDF do que está na tela: salva antes.
      const b = corpo(true);
      const salva = propostaId ? await api.admin.propostas.update(propostaId, b) : await api.admin.propostas.create(b);
      setPropostaId(salva.id);
      setSalvoJson(JSON.stringify(dados));
      return api.admin.propostas.enviarEmail(salva.id, {
        para: para.split(/[;,\s]+/).filter(Boolean),
        mensagem: mensagem.trim() || undefined,
      });
    },
    onSuccess: (p) => {
      setStatus(p.status);
      setDialogEmail(false);
      toast.success("Proposta enviada por e-mail.");
      queryClient.invalidateQueries({ queryKey: ["admin-propostas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function copiarResumo() {
    try {
      await navigator.clipboard.writeText(resumoWhatsapp(dados));
      toast.success("Resumo copiado — cole no WhatsApp.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  const iaOk = Boolean(config.data?.ia);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost" size="sm" onClick={onVoltar}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Lista
        </Button>
        {status ? <StatusBadge s={status} /> : <Badge variant="secondary">Não salva</Badge>}
        {sujo ? <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">alterações não salvas</Badge> : null}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={copiarResumo}>
          <Copy className="mr-1 h-4 w-4" /> Resumo p/ WhatsApp
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" /> Imprimir
        </Button>
        <Button variant="outline" size="sm" onClick={() => gerarPdf().save(`${titulo}.pdf`)}>
          <Download className="mr-1 h-4 w-4" /> Baixar PDF
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={travada || !dados.itens.some((i) => i.ativo)}
          onClick={() => {
            setPara(dados.cliente.email);
            setDialogEmail(true);
          }}
        >
          <Mail className="mr-1 h-4 w-4" /> Enviar por e-mail
        </Button>
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending || travada}>
          {salvar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} {propostaId ? "Salvar alterações" : "Salvar proposta"}
        </Button>
      </div>

      {propostaId && status && status !== "aceita" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm print:hidden">
          <span className="text-muted-foreground">Resposta do cliente:</span>
          {status !== "enviada" ? (
            <Button size="sm" variant="ghost" onClick={() => mudarStatus.mutate("enviada")} disabled={mudarStatus.isPending || sujo}>
              <Mail className="mr-1 h-4 w-4" /> Marcar como enviada
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="text-emerald-700" onClick={() => mudarStatus.mutate("aceita")} disabled={mudarStatus.isPending || sujo}>
            <CheckCircle2 className="mr-1 h-4 w-4" /> Aceitou
          </Button>
          <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => mudarStatus.mutate("recusada")} disabled={mudarStatus.isPending || sujo}>
            <XCircle className="mr-1 h-4 w-4" /> Recusou
          </Button>
          {sujo ? <span className="text-xs text-muted-foreground">(salve antes)</span> : null}
        </div>
      ) : null}
      {travada ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 print:hidden">
          Proposta aceita — não pode mais ser alterada. Para mudar condições, crie uma nova.
        </div>
      ) : null}
      {propostaId && !sujo ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm print:hidden">
          <span className="text-muted-foreground">
            {travada ? "Próximo passo:" : "Já quer adiantar?"}
          </span>
          <Button size="sm" variant={travada ? "default" : "outline"} onClick={() => navigate(`/admin/contratos?proposta=${propostaId}`)}>
            <FileSignature className="mr-1 h-4 w-4" /> Gerar contrato com estes dados
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/admin/onboarding?proposta=${propostaId}`)}>
            <ClipboardList className="mr-1 h-4 w-4" /> Criar onboarding
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-3 print:hidden">
          <div className="grid grid-cols-3 gap-2">
            <Card>
              <CardContent className="px-3 pt-3 pb-2">
                <div className="text-xs text-muted-foreground">Serviços</div>
                <div className="font-semibold">{brl(tot.unico)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-3 pt-3 pb-2">
                <div className="text-xs text-muted-foreground">Mensal</div>
                <div className="font-semibold">{brl(tot.mensal)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-3 pt-3 pb-2">
                <div className="text-xs text-muted-foreground">Repasses</div>
                <div className="font-semibold">{brl(tot.repasses)}</div>
              </CardContent>
            </Card>
          </div>
          {pendentes.length ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">Falta: {pendentes.join(" · ")}</div>
          ) : null}

          <Tabs defaultValue="assistente">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="assistente">Assistente</TabsTrigger>
              <TabsTrigger value="servicos">Serviços</TabsTrigger>
              <TabsTrigger value="cliente">Cliente</TabsTrigger>
              <TabsTrigger value="condicoes">Condições</TabsTrigger>
            </TabsList>
            <fieldset disabled={travada} className="mt-3 min-w-0 border-0 p-0">
              <TabsContent value="assistente" className="m-0">
                <AssistentePropostas
                  dados={dados}
                  setDados={setDados}
                  catalogo={catalogo}
                  tabela={tab}
                  habilitado={iaOk && !travada}
                  motivoDesligado={config.isLoading ? "Verificando o assistente…" : "Chave da Claude não configurada (ANTHROPIC_API_KEY)."}
                />
              </TabsContent>
              <TabsContent value="servicos" className="m-0">
                <AbaServicos
                  d={dados}
                  set={set}
                  catalogo={catalogo}
                  onPacote={(pid) => setDados(aplicarPacote(dados, catalogo, pid, tab))}
                  onItem={(codigo) => setDados(adicionarItem(dados, catalogo, codigo, tab))}
                />
              </TabsContent>
              <TabsContent value="cliente" className="m-0">
                <AbaCliente d={dados} set={set} empresas={empresas.data || []} companyId={companyId} onEmpresa={escolherEmpresa} />
                {companyId ? (
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <Checkbox checked={publicar} onCheckedChange={(v) => setPublicar(v === true)} />
                    Disponibilizar o PDF no portal do cliente (Documentos) ao salvar
                  </label>
                ) : null}
              </TabsContent>
              <TabsContent value="condicoes" className="m-0">
                <AbaCondicoes d={dados} set={set} />
              </TabsContent>
            </fieldset>
          </Tabs>
        </div>

        <div className="overflow-auto rounded-md border bg-muted/30 p-2 xl:max-h-[calc(100vh-9rem)] xl:sticky xl:top-4 print:border-0 print:p-0">
          <div className="mx-auto origin-top scale-[0.62] sm:scale-[0.75] xl:scale-[0.62] 2xl:scale-[0.75]" style={{ width: "210mm", marginBottom: "-38%" }}>
            <ContratoPreview
              blocos={blocos}
              rodapeEsquerda={meta.rodapeEsquerda}
              rodapeDireita={meta.rodapeDireita}
              faixa={meta.faixa}
            />
          </div>
        </div>
      </div>

      <Dialog open={dialogEmail} onOpenChange={setDialogEmail}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar proposta por e-mail</DialogTitle>
            <DialogDescription>Salva a versão atual e manda o PDF anexo. Mais de um e-mail: separe por vírgula.</DialogDescription>
          </DialogHeader>
          {config.data && !config.data.smtp ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
              E-mail (SMTP) não configurado neste ambiente. Baixe o PDF e envie por WhatsApp ou pelo seu e-mail.
            </div>
          ) : null}
          <Input value={para} onChange={(e) => setPara(e.target.value)} placeholder="cliente@empresa.com.br" />
          <Textarea rows={4} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Mensagem (opcional). Vazio usa o texto padrão." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogEmail(false)}>
              Cancelar
            </Button>
            <Button onClick={() => enviarEmail.mutate()} disabled={enviarEmail.isPending || !para.trim() || !config.data?.smtp}>
              {enviarEmail.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Mail className="mr-1 h-4 w-4" />} Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
export default function PropostasPage() {
  const { catalogo, carregando } = useCatalogo();
  const [editando, setEditando] = useState<{ id: string | null } | null>(null);

  return (
    <AdminLayout
      title="Propostas"
      description="Assistente que monta a proposta conversando com você, cenários prontos (MEI, ME/EPP, abertura, parcelamentos…), catálogo de preços, PDF e envio."
    >
      {editando ? (
        carregando ? (
          <p className="text-sm text-muted-foreground">Carregando catálogo…</p>
        ) : (
          <Editor key={editando.id || "nova"} id={editando.id} catalogo={catalogo} onVoltar={() => setEditando(null)} />
        )
      ) : (
        <Tabs defaultValue="propostas">
          <TabsList>
            <TabsTrigger value="propostas">Propostas</TabsTrigger>
            <TabsTrigger value="catalogo">Catálogo e pacotes</TabsTrigger>
          </TabsList>
          <TabsContent value="propostas" className="mt-4">
            <Lista onAbrir={(id) => setEditando({ id })} onNova={() => setEditando({ id: null })} />
          </TabsContent>
          <TabsContent value="catalogo" className="mt-4">
            {carregando ? <p className="text-sm text-muted-foreground">Carregando…</p> : <CatalogoEditor atual={catalogo} />}
          </TabsContent>
        </Tabs>
      )}
    </AdminLayout>
  );
}
