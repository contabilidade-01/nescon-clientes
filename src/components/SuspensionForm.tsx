import { useState, useEffect } from "react";
import { Plus, X, Download, CalendarIcon, User, Building2, AlertTriangle, ShieldAlert } from "lucide-react";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateField } from "@/components/DateField";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { downloadSuspensionDoc, type SuspensionData } from "@/lib/generateSuspensionDoc";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { maskPIS } from "@/lib/masks";

interface Employee {
  id: string;
  name: string;
  cpf: string;
  pis: string | null;
}

export function SuspensionForm() {
  const { company } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [pis, setPis] = useState("");
  const [startDate, setStartDate] = useState<Date>();
  const [suspensionDays, setSuspensionDays] = useState(1);
  const [recentAbsenceDate, setRecentAbsenceDate] = useState("");

  const [previousWarnings, setPreviousWarnings] = useState<string[]>([]);
  const [previousSuspensions, setPreviousSuspensions] = useState<string[]>([]);
  const [unjustifiedAbsences, setUnjustifiedAbsences] = useState<string[]>([]);

  const [newWarning, setNewWarning] = useState("");
  const [newSuspension, setNewSuspension] = useState("");
  const [newAbsence, setNewAbsence] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isThirdSuspension, setIsThirdSuspension] = useState(false);

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);
  const endDate = startDate ? addDays(startDate, suspensionDays - 1) : null;
  const returnDate = endDate ? addDays(endDate, 1) : null;

  useEffect(() => {
    if (company) {
      api.employees.list({ companyId: company.id }).then((data) => setEmployees(data));
    }
  }, [company]);

  useEffect(() => {
    if (selectedEmployee) {
      setPis(selectedEmployee.pis || "");
    }
  }, [selectedEmployee]);

  const addItem = (list: string[], setList: (v: string[]) => void, value: string, setValue: (v: string) => void) => {
    if (value.trim()) {
      setList([...list, value.trim()]);
      setValue("");
    }
  };

  const removeItem = (list: string[], setList: (v: string[]) => void, index: number) => {
    setList(list.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    if (!selectedEmployee || !startDate) {
      toast.error("Selecione o funcionário e a data de início");
      return;
    }

    setIsGenerating(true);

    const data: SuspensionData = {
      employeeName: selectedEmployee.name,
      pis,
      cpf: selectedEmployee.cpf,
      companyName: company?.name || "",
      cnpj: company?.cnpj || "",
      startDate,
      suspensionDays,
      previousWarnings,
      previousSuspensions,
      recentAbsenceDate,
      unjustifiedAbsences,
      isThirdSuspension,
    };

    try {
      await api.documents.create({
        document_type: "suspension",
        employee_name: selectedEmployee.name,
        employee_cpf: selectedEmployee.cpf,
        employee_pis: pis || null,
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

  const formatDateBR = (date: Date) => format(date, "dd/MM/yyyy", { locale: ptBR });

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
          <div>
            <Label>Selecionar Funcionário *</Label>
            <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Escolha o funcionário" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name} — {emp.cpf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedEmployee && (
            <div className="rounded-lg bg-muted p-3 space-y-1">
              <p className="text-sm"><span className="text-muted-foreground">CPF:</span> {selectedEmployee.cpf}</p>
              {selectedEmployee.pis && <p className="text-sm"><span className="text-muted-foreground">PIS:</span> {selectedEmployee.pis}</p>}
            </div>
          )}
          <div>
            <Label htmlFor="pis">PIS <span className="text-muted-foreground text-xs">(opcional)</span></Label>
            <Input id="pis" placeholder="000.00000.00-0" value={pis} onChange={(e) => setPis(maskPIS(e.target.value))} className="mt-1" />
          </div>
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
            </div>
            <div>
              <Label htmlFor="days">Dias de Suspensão *</Label>
              <Input id="days" type="number" min={1} max={30} value={suspensionDays} onChange={(e) => setSuspensionDays(Math.min(30, Math.max(1, parseInt(e.target.value) || 1)))} className="mt-1" />
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

          <div>
            <Label htmlFor="recent">Data da falta mais recente</Label>
            <Input id="recent" placeholder="Ex: 29 de maio de 2025" value={recentAbsenceDate} onChange={(e) => setRecentAbsenceDate(e.target.value)} className="mt-1" />
          </div>
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
          <div>
            <Label className="text-sm font-medium">Suspensões Anteriores</Label>
            <div className="mt-2 flex gap-2">
              <Input placeholder="Ex: 04/03/2025" value={newSuspension} onChange={(e) => setNewSuspension(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem(previousSuspensions, setPreviousSuspensions, newSuspension, setNewSuspension)} className="flex-1" />
              <Button size="icon" variant="outline" onClick={() => addItem(previousSuspensions, setPreviousSuspensions, newSuspension, setNewSuspension)}><Plus className="h-4 w-4" /></Button>
            </div>
            {previousSuspensions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {previousSuspensions.map((item, i) => (
                  <Badge key={i} variant="secondary" className="gap-1 pr-1">{item}<button onClick={() => removeItem(previousSuspensions, setPreviousSuspensions, i)} className="ml-1 rounded-full hover:bg-muted p-0.5"><X className="h-3 w-3" /></button></Badge>
                ))}
              </div>
            )}
          </div>
          <Separator />
          <div>
            <Label className="text-sm font-medium">Advertências Anteriores</Label>
            <div className="mt-2 flex gap-2">
              <Input placeholder="Ex: Advertência verbal" value={newWarning} onChange={(e) => setNewWarning(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem(previousWarnings, setPreviousWarnings, newWarning, setNewWarning)} className="flex-1" />
              <Button size="icon" variant="outline" onClick={() => addItem(previousWarnings, setPreviousWarnings, newWarning, setNewWarning)}><Plus className="h-4 w-4" /></Button>
            </div>
            {previousWarnings.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {previousWarnings.map((item, i) => (
                  <Badge key={i} variant="secondary" className="gap-1 pr-1">{item}<button onClick={() => removeItem(previousWarnings, setPreviousWarnings, i)} className="ml-1 rounded-full hover:bg-muted p-0.5"><X className="h-3 w-3" /></button></Badge>
                ))}
              </div>
            )}
          </div>
          <Separator />
          <div>
            <Label className="text-sm font-medium">Faltas sem Justificativa</Label>
            <div className="mt-2 flex gap-2">
              <Input placeholder="Ex: 09/11/2024" value={newAbsence} onChange={(e) => setNewAbsence(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem(unjustifiedAbsences, setUnjustifiedAbsences, newAbsence, setNewAbsence)} className="flex-1" />
              <Button size="icon" variant="outline" onClick={() => addItem(unjustifiedAbsences, setUnjustifiedAbsences, newAbsence, setNewAbsence)}><Plus className="h-4 w-4" /></Button>
            </div>
            {unjustifiedAbsences.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {unjustifiedAbsences.map((item, i) => (
                  <Badge key={i} variant="secondary" className="gap-1 pr-1">{item}<button onClick={() => removeItem(unjustifiedAbsences, setUnjustifiedAbsences, i)} className="ml-1 rounded-full hover:bg-muted p-0.5"><X className="h-3 w-3" /></button></Badge>
                ))}
              </div>
            )}
           </div>
           <Separator />
           <div className="flex items-start space-x-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
             <Checkbox
               id="thirdSuspension"
               checked={isThirdSuspension}
               onCheckedChange={(checked) => setIsThirdSuspension(checked === true)}
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
             </div>
           </div>
         </CardContent>
      </Card>

      {/* Generate Button */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-card/95 backdrop-blur-sm p-4 md:static md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <Button onClick={handleGenerate} disabled={isGenerating} className="w-full gap-2 h-12 text-base font-semibold" size="lg">
          <Download className="h-5 w-5" />
          {isGenerating ? "Gerando..." : "Gerar Documento de Suspensão"}
        </Button>
      </div>
    </div>
  );
}
