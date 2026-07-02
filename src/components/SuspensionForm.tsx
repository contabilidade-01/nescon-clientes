import { useState, useEffect } from "react";
import { Plus, X, Download, CalendarIcon, User, Building2, AlertTriangle, ShieldAlert, History } from "lucide-react";
import { format, addDays, startOfToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateField, fromInputDateValue } from "@/components/DateField";
import { MultiDateField } from "@/components/MultiDateField";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { EmployeeSelect } from "@/components/EmployeeSelect";
import { downloadSuspensionDoc, type SuspensionData } from "@/lib/generateSuspensionDoc";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { maskCPF } from "@/lib/masks";

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
const formatDateFull = (date: Date) => format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
const onlyDigits = (v: string) => String(v || "").replace(/\D/g, "");

/** Datas dos documentos já emitidos para o funcionário (deduplicadas, mais antigas primeiro). */
function datesFromDocs(docs: IssuedDocument[], type: string): Date[] {
  const dates = docs
    .filter((d) => d.document_type === type && d.start_date)
    .map((d) => fromInputDateValue(String(d.start_date).slice(0, 10)))
    .filter((d): d is Date => !!d);
  const unique = new Map(dates.map((d) => [d.getTime(), d]));
  return [...unique.values()].sort((a, b) => a.getTime() - b.getTime());
}

export function SuspensionForm() {
  const { company } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [issuedDocs, setIssuedDocs] = useState<IssuedDocument[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [startDate, setStartDate] = useState<Date>();
  const [suspensionDays, setSuspensionDays] = useState(1);
  const [recentAbsence, setRecentAbsence] = useState<Date>();

  const [previousWarnings, setPreviousWarnings] = useState<string[]>([]);
  const [previousSuspensionDates, setPreviousSuspensionDates] = useState<Date[]>([]);
  const [absenceDates, setAbsenceDates] = useState<Date[]>([]);
  const [prefilledFromHistory, setPrefilledFromHistory] = useState(false);

  const [newWarning, setNewWarning] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isThirdSuspension, setIsThirdSuspension] = useState(false);
  const [thirdManuallySet, setThirdManuallySet] = useState(false);

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);
  const endDate = startDate ? addDays(startDate, suspensionDays - 1) : null;
  const returnDate = endDate ? addDays(endDate, 1) : null;

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

  // Ao escolher o funcionário, puxa do histórico as suspensões e advertências já emitidas.
  useEffect(() => {
    setThirdManuallySet(false);
    if (!selectedEmployeeId) {
      setPreviousSuspensionDates([]);
      setPreviousWarnings([]);
      setPrefilledFromHistory(false);
      return;
    }
    const emp = employees.find((e) => e.id === selectedEmployeeId);
    if (!emp) return;
    const empDocs = issuedDocs.filter((d) => onlyDigits(d.employee_cpf) === onlyDigits(emp.cpf));
    const suspensions = datesFromDocs(empDocs, "suspension");
    const warnings = datesFromDocs(empDocs, "warning").map((d) => `Advertência em ${formatDateBR(d)}`);
    setPreviousSuspensionDates(suspensions);
    setPreviousWarnings(warnings);
    setPrefilledFromHistory(suspensions.length > 0 || warnings.length > 0);
  }, [selectedEmployeeId, employees, issuedDocs]);

  // Com 2 suspensões anteriores informadas, esta é a 3ª — marca sozinho,
  // mas respeita a escolha se o usuário mexer na caixa.
  useEffect(() => {
    if (!thirdManuallySet) {
      setIsThirdSuspension(previousSuspensionDates.length >= 2);
    }
  }, [previousSuspensionDates.length, thirdManuallySet]);

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
    if (!startDate) missing.push("a data de início");
    if (missing.length > 0) {
      toast.error(`Falta preencher: ${missing.join(" e ")}`);
      return;
    }
    if (!selectedEmployee || !startDate) return;

    setIsGenerating(true);

    const sortedSuspensions = [...previousSuspensionDates].sort((a, b) => a.getTime() - b.getTime());
    const sortedAbsences = [...absenceDates].sort((a, b) => a.getTime() - b.getTime());

    const data: SuspensionData = {
      employeeName: selectedEmployee.name,
      cpf: selectedEmployee.cpf,
      companyName: company?.name || "",
      cnpj: company?.cnpj || "",
      startDate,
      suspensionDays,
      previousWarnings,
      previousSuspensions: sortedSuspensions.map(formatDateBR),
      recentAbsenceDate: recentAbsence ? formatDateFull(recentAbsence) : "",
      unjustifiedAbsences: sortedAbsences.map(formatDateBR),
      isThirdSuspension,
    };

    try {
      await api.documents.create({
        document_type: "suspension",
        employee_name: selectedEmployee.name,
        employee_cpf: selectedEmployee.cpf,
        employee_pis: null,
        company_name: company?.name || "",
        company_cnpj: company?.cnpj || "",
        company_id: company?.id,
        start_date: format(startDate, "yyyy-MM-dd"),
        suspension_days: suspensionDays,
        return_date: returnDate ? format(returnDate, "yyyy-MM-dd") : null,
        description: `Suspensão de ${suspensionDays} dia(s)`,
      });

      await downloadSuspensionDoc(data);
      toast.success("Documento gerado e salvo no histórico!");
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

      {/* Company Info (read-only) */}
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

      {/* Suspension Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarIcon className="h-4 w-4 text-primary" />
            Detalhes da Suspensão
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data de Início *</Label>
              <DateField value={startDate} onChange={setStartDate} placeholder="Selecionar" />
              <div className="mt-2 flex gap-2">
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setStartDate(startOfToday())}>
                  Hoje
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setStartDate(addDays(startOfToday(), 1))}>
                  Amanhã
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="days">Dias de Suspensão *</Label>
              <Input id="days" type="number" inputMode="numeric" min={1} max={30} value={suspensionDays} onChange={(e) => setSuspensionDays(Math.min(30, Math.max(1, parseInt(e.target.value) || 1)))} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">Máximo 30 dias (Art. 474 CLT)</p>
            </div>
          </div>

          {startDate && (
            <div className="rounded-lg bg-muted p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Período:</span>
                <span className="font-medium">{formatDateBR(startDate)} a {endDate && formatDateBR(endDate)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total de dias:</span>
                <span className="font-medium">{suspensionDays} dia{suspensionDays > 1 ? "s" : ""}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Retorno ao trabalho:</span>
                <span className="font-semibold text-primary">{returnDate && formatDateBR(returnDate)}</span>
              </div>
            </div>
          )}

          {absenceDates.length === 0 && (
            <div>
              <Label>Data da falta mais recente <span className="text-muted-foreground text-xs">(opcional)</span></Label>
              <DateField value={recentAbsence} onChange={setRecentAbsence} placeholder="Selecionar data da falta" />
              <p className="text-xs text-muted-foreground mt-1">
                Citada na fundamentação. Se preferir listar todas as faltas, use "Faltas sem Justificativa" abaixo.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-accent" />
            Histórico de Advertências
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {prefilledFromHistory && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <History className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Pré-carregado do histórico do sistema.</span>{" "}
                Documentos já emitidos para este funcionário foram adicionados abaixo — revise e ajuste se necessário.
              </p>
            </div>
          )}
          <div>
            <Label className="text-sm font-medium">Suspensões Anteriores <span className="text-muted-foreground text-xs font-normal">(datas)</span></Label>
            <MultiDateField
              className="mt-2"
              value={previousSuspensionDates}
              onChange={setPreviousSuspensionDates}
              placeholder="Selecionar datas das suspensões"
              max={startOfToday()}
            />
          </div>
          <Separator />
          <div>
            <Label className="text-sm font-medium">Advertências Anteriores</Label>
            <div className="mt-2 flex gap-2">
              <Input placeholder="Ex: Advertência verbal em 04/03/2025" value={newWarning} onChange={(e) => setNewWarning(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWarning()} className="flex-1" />
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
            <p className="text-xs text-muted-foreground mt-1">
              Essas datas entram na fundamentação do documento.
            </p>
          </div>
           <Separator />
           <div className="flex items-start space-x-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
             <Checkbox
               id="thirdSuspension"
               checked={isThirdSuspension}
               onCheckedChange={(checked) => {
                 setThirdManuallySet(true);
                 setIsThirdSuspension(checked === true);
               }}
               className="mt-0.5"
             />
             <div className="space-y-1">
               <Label htmlFor="thirdSuspension" className="text-sm font-medium flex items-center gap-2 cursor-pointer">
                 <ShieldAlert className="h-4 w-4 text-destructive" />
                 Esta é a 3ª suspensão do funcionário
               </Label>
               <p className="text-xs text-muted-foreground">
                 Ao marcar, o documento incluirá o aviso: "A próxima falta injustificada pode levar a DEMISSÃO COM JUSTA CAUSA."
               </p>
               {isThirdSuspension && !thirdManuallySet && previousSuspensionDates.length >= 2 && (
                 <p className="text-xs font-medium text-destructive">
                   Marcado automaticamente: há {previousSuspensionDates.length} suspensões anteriores registradas.
                 </p>
               )}
             </div>
           </div>
         </CardContent>
      </Card>

      {/* Generate Button */}
      <div className="sticky bottom-0 left-0 right-0 z-10 border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:static md:z-auto md:border-0 md:bg-transparent md:p-0">
        <Button onClick={handleGenerate} disabled={isGenerating} className="w-full gap-2 h-12 text-base font-semibold" size="lg">
          <Download className="h-5 w-5" />
          {isGenerating ? "Gerando..." : "Gerar Documento de Suspensão"}
        </Button>
      </div>
    </div>
  );
}
