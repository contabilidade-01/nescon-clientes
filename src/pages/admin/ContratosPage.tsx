import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  CopyPlus,
  Download,
  ClipboardList,
  ExternalLink,
  FilePlus2,
  FileSignature,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ContratoPreview } from "@/components/ContratoPreview";
import { AbaPerfis, usePresets } from "@/components/contratos/AbaPerfis";
import { AssistenteContrato } from "@/components/contratos/AssistenteContrato";
import {
  Campo,
  SecaoContratada,
  SecaoContratante,
  SecaoHonorarios,
  SecaoModeloFaixa,
  SecaoPrazosVigencia,
  SecaoRegras,
  type SetSecao,
} from "@/components/contratos/FormularioContrato";
import { NovoContratoRapido } from "@/components/contratos/NovoContratoRapido";
import { PainelAditivo, type AditivoMeta } from "@/components/contratos/PainelAditivo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";
import { api } from "@/lib/api";
import {
  dadosDoAditivo,
  diffParcial,
  montarAditivo,
  normalizarAditivo,
  pendentesAditivo,
  sugerirPreset,
  tituloAditivo,
  type AditivoDados,
} from "@/lib/contratoCampos";
import {
  cadastroCompleto,
  camposPendentes,
  dadosPadrao,
  mesclarDados,
  montarContrato,
  normalizarDados,
  tituloContrato,
  type ContratoDados,
  type ContratoDetalhe,
  type ContratoParcial,
  type ContratoResumo,
  type ContratoSigner,
  type ContratoStatus,
} from "@/lib/contratoModelo";
import { gerarContratoPdf, pdfParaBase64, type ContratoPdfMeta } from "@/lib/generateContratoPdf";
import { num } from "@/lib/inputNum";
import { maskCNPJ } from "@/lib/masks";

const STATUS_LABEL: Record<ContratoStatus, { texto: string; cls: string }> = {
  rascunho: { texto: "Rascunho", cls: "bg-slate-100 text-slate-800 hover:bg-slate-100" },
  salvo: { texto: "PDF no portal", cls: "bg-sky-100 text-sky-900 hover:bg-sky-100" },
  enviado: { texto: "Aguardando assinatura", cls: "bg-amber-100 text-amber-900 hover:bg-amber-100" },
  assinado: { texto: "Assinado", cls: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100" },
};

function StatusBadge({ s }: { s: ContratoStatus }) {
  const v = STATUS_LABEL[s] || STATUS_LABEL.rascunho;
  return <Badge className={v.cls}>{v.texto}</Badge>;
}

function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function metaPdf(d: ContratoDados, titulo: string): ContratoPdfMeta {
  return {
    titulo,
    // Endereço fica só na identificação das partes; o rodapé leva nome e CNPJ.
    rodapeEsquerda: [d.contratada.razao || "", `CNPJ ${d.contratada.cnpj}`].filter(Boolean),
    rodapeDireita: [d.contratada.respTecnico || "", d.contratada.crcRt ? `Contador · ${d.contratada.crcRt}` : ""].filter(Boolean),
  };
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

/** Só as seções que fazem sentido guardar por empresa (nada do escritório nem das regras). */
function extrairCadastro(d: ContratoDados): ContratoParcial {
  return {
    contratante: d.contratante,
    objeto: d.objeto,
    honorarios: {
      valorMensal: d.honorarios.valorMensal,
      vencimentoDia: d.honorarios.vencimentoDia,
      faturamentoLimite: d.honorarios.faturamentoLimite,
      valorFuncAdicional: d.honorarios.valorFuncAdicional,
      meioPagamento: d.honorarios.meioPagamento,
      competenciaReferencia: d.honorarios.competenciaReferencia,
      primeiraCobranca: d.honorarios.primeiraCobranca,
      decimoTerceiro: d.honorarios.decimoTerceiro,
      faixaAdicionalValor: d.honorarios.faixaAdicionalValor,
      faixaPasso: d.honorarios.faixaPasso,
    },
    prazos: { diaVariaveisFolha: d.prazos.diaVariaveisFolha },
    vigencia: { dataInicio: d.vigencia.dataInicio, foro: d.vigencia.foro },
    assinatura: { cidade: d.assinatura.cidade },
  };
}

/** Só o que é do escritório: contratada, regras e prazos-padrão (nunca dados de cliente). */
function extrairPadroes(d: ContratoDados): ContratoParcial {
  const h = d.honorarios;
  const v = d.vigencia;
  return {
    contratada: d.contratada,
    objeto: { balancetes: d.objeto.balancetes, funcionariosIncluidos: d.objeto.funcionariosIncluidos },
    honorarios: {
      vencimentoDia: h.vencimentoDia,
      valorFuncAdicional: h.valorFuncAdicional,
      decimoTerceiro: h.decimoTerceiro,
      decimoParcela1: h.decimoParcela1,
      decimoParcela2: h.decimoParcela2,
      competenciaReferencia: h.competenciaReferencia,
      meioPagamento: h.meioPagamento,
      multaPct: h.multaPct,
      jurosPct: h.jurosPct,
      retroativoPct: h.retroativoPct,
      retroativoDias: h.retroativoDias,
      inadimplenciaDias: h.inadimplenciaDias,
      recalculoGuiaValor: h.recalculoGuiaValor,
      faixaAdicionalValor: h.faixaAdicionalValor,
      faixaPasso: h.faixaPasso,
      reajusteIndice: h.reajusteIndice,
    },
    prazos: d.prazos,
    vigencia: {
      avisoPrevioDias: v.avisoPrevioDias,
      correcaoDias: v.correcaoDias,
      multaAvisoMensalidades: v.multaAvisoMensalidades,
      multaInfracaoMensalidades: v.multaInfracaoMensalidades,
    },
  };
}

function usePadroesEscritorio() {
  return useQuery({ queryKey: ["admin-contratos", "padroes"], queryFn: () => api.admin.contratos.padroes() });
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------
function ListaContratos({
  onNovo,
  onNovoRapido,
  onAbrir,
  onAditivo,
}: {
  onNovo: () => void;
  onNovoRapido: () => void;
  onAbrir: (id: string) => void;
  onAditivo: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const lista = useQuery({ queryKey: ["admin-contratos"], queryFn: () => api.admin.contratos.list() });
  const config = useQuery({ queryKey: ["admin-contratos", "config"], queryFn: () => api.admin.contratos.config() });

  const excluir = useMutation({
    mutationFn: (id: string) => api.admin.contratos.remove(id),
    onSuccess: () => {
      toast.success("Contrato excluído.");
      queryClient.invalidateQueries({ queryKey: ["admin-contratos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sincronizar = useMutation({
    mutationFn: (id: string) => api.admin.contratos.sincronizar(id),
    onSuccess: (c) => {
      toast.success(c.status === "assinado" ? "Contrato assinado! Via final gravada no portal." : `Situação na ZapSign: ${c.zapsign_status || c.status}`);
      queryClient.invalidateQueries({ queryKey: ["admin-contratos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function abrirPdf(c: ContratoResumo, assinado: boolean) {
    try {
      const blob = await api.admin.contratos.fetchPdf(c.id, assinado);
      abrirBlob(blob, `${c.titulo}${assinado ? " (assinado)" : ""}.pdf`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {config.data ? (
        <Card>
          <CardContent className="pt-4 text-sm space-y-1">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="font-medium">Assinatura eletrônica (ZapSign):</span>
              {config.data.zapsign ? (
                <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
                  configurada{config.data.sandbox ? " · SANDBOX (sem validade jurídica)" : ""}
                </Badge>
              ) : (
                <Badge variant="secondary">não configurada — defina ZAPSIGN_API_TOKEN</Badge>
              )}
              <span className="font-medium ml-2">E-mail (SMTP):</span>
              {config.data.smtp ? (
                <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">configurado</Badge>
              ) : (
                <Badge variant="secondary">não configurado</Badge>
              )}
            </div>
            {config.data.zapsign ? (
              <p className="text-muted-foreground">
                Webhook para a ZapSign avisar quando assinarem (Configurações › Integrações › Webhooks, evento <code>doc_signed</code>):{" "}
                {config.data.webhook_url ? (
                  <code className="break-all">{config.data.webhook_url}</code>
                ) : (
                  <span>defina ZAPSIGN_WEBHOOK_SECRET e PUBLIC_APP_URL para gerar a URL. Sem webhook, use “Atualizar” na lista.</span>
                )}
              </p>
            ) : (
              <p className="text-muted-foreground">Sem a API, o caminho é: salvar o contrato, baixar o PDF e subir manualmente em zapsign.com.br.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{lista.data ? `${lista.data.length} contrato(s)` : lista.isLoading ? "Carregando…" : ""}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onNovo}>
            <Plus className="h-4 w-4 mr-1" /> Contrato em branco
          </Button>
          <Button onClick={onNovoRapido}>
            <Zap className="h-4 w-4 mr-1" /> Novo contrato rápido
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Atualizado</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.data?.length ? (
                lista.data.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.company_name || "—"}</TableCell>
                    <TableCell className="max-w-[320px] truncate" title={c.titulo}>
                      {c.tipo === "aditivo" ? <Badge className="mr-2 bg-sky-100 text-sky-900 hover:bg-sky-100">Aditivo {c.aditivo_numero}</Badge> : null}
                      {c.titulo}
                    </TableCell>
                    <TableCell>
                      <StatusBadge s={c.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDataHora(c.updated_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => onAbrir(c.id)}>
                          Abrir
                        </Button>
                        {c.tem_pdf ? (
                          <Button size="sm" variant="ghost" title="PDF gerado" onClick={() => abrirPdf(c, false)}>
                            <Download className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {c.tem_pdf_assinado ? (
                          <Button size="sm" variant="ghost" title="PDF assinado" onClick={() => abrirPdf(c, true)}>
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          </Button>
                        ) : null}
                        {c.tipo === "contrato" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            title={c.onboarding_id ? "Ver o onboarding deste contrato" : "Criar onboarding deste contrato"}
                            onClick={() => navigate(c.onboarding_id ? "/admin/onboarding" : `/admin/onboarding?contrato=${c.id}`)}
                          >
                            <ClipboardList className={`h-4 w-4 ${c.onboarding_id ? "text-emerald-600" : ""}`} />
                          </Button>
                        ) : null}
                        {c.status === "assinado" ? (
                          <Button size="sm" variant="ghost" title="Criar aditivo" onClick={() => onAditivo(c.contrato_pai_id || c.id)}>
                            <FilePlus2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {c.zapsign_token && c.status !== "assinado" ? (
                          <Button size="sm" variant="ghost" title="Consultar a ZapSign" disabled={sincronizar.isPending} onClick={() => sincronizar.mutate(c.id)}>
                            <RefreshCw className={`h-4 w-4 ${sincronizar.isPending ? "animate-spin" : ""}`} />
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Excluir"
                          onClick={() => {
                            if (window.confirm(`Excluir o contrato "${c.titulo}"? O PDF some do portal do cliente.`)) excluir.mutate(c.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                    {lista.isLoading ? "Carregando…" : "Nenhum contrato ainda. Clique em “Novo contrato rápido”."}
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
function Editor({
  id,
  aditivoDe,
  propostaId,
  onVoltar,
  onAbrir,
  onAditivo,
}: {
  id: string | null;
  /** Proposta de origem: o contrato novo nasce com o cadastro dela (e guarda o vínculo). */
  propostaId?: string;
  /** Id de um contrato assinado: abre o editor já como aditivo novo desse contrato. */
  aditivoDe?: string;
  onVoltar: () => void;
  onAbrir: (id: string) => void;
  onAditivo: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const empresas = useAdminCompanies();
  const config = useQuery({ queryKey: ["admin-contratos", "config"], queryFn: () => api.admin.contratos.config() });
  const tabela = useQuery({ queryKey: ["admin-contratos", "tabela"], queryFn: () => api.admin.contratos.tabela(), retry: false });
  const padroes = usePadroesEscritorio();
  const presets = usePresets();
  const existente = useQuery({
    queryKey: ["admin-contratos", id],
    queryFn: () => api.admin.contratos.get(id as string),
    enabled: Boolean(id),
  });
  const condicoes = useQuery({
    queryKey: ["admin-contratos", "condicoes", aditivoDe],
    queryFn: () => api.admin.contratos.condicoes(aditivoDe as string),
    enabled: Boolean(aditivoDe) && !id,
    retry: false,
    // Cada abertura parte das condições vigentes de agora (um aditivo assinado entre uma abertura e outra muda a base).
    staleTime: 0,
    gcTime: 0,
  });

  const [contratoId, setContratoId] = useState<string | null>(id);
  const [companyId, setCompanyId] = useState<string>("");
  const [dados, setDados] = useState<ContratoDados>(() => dadosPadrao());
  const [aditivo, setAditivo] = useState<AditivoMeta | null>(null);
  const [padroesAplicados, setPadroesAplicados] = useState(false);
  const [propostaAplicada, setPropostaAplicada] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<ContratoDetalhe | null>(null);
  const [gerando, setGerando] = useState(false);
  const [dialogAssinatura, setDialogAssinatura] = useState(false);
  const [mostrarIa, setMostrarIa] = useState(false);
  const [perfilSel, setPerfilSel] = useState("");

  // Contrato novo nasce com os padrões do escritório; contrato existente carrega o que foi salvo.
  useEffect(() => {
    if (id || aditivoDe || padroesAplicados || !padroes.data) return;
    setDados((d) => mesclarDados(d, padroes.data.padroes));
    setPadroesAplicados(true);
  }, [id, aditivoDe, padroes.data, padroesAplicados]);

  // Contrato nascido de uma proposta: o cadastro dela entra DEPOIS dos padrões do escritório,
  // para o que o cliente já disse prevalecer sobre o padrão genérico.
  const daProposta = useQuery({
    queryKey: ["admin-propostas", "dados-contrato", propostaId],
    queryFn: () => api.admin.propostas.dadosContrato(propostaId as string),
    enabled: Boolean(propostaId) && !id && !aditivoDe,
  });
  useEffect(() => {
    if (!daProposta.data || !padroesAplicados || propostaAplicada === daProposta.data.proposta_id) return;
    setDados((d) => mesclarDados(d, daProposta.data.dados as never));
    if (daProposta.data.company_id) setCompanyId(daProposta.data.company_id);
    setPropostaAplicada(daProposta.data.proposta_id);
  }, [daProposta.data, padroesAplicados, propostaAplicada]);

  useEffect(() => {
    if (!existente.data) return;
    setDetalhe(existente.data);
    setCompanyId(existente.data.company_id || "");
    setContratoId(existente.data.id);
    if (existente.data.tipo === "aditivo") {
      const ad = normalizarAditivo(existente.data.dados);
      setAditivo({ numero: ad.numero, paiId: ad.paiId, paiTitulo: ad.paiTitulo, paiAssinadoEm: ad.paiAssinadoEm, base: ad.base, efeito: ad.efeito, motivo: ad.motivo });
      setDados(dadosDoAditivo(ad));
    } else {
      setAditivo(null);
      setDados(normalizarDados(existente.data.dados));
    }
  }, [existente.data]);

  useEffect(() => {
    if (!condicoes.data) return;
    const c = condicoes.data;
    const base = normalizarDados(c.base);
    setAditivo({ numero: c.proximo_numero, paiId: c.pai.id, paiTitulo: c.pai.titulo, paiAssinadoEm: c.pai.assinado_em || "", base, efeito: "", motivo: "" });
    setDados(base);
    setCompanyId(c.pai.company_id || "");
    if (c.aditivo_em_aberto) toast.warning("Já existe um aditivo deste contrato ainda não assinado. Confira a lista antes de criar outro.");
  }, [condicoes.data]);

  const adObj: AditivoDados | null = useMemo(
    () => (aditivo ? { versao: 1, ...aditivo, novo: diffParcial(aditivo.base, dados) } : null),
    [aditivo, dados]
  );
  const blocos = useMemo(() => (adObj ? montarAditivo(adObj) : montarContrato(dados)), [adObj, dados]);
  const pendentes = useMemo(() => (adObj ? pendentesAditivo(adObj) : camposPendentes(dados)), [adObj, dados]);
  const titulo = adObj ? tituloAditivo(adObj) : tituloContrato(dados);
  const meta = useMemo(() => metaPdf(dados, titulo), [dados, titulo]);
  const bloqueado = detalhe?.status === "assinado";
  const enviado = detalhe?.status === "enviado";
  const ehAditivo = Boolean(aditivo);

  const set: SetSecao = (sec, patch) => setDados((d) => ({ ...d, [sec]: { ...d[sec], ...patch } }));

  async function escolherEmpresa(cid: string) {
    setCompanyId(cid);
    const e = empresas.data?.find((x) => x.id === cid);
    if (!e) return;
    let cadastro: ContratoParcial | null = null;
    try {
      cadastro = (await api.admin.contratos.cadastro(cid)).dados;
    } catch {
      /* sem cadastro: cai no básico do portal */
    }
    let novo = cadastro
      ? mesclarDados(dados, cadastro)
      : mesclarDados(dados, {
          contratante: { razao: e.name, cnpj: maskCNPJ(e.cnpj.replace(/\D/g, "")), email: e.contact_email || "", telefone: e.phone || "" },
        });
    // Sem valor negociado, o perfil que bate com a classificação da empresa preenche valor e regras.
    const sugerido = !novo.honorarios.valorMensal ? sugerirPreset(presets.data, novo.objeto) : null;
    if (sugerido) {
      novo = mesclarDados(novo, sugerido.dados);
      setPerfilSel(sugerido.id);
    }
    setDados(novo);
    toast.success(
      `${cadastro ? (cadastroCompleto(cadastro) ? "Cadastro prévio aplicado." : "Cadastro prévio aplicado (ainda incompleto).") : "Dados básicos da empresa aplicados."}${sugerido ? ` Perfil sugerido: ${sugerido.nome}.` : ""}`
    );
  }

  function aplicarPerfil(pid: string) {
    setPerfilSel(pid);
    const p = presets.data?.find((x) => x.id === pid);
    if (!p) return;
    setDados((d) => mesclarDados(d, p.dados));
    toast.success(`Perfil “${p.nome}” aplicado.`);
  }

  function gerarPdf() {
    return gerarContratoPdf(blocos, meta, null);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      setGerando(true);
      try {
        const pdf = gerarPdf();
        const body = {
          company_id: companyId || null,
          titulo,
          dados: adObj ?? dados,
          pdf_base64: enviado ? undefined : pdfParaBase64(pdf),
          ...(adObj ? { tipo: "aditivo" as const, contrato_pai_id: adObj.paiId } : {}),
          ...(!contratoId && propostaId ? { proposta_id: propostaId } : {}),
        };
        return contratoId ? api.admin.contratos.update(contratoId, body) : api.admin.contratos.create(body);
      } finally {
        setGerando(false);
      }
    },
    onSuccess: (c) => {
      setDetalhe(c);
      setContratoId(c.id);
      toast.success(companyId ? `${ehAditivo ? "Aditivo" : "Contrato"} salvo e disponível no portal do cliente (Documentos).` : `${ehAditivo ? "Aditivo" : "Contrato"} salvo.`);
      queryClient.invalidateQueries({ queryKey: ["admin-contratos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicar = useMutation({
    mutationFn: () =>
      api.admin.contratos.create({
        company_id: companyId || null,
        titulo,
        dados: { ...dados, assinatura: { ...dados.assinatura, data: "" } },
      }),
    onSuccess: (c) => {
      toast.success("Cópia criada como rascunho.");
      queryClient.invalidateQueries({ queryKey: ["admin-contratos"] });
      onAbrir(c.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarCadastro = useMutation({
    mutationFn: () => api.admin.contratos.salvarCadastro(companyId, extrairCadastro(dados)),
    onSuccess: () => {
      toast.success("Cadastro prévio da empresa atualizado com os dados deste contrato.");
      queryClient.invalidateQueries({ queryKey: ["admin-contratos", "cadastros"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sincronizar = useMutation({
    mutationFn: () => api.admin.contratos.sincronizar(contratoId as string),
    onSuccess: (c) => {
      setDetalhe(c);
      toast.success(c.status === "assinado" ? "Assinado! Via final gravada no portal." : `Situação na ZapSign: ${c.zapsign_status || c.status}`);
      queryClient.invalidateQueries({ queryKey: ["admin-contratos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ro = bloqueado;

  if (aditivoDe && !id && condicoes.isError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onVoltar}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Lista
        </Button>
        <Card className="border-amber-300">
          <CardContent className="pt-4 text-sm">{(condicoes.error as Error).message}</CardContent>
        </Card>
      </div>
    );
  }

  const seletorEmpresa = (
    <Campo label="Empresa do portal (aplica o cadastro prévio, se existir)">
      <Select value={companyId} onValueChange={escolherEmpresa} disabled={ro}>
        <SelectTrigger>
          <SelectValue placeholder="Selecionar empresa…" />
        </SelectTrigger>
        <SelectContent>
          {empresas.data?.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name} — {maskCNPJ(e.cnpj.replace(/\D/g, ""))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Campo>
  );

  const empresaNome = empresas.data?.find((e) => e.id === companyId)?.name || dados.contratante.razao;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost" size="sm" onClick={onVoltar}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Lista
        </Button>
        {detalhe ? <StatusBadge s={detalhe.status} /> : <Badge variant="secondary">Não salvo</Badge>}
        {ehAditivo ? <Badge className="bg-sky-100 text-sky-900 hover:bg-sky-100">Aditivo nº {aditivo?.numero}</Badge> : null}
        <div className="flex-1" />
        {!ro ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarIa((v) => !v)}
            disabled={!config.data?.ia}
            title={config.data?.ia ? "Conversar com o assistente de IA" : "Configure a chave da Claude (ANTHROPIC_API_KEY ou Configurações › IA)"}
          >
            <Sparkles className="h-4 w-4 mr-1" /> Assistente IA
          </Button>
        ) : null}
        {contratoId && !ehAditivo ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(detalhe?.onboarding_id ? "/admin/onboarding" : `/admin/onboarding?contrato=${contratoId}`)}
            title="Primeiros passos do cliente: documentos, prazos e canais"
          >
            <ClipboardList className="h-4 w-4 mr-1" /> {detalhe?.onboarding_id ? "Ver onboarding" : "Criar onboarding"}
          </Button>
        ) : null}
        {contratoId && !ehAditivo ? (
          <Button variant="outline" size="sm" onClick={() => duplicar.mutate()} disabled={duplicar.isPending} title="Cria um rascunho novo com os mesmos dados">
            <CopyPlus className="h-4 w-4 mr-1" /> Duplicar
          </Button>
        ) : null}
        {bloqueado && detalhe ? (
          <Button variant="outline" size="sm" onClick={() => onAditivo(detalhe.contrato_pai_id || detalhe.id)}>
            <FilePlus2 className="h-4 w-4 mr-1" /> Criar aditivo
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
        <Button variant="outline" size="sm" onClick={() => gerarPdf().save(`${titulo}.pdf`)}>
          <Download className="h-4 w-4 mr-1" /> Baixar PDF
        </Button>
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending || gerando || ro}>
          {salvar.isPending || gerando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          {contratoId ? "Salvar alterações" : "Salvar no portal do cliente"}
        </Button>
        {contratoId && !ro ? (
          detalhe?.zapsign_token ? (
            <Button size="sm" variant="outline" onClick={() => sincronizar.mutate()} disabled={sincronizar.isPending}>
              <RefreshCw className={`h-4 w-4 mr-1 ${sincronizar.isPending ? "animate-spin" : ""}`} /> Atualizar status
            </Button>
          ) : (
            <Button size="sm" variant="default" onClick={() => setDialogAssinatura(true)} disabled={!config.data?.zapsign || !detalhe?.tem_pdf}>
              <FileSignature className="h-4 w-4 mr-1" /> Enviar para assinatura
            </Button>
          )
        ) : null}
      </div>

      {bloqueado ? (
        <Card className="border-emerald-300 print:hidden">
          <CardContent className="pt-4 text-sm">
            {ehAditivo ? "Aditivo" : "Contrato"} assinado em {fmtDataHora(detalhe?.assinado_em)}. Não pode mais ser alterado — para mudar condições, use <b>Criar aditivo</b>.
          </CardContent>
        </Card>
      ) : null}
      {enviado ? (
        <Card className="border-amber-300 print:hidden">
          <CardContent className="pt-4 text-sm">
            Enviado para assinatura em {fmtDataHora(detalhe?.zapsign_enviado_em)}. O PDF está travado na ZapSign; alterações aqui só mudam os dados guardados.
          </CardContent>
        </Card>
      ) : null}
      {detalhe?.zapsign_signers?.length ? <SignersCard signers={detalhe.zapsign_signers} /> : null}

      <div className="grid gap-4 xl:grid-cols-[460px_1fr]">
        <div className="space-y-4 print:hidden">
          {mostrarIa && !ro ? (
            <AssistenteContrato
              modo={ehAditivo ? "aditivo" : "contrato"}
              dados={dados}
              onAlterar={(fn) => setDados(fn)}
              presets={presets.data || []}
              empresaNome={empresaNome}
              desabilitado={ro}
            />
          ) : null}
          {pendentes.length ? (
            <Card className="border-amber-300">
              <CardContent className="pt-4 text-sm">
                <b>{pendentes.length} pendência(s)</b>
                {ehAditivo ? ": " : " em amarelo no contrato: "}
                {pendentes.join(", ")}.
              </CardContent>
            </Card>
          ) : null}

          {ehAditivo && aditivo ? (
            <>
              <PainelAditivo meta={aditivo} dados={dados} onMeta={(p) => setAditivo((a) => (a ? { ...a, ...p } : a))} onDados={(fn) => setDados(fn)} ro={ro} />
              <SecaoContratante d={dados} set={set} ro={ro} />
              <SecaoHonorarios d={dados} set={set} ro={ro} />
              <SecaoRegras d={dados} set={set} ro={ro} />
              <SecaoPrazosVigencia d={dados} set={set} ro={ro} semTestemunhas />
            </>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Perfil de honorário</CardTitle>
                  <CardDescription>Aplica valor e regras de uma situação pronta; os campos continuam editáveis.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Select value={perfilSel} onValueChange={aplicarPerfil} disabled={ro}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolher perfil…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(presets.data || [])
                        .filter((p) => p.ativo)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nome}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
              <SecaoModeloFaixa d={dados} set={set} ro={ro} padroesTabela={tabela.data?.padroes} />
              <SecaoContratante
                d={dados}
                set={set}
                ro={ro}
                cabecalho={
                  <div className="space-y-2">
                    {seletorEmpresa}
                    {companyId && !ro ? (
                      <Button size="sm" variant="outline" onClick={() => salvarCadastro.mutate()} disabled={salvarCadastro.isPending}>
                        <Save className="h-4 w-4 mr-1" /> Guardar estes dados como cadastro prévio da empresa
                      </Button>
                    ) : null}
                  </div>
                }
              />
              <SecaoContratada d={dados} set={set} ro={ro} />
              <SecaoHonorarios d={dados} set={set} ro={ro} />
              <SecaoPrazosVigencia d={dados} set={set} ro={ro} />
              <SecaoRegras d={dados} set={set} ro={ro} />
            </>
          )}
        </div>

        <div className="min-w-0">
          <div className="xl:sticky xl:top-4 max-h-[calc(100vh-2rem)] overflow-auto rounded-md bg-slate-200/60 p-3 print:p-0 print:bg-transparent print:max-h-none print:overflow-visible">
            <ContratoPreview blocos={blocos} rodapeEsquerda={meta.rodapeEsquerda} rodapeDireita={meta.rodapeDireita} />
          </div>
        </div>
      </div>

      {contratoId ? (
        <DialogAssinatura
          aberto={dialogAssinatura}
          onFechar={() => setDialogAssinatura(false)}
          contratoId={contratoId}
          dados={dados}
          onEnviado={(c) => {
            setDetalhe(c);
            queryClient.invalidateQueries({ queryKey: ["admin-contratos"] });
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cadastro prévio por empresa
// ---------------------------------------------------------------------------
function CadastroPrevio() {
  const queryClient = useQueryClient();
  const lista = useQuery({ queryKey: ["admin-contratos", "cadastros"], queryFn: () => api.admin.contratos.cadastros() });
  const tabela = useQuery({ queryKey: ["admin-contratos", "tabela"], queryFn: () => api.admin.contratos.tabela(), retry: false });
  const padroes = usePadroesEscritorio();
  const [companyId, setCompanyId] = useState<string>("");
  const [dados, setDados] = useState<ContratoDados>(() => dadosPadrao());
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState("");

  const set: SetSecao = (sec, patch) => setDados((d) => ({ ...d, [sec]: { ...d[sec], ...patch } }));

  async function abrir(cid: string) {
    setCompanyId(cid);
    setCarregando(true);
    try {
      const base = mesclarDados(dadosPadrao(), padroes.data?.padroes);
      const r = await api.admin.contratos.cadastro(cid);
      const emp = lista.data?.find((x) => x.company_id === cid);
      const basico: ContratoParcial = emp ? { contratante: { razao: emp.company_name, cnpj: maskCNPJ(emp.cnpj.replace(/\D/g, "")) } } : {};
      setDados(mesclarDados(mesclarDados(base, basico), r.dados));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  const salvar = useMutation({
    mutationFn: () => api.admin.contratos.salvarCadastro(companyId, extrairCadastro(dados)),
    onSuccess: () => {
      toast.success("Cadastro prévio salvo. Ao criar um contrato para esta empresa, estes dados entram sozinhos.");
      queryClient.invalidateQueries({ queryKey: ["admin-contratos", "cadastros"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtrados = (lista.data || []).filter((c) => !busca.trim() || `${c.company_name} ${c.cnpj}`.toLowerCase().includes(busca.toLowerCase()));
  const completo = cadastroCompleto(extrairCadastro(dados));

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Card className="self-start">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Empresas</CardTitle>
          <CardDescription>Preencha a ficha uma vez; o contrato nasce pronto.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Buscar por nome ou CNPJ…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="max-h-[70vh] overflow-auto divide-y rounded-md border">
            {filtrados.map((c) => (
              <button
                key={c.company_id}
                type="button"
                onClick={() => abrir(c.company_id)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${c.company_id === companyId ? "bg-muted" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{c.company_name}</span>
                  {c.completo ? (
                    <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">completo</Badge>
                  ) : c.tem_cadastro ? (
                    <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">incompleto</Badge>
                  ) : (
                    <Badge variant="secondary">sem ficha</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{maskCNPJ(c.cnpj.replace(/\D/g, ""))}</div>
              </button>
            ))}
            {!filtrados.length ? <div className="px-3 py-6 text-sm text-muted-foreground text-center">{lista.isLoading ? "Carregando…" : "Nenhuma empresa."}</div> : null}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {!companyId ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">Escolha uma empresa à esquerda para preencher a ficha de contrato.</CardContent>
          </Card>
        ) : carregando ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">Carregando…</CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {completo ? (
                <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Ficha completa para gerar contrato</Badge>
              ) : (
                <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Faltam dados essenciais (razão, CNPJ, endereço, representante, CPF)</Badge>
              )}
              <div className="flex-1" />
              <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
                {salvar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Salvar ficha
              </Button>
            </div>
            <SecaoModeloFaixa d={dados} set={set} padroesTabela={tabela.data?.padroes} />
            <SecaoContratante d={dados} set={set} />
            <SecaoHonorarios d={dados} set={set} titulo="Valores negociados com esta empresa" />
            <SecaoPrazosVigencia d={dados} set={set} comAssinatura={false} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Padrões do escritório
// ---------------------------------------------------------------------------
function PadroesEscritorio() {
  const queryClient = useQueryClient();
  const padroes = usePadroesEscritorio();
  const [dados, setDados] = useState<ContratoDados>(() => dadosPadrao());
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    if (carregado || !padroes.data) return;
    setDados(mesclarDados(dadosPadrao(), padroes.data.padroes));
    setCarregado(true);
  }, [padroes.data, carregado]);

  const set: SetSecao = (sec, patch) => setDados((d) => ({ ...d, [sec]: { ...d[sec], ...patch } }));

  const salvar = useMutation({
    mutationFn: () => api.admin.contratos.salvarPadroes(extrairPadroes(dados)),
    onSuccess: () => {
      toast.success("Padrões salvos. Valem para todo contrato novo; os já criados não mudam.");
      queryClient.invalidateQueries({ queryKey: ["admin-contratos", "padroes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Identificação da NESCON, regras de cobrança e prazos-padrão. Entram em todo contrato novo e podem ser ajustados contrato a contrato.
        </p>
        <div className="flex-1" />
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending || !carregado}>
          {salvar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Salvar padrões
        </Button>
      </div>
      <SecaoContratada d={dados} set={set} />
      <SecaoHonorarios d={dados} set={set} titulo="Honorários-padrão (valor e faturamento ficam por empresa)" />
      <SecaoRegras d={dados} set={set} />
      <SecaoPrazosVigencia d={dados} set={set} comAssinatura={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------
function SignersCard({ signers }: { signers: ContratoSigner[] }) {
  return (
    <Card className="print:hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Signatários na ZapSign</CardTitle>
        <CardDescription>Cada um recebe o link por e-mail (e WhatsApp, se marcado). O link também pode ser copiado daqui.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          {signers.map((s, i) => (
            <div key={s.token || i} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{s.nome}</span>
              {s.qualificacao ? <span className="text-muted-foreground">({s.qualificacao})</span> : null}
              <span className="text-muted-foreground">{s.email || s.telefone || ""}</span>
              <Badge variant={s.status === "signed" ? "default" : "secondary"}>
                {s.status === "signed" ? `assinou ${fmtDataHora(s.signed_at)}` : s.status === "link-opened" ? "abriu o link" : "aguardando"}
              </Badge>
              {s.sign_url && s.status !== "signed" ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard?.writeText(s.sign_url as string);
                      toast.success("Link copiado.");
                    }}
                  >
                    <Copy className="h-4 w-4 mr-1" /> Copiar link
                  </Button>
                  <a className="text-primary inline-flex items-center gap-1" href={s.sign_url} target="_blank" rel="noreferrer">
                    abrir <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DialogAssinatura({
  aberto,
  onFechar,
  contratoId,
  dados,
  onEnviado,
}: {
  aberto: boolean;
  onFechar: () => void;
  contratoId: string;
  dados: ContratoDados;
  onEnviado: (c: ContratoDetalhe) => void;
}) {
  const [signers, setSigners] = useState<ContratoSigner[]>([]);
  const [whatsapp, setWhatsapp] = useState(false);
  const [prazo, setPrazo] = useState(15);

  useEffect(() => {
    if (!aberto) return;
    setSigners([
      { nome: dados.contratante.repNome, email: dados.contratante.email, telefone: dados.contratante.telefone, qualificacao: "Contratante" },
      { nome: dados.contratada.repNome || dados.contratada.respTecnico, email: dados.contratada.email, telefone: dados.contratada.telefone, qualificacao: "Contratada" },
    ]);
  }, [aberto, dados]);

  const enviar = useMutation({
    mutationFn: () =>
      api.admin.contratos.enviarAssinatura(contratoId, {
        signatarios: signers.filter((s) => s.nome.trim()),
        whatsapp,
        prazo_dias: prazo,
      }),
    onSuccess: (c) => {
      toast.success("Enviado! Cada signatário recebe o link da ZapSign por e-mail.");
      onEnviado(c);
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function upd(i: number, patch: Partial<ContratoSigner>) {
    setSigners((arr) => arr.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Enviar para assinatura eletrônica</DialogTitle>
          <DialogDescription>
            O PDF salvo vai para a ZapSign, que envia o link de assinatura a cada pessoa abaixo. Assinatura eletrônica com validade jurídica (Lei
            14.063/2020); o portal recebe a via assinada automaticamente pelo webhook.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {signers.map((s, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 border rounded-md p-3">
              <Campo label={`Signatário ${i + 1} — nome`} className="col-span-2">
                <Input value={s.nome} onChange={(e) => upd(i, { nome: e.target.value })} />
              </Campo>
              <Campo label="E-mail">
                <Input type="email" value={s.email || ""} onChange={(e) => upd(i, { email: e.target.value })} />
              </Campo>
              <Campo label="WhatsApp (DDD + número)">
                <Input value={s.telefone || ""} onChange={(e) => upd(i, { telefone: e.target.value })} />
              </Campo>
              <Campo label="Qualificação" className="col-span-2">
                <Input value={s.qualificacao || ""} onChange={(e) => upd(i, { qualificacao: e.target.value })} />
              </Campo>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setSigners((a) => [...a, { nome: "", email: "", telefone: "", qualificacao: "Testemunha" }])}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar signatário (ex.: testemunha)
          </Button>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={whatsapp} onCheckedChange={(v) => setWhatsapp(Boolean(v))} /> Também enviar por WhatsApp (cobrado pela ZapSign)
            </label>
            <Campo label="Prazo para assinar (dias)">
              <Input type="number" min="1" max="90" className="w-24" value={prazo} onChange={(e) => setPrazo(Math.max(1, Math.min(90, num(e.target.value, 15))))} />
            </Campo>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => enviar.mutate()} disabled={enviar.isPending || !signers.some((s) => s.nome.trim())}>
            {enviar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
export default function ContratosPage() {
  // ?proposta=ID (botão "Gerar contrato" na proposta) abre o editor já com o cadastro dela.
  const [params, setParams] = useSearchParams();
  const daPropostaId = params.get("proposta") || undefined;
  const [modo, setModo] = useState<{ tela: "lista" } | { tela: "editor"; id: string | null; aditivoDe?: string; propostaId?: string }>(
    daPropostaId ? { tela: "editor", id: null, propostaId: daPropostaId } : { tela: "lista" }
  );
  const [aba, setAba] = useState("contratos");
  const [rapido, setRapido] = useState(false);
  return (
    <AdminLayout
      title="Contratos"
      description="Contratos de prestação de serviços: perfis de honorário, cadastro prévio por empresa, assistente de IA, aditivos, prévia, impressão, portal do cliente e assinatura eletrônica."
    >
      {modo.tela === "editor" ? (
        <Editor
          key={modo.id || modo.aditivoDe || modo.propostaId || "novo"}
          id={modo.id}
          aditivoDe={modo.aditivoDe}
          propostaId={modo.propostaId}
          onVoltar={() => {
            if (params.get("proposta")) setParams({}, { replace: true });
            setModo({ tela: "lista" });
          }}
          onAbrir={(id) => setModo({ tela: "editor", id })}
          onAditivo={(id) => setModo({ tela: "editor", id: null, aditivoDe: id })}
        />
      ) : (
        <Tabs value={aba} onValueChange={setAba}>
          <TabsList className="print:hidden">
            <TabsTrigger value="contratos">Contratos</TabsTrigger>
            <TabsTrigger value="perfis">Perfis de honorário</TabsTrigger>
            <TabsTrigger value="cadastro">Cadastro prévio</TabsTrigger>
            <TabsTrigger value="padroes">Padrões do escritório</TabsTrigger>
          </TabsList>
          <TabsContent value="contratos" className="mt-4">
            <ListaContratos
              onNovo={() => setModo({ tela: "editor", id: null })}
              onNovoRapido={() => setRapido(true)}
              onAbrir={(id) => setModo({ tela: "editor", id })}
              onAditivo={(id) => setModo({ tela: "editor", id: null, aditivoDe: id })}
            />
          </TabsContent>
          <TabsContent value="perfis" className="mt-4">
            <AbaPerfis />
          </TabsContent>
          <TabsContent value="cadastro" className="mt-4">
            <CadastroPrevio />
          </TabsContent>
          <TabsContent value="padroes" className="mt-4">
            <PadroesEscritorio />
          </TabsContent>
        </Tabs>
      )}
      <NovoContratoRapido
        aberto={rapido}
        onFechar={() => setRapido(false)}
        onCriado={(id) => {
          setRapido(false);
          setModo({ tela: "editor", id });
        }}
      />
    </AdminLayout>
  );
}
