import { useState, useEffect } from "react";
import { Plus, X, Download, CalendarIcon, User, Building2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { EmployeeSelect } from "@/components/EmployeeSelect";
import { cn } from "@/lib/utils";
import { downloadWarningDoc, type WarningData } from "@/lib/generateWarningDoc";
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

export function WarningForm() {
  const { company } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [pis, setPis] = useState("");
  const [warningDate, setWarningDate] = useState<Date>();
  const [reason, setReason] = useState("");
  const [reasonType, setReasonType] = useState<"falta" | "outro" | "">("");
  const [faltaDate, setFaltaDate] = useState<Date>();

  const [previousWarnings, setPreviousWarnings] = useState<string[]>([]);
  const [unjustifiedAbsences, setUnjustifiedAbsences] = useState<string[]>([]);

  const [newWarning, setNewWarning] = useState("");
  const [newAbsence, setNewAbsence] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);

  useEffect(() => {
    if (company) {
      api.employees.list({ companyId: company.id }).then((data) => setEmployees(data));
    }
  }, [company]);

  useEffect(() => {
    if (!selectedEmployeeId) {
      setPis("");
      return;
    }
    const emp = employees.find((e) => e.id === selectedEmployeeId);
    setPis(emp?.pis ? String(emp.pis) : "");
  }, [selectedEmployeeId, employees]);

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
    if (!selectedEmployee || !warningDate || !reason) {
      toast.error("Selecione o funcionário, data e motivo");
      return;
    }

    setIsGenerating(true);

    const data: WarningData = {
      employeeName: selectedEmployee.name,
      pis,
      cpf: selectedEmployee.cpf,
      companyName: company?.name || "",
      cnpj: company?.cnpj || "",
      warningDate,
      reason,
      previousWarnings,
      unjustifiedAbsences,
    };

    try {
      await api.documents.create({
        document_type: "warning",
        employee_name: selectedEmployee.name,
        employee_cpf: selectedEmployee.cpf,
        employee_pis: pis || null,
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
          <EmployeeSelect
            employees={employees}
            value={selectedEmployeeId}
            onChange={setSelectedEmployeeId}
          />
          {selectedEmployee && (
            <div className="rounded-lg bg-muted p-3 space-y-1">
              <p className="text-sm"><span className="text-muted-foreground">CPF:</span> {selectedEmployee.cpf}</p>
              {selectedEmployee.pis && <p className="text-sm"><span className="text-muted-foreground">PIS:</span> {selectedEmployee.pis}</p>}
            </div>
          )}
          <div>
            <Label htmlFor="w-pis">PIS <span className="text-muted-foreground text-xs">(opcional)</span></Label>
            <Input id="w-pis" placeholder="000.00000.00-0" value={pis} onChange={(e) => setPis(maskPIS(e.target.value))} className="mt-1" />
          </div>
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
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("mt-1 w-full justify-start text-left font-normal", !warningDate && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {warningDate ? formatDateBR(warningDate) : "Selecionar data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={warningDate} onSelect={setWarningDate} locale={ptBR} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
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
                  if (faltaDate) {
                    const dateFull = format(faltaDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
                    setReason(`Falta injustificada ao serviço no dia ${dateFull}, sem apresentação de justificativa válida, em descumprimento às obrigações contratuais e ao dever de assiduidade.`);
                  }
                }}
              >
                Falta Injustificada
              </Button>
              <Button
                type="button"
                variant={reasonType === "outro" ? "default" : "outline"}
                className="w-full justify-start text-left h-auto py-3"
                onClick={() => { setReasonType("outro"); setReason(""); }}
              >
                Outro motivo
              </Button>
            </div>
            {reasonType === "falta" && (
              <div className="mt-3">
                <Label>Data da Falta *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("mt-1 w-full justify-start text-left font-normal", !faltaDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {faltaDate ? format(faltaDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data da falta"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={faltaDate}
                      onSelect={(d) => {
                        setFaltaDate(d);
                        if (d) {
                          const dateFull = format(d, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
                          setReason(`Falta injustificada ao serviço no dia ${dateFull}, sem apresentação de justificativa válida, em descumprimento às obrigações contratuais e ao dever de assiduidade.`);
                        }
                      }}
                      locale={ptBR}
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
            {reasonType === "outro" && (
              <Textarea
                id="w-reason"
                placeholder="Descreva o motivo da advertência..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-2 min-h-[100px]"
              />
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
          <div>
            <Label className="text-sm font-medium">Advertências Anteriores</Label>
            <div className="mt-2 flex gap-2">
              <Input placeholder="Ex: Advertência em 04/03/2025" value={newWarning} onChange={(e) => setNewWarning(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem(previousWarnings, setPreviousWarnings, newWarning, setNewWarning)} className="flex-1" />
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
          {reasonType !== "falta" && (
            <>
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
