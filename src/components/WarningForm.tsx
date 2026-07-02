import { useState, useEffect } from "react";
import { Plus, X, Download, CalendarIcon, User, Building2, History } from "lucide-react";
import { format, startOfToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateField, fromInputDateValue } from "@/components/DateField";
import { MultiDateField } from "@/components/MultiDateField";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { EmployeeSelect } from "@/components/EmployeeSelect";
import { downloadWarningDoc, type WarningData } from "@/lib/generateWarningDoc";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { maskCPF } from "@/lib/masks";
import { REASON_PRESETS } from "@/lib/reasonPresets";

interface Employee {
  id: string;
  name: string;
  cpf: string;
}

interface IssuedDocument {
  id: string;
  document_type: string;
  employee_cpf: string;
  start_date: string | null;
}

const formatDateBR = (date: Date) => format(date, "dd/MM/yyyy", { locale: ptBR });
const onlyDigits = (v: string) => String(v || "").replace(/\D/g, "");

/** Mesmo texto usado no chatbot — mantém os dois fluxos consistentes. */
function buildFaltaReason(dates: Date[]): string {
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const full = sorted.map((d) => format(d, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }));
  const plural = sorted.length > 1;
  const when = plural
    ? `nos dias ${full.slice(0, -1).join(", ")} e ${full[full.length - 1]}`
    : `no dia ${full[0]}`;
  return `Falta${plural ? "s" : ""} injustificada${plural ? "s" : ""} ao serviço ${when}, sem apresentação de justificativa válida, em descumprimento às obrigações contratuais e ao dever de assiduidade.`;
}

export function WarningForm() {
  const { company } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [issuedDocs, setIssuedDocs] = useState<IssuedDocument[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  // A advertência quase sempre é emitida no dia — já vem preenchida com hoje.
  const [warningDate, setWarningDate] = useState<Date | undefined>(() => startOfToday());
  const [reason, setReason] = useState("");
  const [reasonType, setReasonType] = useState<"falta" | "outro" | "">("");
  const [faltaDates, setFaltaDates] = useState<Date[]>([]);

  const [previousWarnings, setPreviousWarnings] = useState<string[]>([]);
  const [absenceDates, setAbsenceDates] = useState<Date[]>([]);
  const [prefilledFromHistory, setPrefilledFromHistory] = useState(false);

  const [newWarning, setNewWarning] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);

  useEffect(() => {
    if (!company) return;
    setLoadingEmployees(true);
    api.employees
      .list({ companyId: company.id })
      .then((data) => setEmployees(data))
      .catch(() => toast.error("Erro ao carregar a lista de funcionários"))
      .finally(() => setLoadingEmployees(false));
    // Histórico é opcional (pré-preenchimento); se falhar, o usuário preenche à mão.
    api.documents
      .list({ companyId: company.id })
      .then((docs) => setIssuedDocs(docs))
      .catch(() => setIssuedDocs([]));
  }, [company]);

  // Ao escolher o funcionário, puxa do histórico as advertências já emitidas.
  useEffect(() => {
    if (!selectedEmployeeId) {
      setPreviousWarnings([]);
      setPrefilledFromHistory(false);
      return;
    }
    const emp = employees.find((e) => e.id === selectedEmployeeId);
    if (!emp) return;
    const warningDates = issuedDocs
      .filter(
        (d) =>
          d.document_type === "warning" &&
          d.start_date &&
          onlyDigits(d.employee_cpf) === onlyDigits(emp.cpf)
      )
      .map((d) => fromInputDateValue(String(d.start_date).slice(0, 10)))
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime());
    const unique = [...new Map(warningDates.map((d) => [d.getTime(), d])).values()];
    setPreviousWarnings(unique.map(formatDateBR));
    setPrefilledFromHistory(unique.length > 0);
  }, [selectedEmployeeId, employees, issuedDocs]);

  const addWarning = () => {
    if (newWarning.trim()) {
      setPreviousWarnings([...previousWarnings, newWarning.trim()]);
      setNewWarning("");
    }
  };

  const removeWarning = (index: number) => {
    setPreviousWarnings(previousWarnings.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    const missing: string[] = [];
    if (!selectedEmployee) missing.push("o funcionário");
    if (!warningDate) missing.push("a data da advertência");
    if (!reasonType) missing.push("o motivo");
    else if (reasonType === "falta" && faltaDates.length === 0) missing.push("a(s) data(s) da falta");
    else if (reasonType === "outro" && !reason.trim()) missing.push("a descrição do motivo");
    if (missing.length > 0) {
      toast.error(`Falta preencher: ${missing.join(", ")}`);
      return;
    }
    if (!selectedEmployee || !warningDate || !reason) return;

    setIsGenerating(true);

    const sortedAbsences = [...absenceDates].sort((a, b) => a.getTime() - b.getTime());

    const data: WarningData = {
      employeeName: selectedEmployee.name,
      cpf: selectedEmployee.cpf,
      companyName: company?.name || "",
      cnpj: company?.cnpj || "",
      warningDate,
      reason,
      previousWarnings,
      unjustifiedAbsences: sortedAbsences.map(formatDateBR),
    };

    try {
      await api.documents.create({
        document_type: "warning",
        employee_name: selectedEmployee.name,
        employee_cpf: selectedEmployee.cpf,
        employee_pis: null,
        company_name: company?.name || "",
        company_cnpj: company?.cnpj || "",
        company_id: company?.id,
        start_date: format(warningDate, "yyyy-MM-dd"),
        description: reason.substring(0, 200),
      });

      await downloadWarningDoc(data);
      toast.success("Advertência gerada e salva no histórico!");
    } catch {
      toast.error("Erro ao gerar documento");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Employee Select */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-primary" />
            Funcionário
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <EmployeeSelect
            employees={employees}
            value={selectedEmployeeId}
            onChange={setSelectedEmployeeId}
            loading={loadingEmployees}
          />
          {selectedEmployee && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm"><span className="text-muted-foreground">CPF:</span> {maskCPF(String(selectedEmployee.cpf || ""))}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Company Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" />
            Empresa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted p-3 space-y-1">
            <p className="text-sm font-medium">{company?.name}</p>
            <p className="text-xs text-muted-foreground">CNPJ: {company?.cnpj}</p>
          </div>
        </CardContent>
      </Card>

      {/* Warning Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarIcon className="h-4 w-4 text-primary" />
            Detalhes da Advertência
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Data da Advertência *</Label>
            <DateField value={warningDate} onChange={setWarningDate} placeholder="Selecionar data" />
            <p className="text-xs text-muted-foreground mt-1">Data em que o documento é emitido (já preenchida com hoje).</p>
          </div>
          <div>
            <Label>Motivo da Advertência *</Label>
            <div className="mt-2 flex flex-col gap-2">
              <Button
                type="button"
                variant={reasonType === "falta" ? "default" : "outline"}
                className="w-full justify-start text-left h-auto py-3 whitespace-normal"
                onClick={() => {
                  setReasonType("falta");
                  setReason(faltaDates.length > 0 ? buildFaltaReason(faltaDates) : "");
                }}
              >
                Falta Injustificada
              </Button>
              <Button
                type="button"
                variant={reasonType === "outro" ? "default" : "outline"}
                className="w-full justify-start text-left h-auto py-3 whitespace-normal"
                onClick={() => { setReasonType("outro"); setReason(""); }}
              >
                Outro motivo (má conduta, atrasos, briga...)
              </Button>
            </div>
            {reasonType === "falta" && (
              <div className="mt-3">
                <Label>Data(s) da Falta *</Label>
                <MultiDateField
                  className="mt-1"
                  value={faltaDates}
                  onChange={(dates) => {
                    setFaltaDates(dates);
                    setReason(dates.length > 0 ? buildFaltaReason(dates) : "");
                  }}
                  placeholder="Selecionar data(s) da falta"
                  max={startOfToday()}
                />
                {reason && (
                  <div className="mt-2 rounded-lg bg-muted p-3">
                    <p className="text-xs text-muted-foreground mb-1">Texto que entrará no documento:</p>
                    <p className="text-sm">{reason}</p>
                  </div>
                )}
              </div>
            )}
            {reasonType === "outro" && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {REASON_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setReason(preset.text)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Modelos prontos — toque para preencher e edite à vontade (acrescente datas e detalhes do ocorrido).
                </p>
                <Textarea
                  id="w-reason"
                  placeholder="Descreva o motivo da advertência..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="min-h-[100px]"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">Histórico</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {prefilledFromHistory && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <History className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Pré-carregado do histórico do sistema.</span>{" "}
                Advertências já emitidas para este funcionário foram adicionadas abaixo — revise e ajuste se necessário.
              </p>
            </div>
          )}
          <div>
            <Label className="text-sm font-medium">Advertências Anteriores</Label>
            <div className="mt-2 flex gap-2">
              <Input placeholder="Ex: Advertência em 04/03/2025" value={newWarning} onChange={(e) => setNewWarning(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWarning()} className="flex-1" />
              <Button size="icon" variant="outline" onClick={addWarning} aria-label="Adicionar advertência anterior"><Plus className="h-4 w-4" /></Button>
            </div>
            {previousWarnings.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {previousWarnings.map((item, i) => (
                  <Badge key={i} variant="secondary" className="gap-1 pr-1">{item}<button onClick={() => removeWarning(i)} className="ml-1 rounded-full hover:bg-muted p-0.5" aria-label={`Remover ${item}`}><X className="h-3 w-3" /></button></Badge>
                ))}
              </div>
            )}
          </div>
          {reasonType !== "falta" && (
            <>
              <Separator />
              <div>
                <Label className="text-sm font-medium">Faltas sem Justificativa <span className="text-muted-foreground text-xs font-normal">(datas)</span></Label>
                <MultiDateField
                  className="mt-2"
                  value={absenceDates}
                  onChange={setAbsenceDates}
                  placeholder="Selecionar datas das faltas"
                  max={startOfToday()}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Generate Button */}
      <div className="sticky bottom-0 left-0 right-0 z-10 border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:static md:z-auto md:border-0 md:bg-transparent md:p-0">
        <Button onClick={handleGenerate} disabled={isGenerating} className="w-full gap-2 h-12 text-base font-semibold" size="lg">
          <Download className="h-5 w-5" />
          {isGenerating ? "Gerando..." : "Gerar Documento de Advertência"}
        </Button>
      </div>
    </div>
  );
}
