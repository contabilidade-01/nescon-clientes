import { type ChangeEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Pencil, Trash2, Users, Save, X, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { maskCPF, maskPIS } from "@/lib/masks";
import { parseEmployeeImportFile } from "@/lib/parseEmployeeSpreadsheet";

const EmployeesPage = () => {
  const navigate = useNavigate();
  const { company } = useAuth();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [pis, setPis] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    fileCnpj: string;
    rows: Array<{ name: string; cpf: string }>;
    skippedDismissed: number;
  } | null>(null);

  const { data: employees, isLoading } = useQuery({
    queryKey: ["employees", company?.id],
    queryFn: () => api.employees.list({ companyId: company!.id }),
    enabled: !!company,
  });

  const addMutation = useMutation({
    mutationFn: () =>
      api.employees.create({
        company_id: company!.id,
        name: name.trim().toUpperCase(),
        cpf: cpf.trim(),
        pis: pis.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setShowAdd(false);
      setName("");
      setCpf("");
      setPis("");
      toast.success("Funcionário adicionado");
    },
    onError: () => toast.error("Erro ao adicionar"),
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) =>
      api.employees.update(id, {
        name: name.trim().toUpperCase(),
        cpf: cpf.trim(),
        pis: pis.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setEditingId(null);
      setName("");
      setCpf("");
      setPis("");
      toast.success("Funcionário atualizado");
    },
    onError: () => toast.error("Erro ao atualizar"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.employees.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Funcionário removido");
    },
  });

  const importMutation = useMutation({
    mutationFn: ({ rows, fileCnpj }: { rows: Array<{ name: string; cpf: string }>; fileCnpj: string }) =>
      api.employees.import(rows, fileCnpj),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setPendingImport(null);
      toast.success(`Importação concluída: ${result.inserted} inseridos, ${result.skipped} ignorados`);
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

      const { rows, skippedDismissed, fileCnpj } = parsed;
      if (!rows.length) {
        if (skippedDismissed > 0) {
          toast.error("Nenhum funcionário ativo: todas as linhas tinham data de demissão ou dados inválidos");
        } else {
          toast.error("Planilha sem funcionários válidos para importar");
        }
        return;
      }
      setPendingImport({
        fileName: file.name,
        fileCnpj,
        rows,
        skippedDismissed,
      });
    } catch {
      toast.error("Não foi possível ler a planilha. Use CSV ou Excel (.xls, .xlsx).");
    } finally {
      event.target.value = "";
    }
  };

  const startEdit = (emp: { id: string; name: string; cpf: string; pis: string | null }) => {
    setEditingId(emp.id);
    setName(emp.name);
    setCpf(emp.cpf);
    setPis(emp.pis || "");
    setShowAdd(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowAdd(false);
    setName("");
    setCpf("");
    setPis("");
  };

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
              <Button size="sm" onClick={() => { setShowAdd(true); setName(""); setCpf(""); setPis(""); }}>
                <Plus className="h-4 w-4 mr-1" /> Novo
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-3">
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
                  <> • <span className="text-amber-600 dark:text-amber-500">{pendingImport.skippedDismissed} com demissão (não importados)</span></>
                )}
              </p>
              <div className="flex gap-2">
                <Button
                  className="gap-2"
                  onClick={() => importMutation.mutate({ rows: pendingImport.rows, fileCnpj: pendingImport.fileCnpj })}
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

        {isLoading ? (
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
                    CPF: {emp.cpf}
                    {emp.pis && ` • PIS: ${emp.pis}`}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(emp)} className="h-8 w-8">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMutation.mutate(emp.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
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
