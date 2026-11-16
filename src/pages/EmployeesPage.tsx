import { type ChangeEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Pencil, Trash2, Users, Save, X, Upload, UserMinus, UserCheck, ClipboardCheck, Clock } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { maskCPF, maskPIS } from "@/lib/masks";
import { type EmployeeJornada } from "@/lib/api";
import {
  ESCALAS_FUNCIONARIO,
  FOLGAS_FUNCIONARIO,
  dataBR,
  hojeISO,
  proximoProblema,
  resumoJornada,
  situacaoJornada,
  type NivelJornada,
} from "@/lib/jornadaFuncionario";

type FormJornada = {
  carga: string;
  escala: string;
  folga: string;
  entrada: string;
  saida: string;
  hiper: boolean;
};
const JORNADA_VAZIA: FormJornada = { carga: "", escala: "", folga: "", entrada: "", saida: "", hiper: false };

function jornadaParaApi(j: FormJornada): EmployeeJornada {
  return {
    carga_semanal: j.carga.trim() ? j.carga.trim() : null,
    escala: j.escala || null,
    folga: j.folga || null,
    horario_entrada: j.entrada || null,
    horario_saida: j.saida || null,
    hipersuficiente: j.hiper,
  };
}

const COR_NIVEL: Record<NivelJornada, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  atencao: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  fora: "border-destructive/40 bg-destructive/10 text-destructive",
  sem_dado: "border-border bg-muted text-muted-foreground",
};

const campoSelect =
  "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
import {
  type EmployeeImportRow,
  describeImportResult,
  parseEmployeeImportFile,
  toImportPayload,
} from "@/lib/parseEmployeeSpreadsheet";

const EmployeesPage = () => {
  const navigate = useNavigate();
  const { company } = useAuth();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [pis, setPis] = useState("");
  const [jornada, setJornada] = useState<FormJornada>(JORNADA_VAZIA);
  const hoje = hojeISO();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    fileCnpj: string;
    rows: EmployeeImportRow[];
    dismissed: EmployeeImportRow[];
    skippedDismissed: number;
    withoutCpf: number;
  } | null>(null);

  const [aba, setAba] = useState<"ativos" | "inativos">("ativos");

  const { data: employees, isLoading } = useQuery({
    queryKey: ["employees", company?.id],
    queryFn: () => api.employees.list({ companyId: company!.id }),
    enabled: !!company,
  });

  // Quem saiu fica numa lista à parte: some das telas do dia a dia (advertência,
  // atestado…), mas dá para conferir e reativar se foi engano.
  const { data: inativos, isLoading: loadingInativos } = useQuery({
    queryKey: ["employees", company?.id, "inativos"],
    queryFn: () => api.employees.list({ companyId: company!.id, inativos: true }),
    enabled: !!company,
  });

  const { data: conferencia } = useQuery({
    queryKey: ["employees-conferencia", company?.id],
    queryFn: () => api.employees.conferencia(),
    enabled: !!company,
  });

  const conferirMutation = useMutation({
    mutationFn: () => api.employees.confirmarConferencia(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees-conferencia"] });
      toast.success("Lista conferida. O escritório vê a data da sua conferência.");
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao registrar a conferência"),
  });

  const situacaoMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.employees.update(id, { active }),
    onSuccess: (_r, { active }) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(active ? "Funcionário reativado" : "Funcionário inativado — está na aba Inativos");
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao alterar a situação"),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      api.employees.create({
        company_id: company!.id,
        name: name.trim().toUpperCase(),
        cpf: cpf.trim(),
        pis: pis.trim() || null,
        ...jornadaParaApi(jornada),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setShowAdd(false);
      setName("");
      setCpf("");
      setPis("");
      setJornada(JORNADA_VAZIA);
      toast.success("Funcionário adicionado");
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao adicionar"),
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) =>
      api.employees.update(id, {
        name: name.trim().toUpperCase(),
        cpf: cpf.trim(),
        pis: pis.trim() || null,
        ...jornadaParaApi(jornada),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setEditingId(null);
      setName("");
      setCpf("");
      setPis("");
      setJornada(JORNADA_VAZIA);
      toast.success("Funcionário atualizado");
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao atualizar"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.employees.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Funcionário excluído");
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao excluir"),
  });

  const importMutation = useMutation({
    mutationFn: ({ rows, fileCnpj }: { rows: ReturnType<typeof toImportPayload>; fileCnpj: string }) =>
      api.employees.import(rows, fileCnpj),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setPendingImport(null);
      toast.success(describeImportResult(result));
      if (result.errors.length) {
        toast.warning(`${result.errors.length} linhas com erro foram ignoradas`);
      }
    },
    onError: () => toast.error("Erro ao importar funcionários"),
  });

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = await parseEmployeeImportFile(file);
      if (!parsed?.fileCnpj) {
        toast.error("Não foi possível identificar o CNPJ na planilha");
        return;
      }
      const currentCompanyCnpj = (company?.cnpj || "").replace(/\D/g, "");
      if (!currentCompanyCnpj || parsed.fileCnpj !== currentCompanyCnpj) {
        toast.error("Esta planilha é de outra empresa. Faça login no CNPJ correto para importar.");
        return;
      }

      const { rows, dismissed, skippedDismissed, withoutCpf, fileCnpj } = parsed;
      if (!rows.length && !dismissed.length) {
        toast.error("Planilha sem funcionários válidos para importar");
        return;
      }
      setPendingImport({
        fileName: file.name,
        fileCnpj,
        rows,
        dismissed,
        skippedDismissed,
        withoutCpf,
      });
    } catch {
      toast.error("Não foi possível ler a planilha. Use CSV ou Excel (.xls, .xlsx).");
    } finally {
      event.target.value = "";
    }
  };

  const startEdit = (emp: { id: string; name: string; cpf: string; pis: string | null } & EmployeeJornada) => {
    setEditingId(emp.id);
    setName(emp.name);
    setCpf(emp.cpf);
    setPis(emp.pis || "");
    setJornada({
      carga: emp.carga_semanal != null ? String(Number(emp.carga_semanal)).replace(".", ",") : "",
      escala: emp.escala || "",
      folga: emp.folga || "",
      entrada: emp.horario_entrada || "",
      saida: emp.horario_saida || "",
      hiper: Boolean(emp.hipersuficiente),
    });
    setShowAdd(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowAdd(false);
    setName("");
    setCpf("");
    setPis("");
    setJornada(JORNADA_VAZIA);
  };

  // Resumo da conferência: o que o cliente precisa olhar antes de confirmar a lista.
  const resumo = (() => {
    const lista = employees ?? [];
    let semJornada = 0;
    let foraHoje = 0;
    let foraDepois = 0;
    for (const e of lista) {
      const s = situacaoJornada(e, hoje);
      if (s.nivel === "sem_dado") semJornada++;
      else if (s.nivel === "fora") foraHoje++;
      else if (proximoProblema(e, hoje)?.situacao.nivel === "fora") foraDepois++;
    }
    return { total: lista.length, semJornada, foraHoje, foraDepois };
  })();

  const formatCnpj = (value: string): string =>
    value
      .replace(/\D/g, "")
      .slice(0, 14)
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-foreground">Funcionários</h1>
            <p className="text-xs text-muted-foreground">{company?.name}</p>
          </div>
          {!showAdd && !editingId && (
            <div className="flex gap-2">
              <input
                ref={importInputRef}
                type="file"
                accept=".csv,.xls,.xlsx,.xlsm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleImportFile}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => importInputRef.current?.click()}
                disabled={importMutation.isPending}
              >
                <Upload className="h-4 w-4 mr-1" /> Importar planilha
              </Button>
              <Button size="sm" onClick={() => { setShowAdd(true); setName(""); setCpf(""); setPis(""); setJornada(JORNADA_VAZIA); }}>
                <Plus className="h-4 w-4 mr-1" /> Novo
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-3">
        {!showAdd && !editingId && !isLoading && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Conferência da lista</p>
                  <p className="text-xs text-muted-foreground">
                    Confira se todos que trabalham hoje estão aqui, com a jornada certa. Adicione quem falta,
                    inative quem saiu e exclua cadastro feito por engano.
                    {conferencia?.conferido_em
                      ? ` Última conferência: ${new Date(conferencia.conferido_em).toLocaleDateString("pt-BR")}.`
                      : " A lista ainda não foi conferida."}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-md border px-2 py-1">{resumo.total} ativo(s)</span>
                {resumo.semJornada > 0 && (
                  <span className={`rounded-md border px-2 py-1 ${COR_NIVEL.sem_dado}`}>{resumo.semJornada} sem jornada</span>
                )}
                {resumo.foraHoje > 0 && (
                  <span className={`rounded-md border px-2 py-1 ${COR_NIVEL.fora}`}>{resumo.foraHoje} fora da regra hoje</span>
                )}
                {resumo.foraDepois > 0 && (
                  <span className={`rounded-md border px-2 py-1 ${COR_NIVEL.atencao}`}>
                    {resumo.foraDepois} precisam mudar até a próxima etapa
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={conferirMutation.isPending}
                onClick={() => conferirMutation.mutate()}
              >
                <ClipboardCheck className="h-4 w-4" /> A lista está certa
              </Button>
            </CardContent>
          </Card>
        )}

        {pendingImport && (
          <Card className="border-primary/50">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-medium">
                Arquivo pronto para importar: <span className="text-primary">{pendingImport.fileName}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                CNPJ detectado no arquivo: <strong>{formatCnpj(pendingImport.fileCnpj)}</strong> • A importar:{" "}
                <strong>{pendingImport.rows.length}</strong>
                {pendingImport.skippedDismissed > 0 && (
                  <> • <span className="text-amber-600 dark:text-amber-500">{pendingImport.skippedDismissed} com demissão (inativados se estiverem cadastrados)</span></>
                )}
              </p>
              {pendingImport.withoutCpf > 0 && (
                <p className="text-xs text-muted-foreground">
                  Esta lista não traz CPF: os funcionários são reconhecidos pelo nome. Quem for novo
                  entra com CPF pendente e é completado pela folha do escritório.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  className="gap-2"
                  onClick={() =>
                    importMutation.mutate({ rows: toImportPayload(pendingImport), fileCnpj: pendingImport.fileCnpj })
                  }
                  disabled={importMutation.isPending}
                >
                  <Upload className="h-4 w-4" />
                  {importMutation.isPending ? "Importando..." : "Confirmar importação"}
                </Button>
                <Button variant="outline" onClick={() => setPendingImport(null)} disabled={importMutation.isPending}>
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {(showAdd || editingId) && (
          <Card className="border-primary/50">
            <CardContent className="p-4 space-y-3">
              <div>
                <Label>Nome Completo *</Label>
                <Input placeholder="Ex: João da Silva" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>CPF *</Label>
                  <Input placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(maskCPF(e.target.value))} className="mt-1" />
                </div>
                <div>
                  <Label>PIS <span className="text-xs text-muted-foreground">(opcional)</span></Label>
                  <Input placeholder="000.00000.00-0" value={pis} onChange={(e) => setPis(maskPIS(e.target.value))} className="mt-1" />
                </div>
              </div>
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-medium">Jornada de trabalho</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Horas por semana</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="Ex: 44, 42, 40"
                      value={jornada.carga}
                      onChange={(e) => setJornada({ ...jornada, carga: e.target.value.replace(/[^\d,.]/g, "") })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Escala</Label>
                    <select
                      className={campoSelect}
                      value={jornada.escala}
                      onChange={(e) => setJornada({ ...jornada, escala: e.target.value })}
                      aria-label="Escala"
                    >
                      <option value="">Não informada</option>
                      {ESCALAS_FUNCIONARIO.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Folga</Label>
                    <select
                      className={campoSelect}
                      value={jornada.folga}
                      onChange={(e) => setJornada({ ...jornada, folga: e.target.value })}
                      aria-label="Folga"
                    >
                      <option value="">Não informada</option>
                      {FOLGAS_FUNCIONARIO.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Entrada</Label>
                    <Input type="time" value={jornada.entrada} onChange={(e) => setJornada({ ...jornada, entrada: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Saída</Label>
                    <Input type="time" value={jornada.saida} onChange={(e) => setJornada({ ...jornada, saida: e.target.value })} className="mt-1" />
                  </div>
                </div>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={jornada.hiper}
                    onChange={(e) => setJornada({ ...jornada, hiper: e.target.checked })}
                  />
                  Tem nível superior e salário de pelo menos 2,5 vezes o teto do INSS (fica fora do limite de horas da emenda).
                </label>
                {(() => {
                  const s = situacaoJornada(jornadaParaApi(jornada), hoje);
                  const prox = proximoProblema(jornadaParaApi(jornada), hoje);
                  if (s.nivel === "sem_dado") return null;
                  return (
                    <p className={`rounded-md border px-2 py-1.5 text-xs ${COR_NIVEL[s.nivel]}`}>
                      {s.rotulo}
                      {s.detalhe ? `: ${s.detalhe}` : ""}
                      {prox ? ` A partir de ${dataBR(prox.etapa.inicio)}: ${prox.situacao.rotulo.toLowerCase()}.` : ""}
                    </p>
                  );
                })()}
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1 gap-1"
                  onClick={() => editingId ? updateMutation.mutate(editingId) : addMutation.mutate()}
                  disabled={!name.trim() || !cpf.trim()}
                >
                  <Save className="h-4 w-4" /> {editingId ? "Salvar" : "Adicionar"}
                </Button>
                <Button variant="outline" onClick={cancelEdit}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
          {(["ativos", "inativos"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setAba(k)}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                aba === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {k === "ativos" ? "Ativos" : "Inativos"}
              {k === "ativos" && employees ? ` (${employees.length})` : ""}
              {k === "inativos" && inativos ? ` (${inativos.length})` : ""}
            </button>
          ))}
        </div>

        {aba === "inativos" ? (
          loadingInativos ? (
            <div className="py-12 text-center text-muted-foreground">Carregando...</div>
          ) : !inativos?.length ? (
            <div className="py-12 text-center text-muted-foreground">
              <UserMinus className="mx-auto mb-3 h-12 w-12 opacity-30" />
              <p>Nenhum funcionário inativo</p>
            </div>
          ) : (
            inativos.map((emp) => (
              <Card key={emp.id} className="opacity-80">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <UserMinus className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{emp.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {emp.cpf ? `CPF: ${maskCPF(emp.cpf)}` : "CPF pendente"}
                      {emp.inativado_em
                        ? ` • saiu em ${new Date(emp.inativado_em).toLocaleDateString("pt-BR")}${
                            emp.inativado_por === "cliente" ? " (por você)" : ""
                          }`
                        : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={situacaoMutation.isPending}
                    onClick={() => situacaoMutation.mutate({ id: emp.id, active: true })}
                  >
                    <UserCheck className="h-4 w-4" /> Reativar
                  </Button>
                </CardContent>
              </Card>
            ))
          )
        ) : isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Carregando...</div>
        ) : !employees?.length ? (
          <div className="py-12 text-center text-muted-foreground">
            <Users className="mx-auto mb-3 h-12 w-12 opacity-30" />
            <p>Nenhum funcionário cadastrado</p>
          </div>
        ) : (
          employees.map((emp) => (
            <Card key={emp.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{emp.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {emp.cpf ? `CPF: ${maskCPF(emp.cpf)}` : "CPF pendente"}
                    {emp.pis && ` • PIS: ${emp.pis}`}
                  </p>
                  {(() => {
                    const s = situacaoJornada(emp, hoje);
                    const prox = proximoProblema(emp, hoje);
                    const txt = resumoJornada(emp);
                    return (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {txt && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3 w-3" /> {txt}
                          </span>
                        )}
                        <span className={`rounded border px-1.5 py-0.5 ${COR_NIVEL[s.nivel]}`} title={s.detalhe}>
                          {s.rotulo}
                        </span>
                        {prox && (
                          <span
                            className={`rounded border px-1.5 py-0.5 ${COR_NIVEL[prox.situacao.nivel]}`}
                            title={prox.situacao.detalhe}
                          >
                            a partir de {dataBR(prox.etapa.inicio)}: {prox.situacao.rotulo.toLowerCase()}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {emp.origem === "cliente" && !emp.codigo && (
                    <p className="text-[11px] text-muted-foreground">
                      Cadastrado por você · o escritório confirma no próximo fechamento da folha
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(emp)} className="h-8 w-8" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        title="Inativar (saiu da empresa)"
                        disabled={situacaoMutation.isPending}
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{emp.name} saiu da empresa?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Ele deixa de aparecer nas listas do dia a dia e vai para a aba Inativos, onde
                          você pode reativar se precisar. O escritório vê no painel que a saída foi dada por você.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => situacaoMutation.mutate({ id: emp.id, active: false })}>
                          Sim, inativar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {/* Excluir é para cadastro errado (pessoa que nunca trabalhou aqui, duplicado).
                      Quem saiu se inativa: o histórico fica. O servidor recusa excluir quem
                      tem atestado. Se a pessoa ainda vier na folha, a próxima importação a traz de volta. */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        title="Excluir cadastro errado"
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir {emp.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Use só para cadastro errado (pessoa que não trabalha aqui ou duplicada). Se a pessoa
                          saiu da empresa, prefira Inativar, que guarda o histórico.
                          {emp.codigo ? " Este cadastro veio da folha do escritório: se a pessoa ainda estiver na folha, ela volta na próxima importação." : ""}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(emp.id)}>Sim, excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </main>
    </div>
  );
};

export default EmployeesPage;
