import { useState, useEffect, useRef } from "react";
import { Plus, X, Download, CalendarIcon, Check } from "lucide-react";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { downloadSuspensionDoc, type SuspensionData } from "@/lib/generateSuspensionDoc";
import { downloadWarningDoc, type WarningData } from "@/lib/generateWarningDoc";
import { toast } from "sonner";

type Step =
  | "doc_type"
  | "employee"
  | "days"
  | "start_date"
  | "reason"
  | "reason_custom"
  | "reason_falta_date"
  | "recent_absence"
  | "previous_warnings_yn"
  | "previous_warnings"
  | "previous_suspensions_yn"
  | "previous_suspensions"
  | "third_suspension"
  | "unjustified_absences_yn"
  | "unjustified_absences"
  | "pis"
  | "confirm";

interface Message {
  from: "bot" | "user";
  text: string;
}

interface Employee {
  id: string;
  name: string;
  cpf: string;
  pis: string | null;
}

export function ChatbotFlow() {
  const { company } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [step, setStep] = useState<Step>("doc_type");
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Form state
  const [docType, setDocType] = useState<"suspension" | "warning" | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [days, setDays] = useState(1);
  const [startDate, setStartDate] = useState<Date>();
  const [reason, setReason] = useState("");
  const [recentAbsence, setRecentAbsence] = useState("");
  const [previousWarnings, setPreviousWarnings] = useState<string[]>([]);
  const [previousSuspensions, setPreviousSuspensions] = useState<string[]>([]);
  const [unjustifiedAbsences, setUnjustifiedAbsences] = useState<string[]>([]);
  const [pisInput, setPisInput] = useState("");
  const [tempInput, setTempInput] = useState("");
  const [isThirdSuspension, setIsThirdSuspension] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [faltaDates, setFaltaDates] = useState<Date[]>([]);

  useEffect(() => {
    if (company) {
      api.employees.list({ companyId: company.id }).then((data) => setEmployees(data));
    }
  }, [company]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, step]);

  const addBotMsg = (text: string) => setMessages((m) => [...m, { from: "bot", text }]);
  const addUserMsg = (text: string) => setMessages((m) => [...m, { from: "user", text }]);

  useEffect(() => {
    addBotMsg("Olá! Vou te ajudar a gerar um documento. Qual tipo você deseja?");
  }, []);

  const selectDocType = (type: "suspension" | "warning") => {
    setDocType(type);
    addUserMsg(type === "suspension" ? "Suspensão" : "Advertência");
    addBotMsg("Qual funcionário?");
    setStep("employee");
  };

  const selectEmployee = (emp: Employee) => {
    setSelectedEmployee(emp);
    setPisInput(emp.pis || "");
    addUserMsg(emp.name);

    if (docType === "suspension") {
      addBotMsg("Quantos dias de suspensão?");
      setStep("days");
    } else {
      addBotMsg("Qual a data da advertência?");
      setStep("start_date");
    }
  };

  const submitDays = () => {
    addUserMsg(`${days} dia${days > 1 ? "s" : ""}`);
    addBotMsg("Qual a data de início da suspensão?");
    setStep("start_date");
  };

  const submitDate = (date: Date) => {
    setStartDate(date);
    addUserMsg(format(date, "dd/MM/yyyy", { locale: ptBR }));
    if (docType === "warning") {
      addBotMsg("Qual o motivo da advertência?");
    } else {
      addBotMsg("Qual o motivo da suspensão?");
    }
    setStep("reason");
  };

  const FALTA_INJUSTIFICADA_TEXT = "Falta injustificada ao serviço, sem apresentação de justificativa válida, em descumprimento às obrigações contratuais e ao dever de assiduidade.";

  const selectReason = (type: "falta" | "outro") => {
    if (type === "falta") {
      addUserMsg("Falta Injustificada");
      addBotMsg("Qual a data da falta?");
      setStep("reason_falta_date");
    } else {
      addUserMsg("Outro motivo");
      addBotMsg("Descreva o motivo:");
      setStep("reason_custom");
    }
  };

  const submitFaltaDates = () => {
    if (faltaDates.length === 0) return;
    const sorted = [...faltaDates].sort((a, b) => a.getTime() - b.getTime());
    const datesStr = sorted.map(d => format(d, "dd/MM/yyyy", { locale: ptBR })).join(", ");
    const datesFull = sorted.map(d => format(d, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }));
    const datesText = datesFull.length === 1
      ? `no dia ${datesFull[0]}`
      : `nos dias ${datesFull.slice(0, -1).join(", ")} e ${datesFull[datesFull.length - 1]}`;
    setReason(`Falta${sorted.length > 1 ? "s" : ""} injustificada${sorted.length > 1 ? "s" : ""} ao serviço ${datesText}, sem apresentação de justificativa válida, em descumprimento às obrigações contratuais e ao dever de assiduidade.`);
    // Populate unjustifiedAbsences with the falta dates for the document generator
    const datesFormatted = sorted.map(d => format(d, "dd/MM/yyyy", { locale: ptBR }));
    setUnjustifiedAbsences(datesFormatted);
    addUserMsg(datesStr);
    goToNextAfterReason();
  };

  const submitCustomReason = () => {
    if (!reason.trim()) return;
    addUserMsg(reason);
    goToNextAfterReason();
  };

  const goToNextAfterReason = () => {
    if (docType === "suspension") {
      addBotMsg("Houve suspensões anteriores?");
      setStep("previous_suspensions_yn");
    } else {
      addBotMsg("Houve advertências anteriores?");
      setStep("previous_warnings_yn");
    }
  };


  const submitRecentAbsence = () => {
    if (recentAbsence) addUserMsg(recentAbsence);
    else addUserMsg("(pulado)");
    addBotMsg("Houve suspensões anteriores?");
    setStep("previous_suspensions_yn");
  };

  const goToThirdSuspension = () => {
    if (previousSuspensions.length > 0) addUserMsg(previousSuspensions.join(", "));
    addBotMsg("Esta é a 3ª suspensão do funcionário? Se sim, o documento incluirá o aviso de possível demissão por justa causa.");
    setStep("third_suspension");
  };

  const submitThirdSuspension = (value: boolean) => {
    setIsThirdSuspension(value);
    addUserMsg(value ? "Sim, é a 3ª suspensão" : "Não");
    addBotMsg("Houve advertências anteriores?");
    setStep("previous_warnings_yn");
  };

  const answerPreviousWarningsYn = (yes: boolean) => {
    if (yes) {
      addUserMsg("Sim");
      addBotMsg("Informe as advertências anteriores:");
      setStep("previous_warnings");
    } else {
      addUserMsg("Não");
      goToAbsences();
    }
  };

  const answerPreviousSuspensionsYn = (yes: boolean) => {
    if (yes) {
      addUserMsg("Sim");
      addBotMsg("Informe as suspensões anteriores:");
      setStep("previous_suspensions");
    } else {
      addUserMsg("Não");
      goToThirdSuspension();
    }
  };

  const answerUnjustifiedAbsencesYn = (yes: boolean) => {
    if (yes) {
      addUserMsg("Sim");
      addBotMsg("Informe as datas das faltas:");
      setStep("unjustified_absences");
    } else {
      addUserMsg("Não");
      goToPis();
    }
  };

  const goToAbsences = () => {
    if (previousWarnings.length > 0) addUserMsg(previousWarnings.join(", "));
    // Se o motivo já é falta injustificada, pular a pergunta de faltas
    if (reason.startsWith("Falta injustificada") || reason.startsWith("Faltas injustificadas")) {
      goToPis();
    } else {
      addBotMsg("Houve faltas sem justificativa?");
      setStep("unjustified_absences_yn");
    }
  };

  const goToPis = () => {
    if (unjustifiedAbsences.length > 0) addUserMsg(unjustifiedAbsences.join(", "));
    addBotMsg(`PIS do funcionário${pisInput ? ` (atual: ${pisInput})` : ""}. Altere ou clique em Pular.`);
    setStep("pis");
  };

  const goToConfirm = () => {
    if (pisInput) addUserMsg(`PIS: ${pisInput}`);
    else addUserMsg("(sem PIS)");
    setStep("confirm");

    const endDate = startDate && docType === "suspension" ? addDays(startDate, days - 1) : null;
    const returnDate = endDate ? addDays(endDate, 1) : null;

    let summary = `📋 **Resumo:**\n`;
    summary += `• Tipo: ${docType === "suspension" ? "Suspensão" : "Advertência"}\n`;
    summary += `• Funcionário: ${selectedEmployee?.name}\n`;
    summary += `• CPF: ${selectedEmployee?.cpf}\n`;
    if (pisInput) summary += `• PIS: ${pisInput}\n`;
    if (startDate) summary += `• Data: ${format(startDate, "dd/MM/yyyy")}\n`;
    if (docType === "suspension") {
      summary += `• Dias: ${days}\n`;
      if (returnDate) summary += `• Retorno: ${format(returnDate, "dd/MM/yyyy")}\n`;
    }
    summary += `• Empresa: ${company?.name}\n`;

    addBotMsg(summary + "\nConfirma a geração do documento?");
  };

  const handleGenerate = async () => {
    if (!startDate || !selectedEmployee || !company) return;
    setIsGenerating(true);

    try {
      if (docType === "suspension") {
        const data: SuspensionData = {
          employeeName: selectedEmployee.name,
          pis: pisInput,
          cpf: selectedEmployee.cpf,
          companyName: company.name,
          cnpj: company.cnpj,
          startDate,
          suspensionDays: days,
          previousWarnings,
          previousSuspensions,
          recentAbsenceDate: recentAbsence,
          unjustifiedAbsences,
          isThirdSuspension,
        };
        const endDate = addDays(startDate, days - 1);
        const returnDate = addDays(endDate, 1);
        await api.documents.create({
          document_type: "suspension",
          employee_name: selectedEmployee.name,
          employee_cpf: selectedEmployee.cpf,
          employee_pis: pisInput || null,
          company_name: company.name,
          company_cnpj: company.cnpj,
          company_id: company.id,
          start_date: format(startDate, "yyyy-MM-dd"),
          suspension_days: days,
          return_date: format(returnDate, "yyyy-MM-dd"),
          description: `Suspensão de ${days} dia(s)`,
        });
        await downloadSuspensionDoc(data);
      } else {
        const data: WarningData = {
          employeeName: selectedEmployee.name,
          pis: pisInput,
          cpf: selectedEmployee.cpf,
          companyName: company.name,
          cnpj: company.cnpj,
          warningDate: startDate,
          reason,
          previousWarnings,
          unjustifiedAbsences,
        };
        await api.documents.create({
          document_type: "warning",
          employee_name: selectedEmployee.name,
          employee_cpf: selectedEmployee.cpf,
          employee_pis: pisInput || null,
          company_name: company.name,
          company_cnpj: company.cnpj,
          company_id: company.id,
          start_date: format(startDate, "yyyy-MM-dd"),
          description: reason.substring(0, 200),
        });
        await downloadWarningDoc(data);
      }

      addUserMsg("✅ Confirmar");
      addBotMsg("✅ Documento gerado com sucesso! O download foi iniciado.");
      toast.success("Documento gerado!");
    } catch {
      toast.error("Erro ao gerar documento");
    } finally {
      setIsGenerating(false);
    }
  };

  const addListItem = (
    list: string[],
    setList: (v: string[]) => void
  ) => {
    if (tempInput.trim()) {
      setList([...list, tempInput.trim()]);
      setTempInput("");
    }
  };

  const removeListItem = (list: string[], setList: (v: string[]) => void, index: number) => {
    setList(list.filter((_, i) => i !== index));
  };

  const filteredEmployees = employees.filter((e) =>
    (e.name ?? "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex", msg.from === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line",
                msg.from === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-muted text-foreground rounded-bl-md"
              )}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {/* Input area based on step */}
        <div className="pt-2">
          {step === "doc_type" && (
            <div className="flex gap-2">
              <Button onClick={() => selectDocType("suspension")} className="flex-1">
                Suspensão
              </Button>
              <Button onClick={() => selectDocType("warning")} variant="secondary" className="flex-1">
                Advertência
              </Button>
            </div>
          )}

          {step === "employee" && (
            <div className="space-y-2">
              <Input
                placeholder="Buscar funcionário..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredEmployees.map((emp) => (
                  <Button
                    key={emp.id}
                    variant="outline"
                    className="w-full justify-start text-left h-auto py-2"
                    onClick={() => selectEmployee(emp)}
                  >
                    <div>
                      <div className="font-medium text-sm">{emp.name}</div>
                      <div className="text-xs text-muted-foreground">CPF: {emp.cpf}</div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {step === "days" && (
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Math.min(30, Math.max(1, parseInt(e.target.value) || 1)))}
                className="flex-1"
              />
              <Button onClick={submitDays}>
                <Check className="h-4 w-4" />
              </Button>
            </div>
          )}

          {step === "start_date" && (
            <div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start", !startDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(d) => d && submitDate(d)}
                    locale={ptBR}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {step === "reason" && (
            <div className="flex flex-col gap-2">
              <Button onClick={() => selectReason("falta")} className="w-full">
                Falta Injustificada
              </Button>
              <Button onClick={() => selectReason("outro")} variant="secondary" className="w-full">
                Outro motivo
              </Button>
            </div>
          )}

          {step === "reason_custom" && (
            <div className="space-y-2">
              <Textarea
                placeholder="Descreva o motivo..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-[80px]"
              />
              <Button onClick={submitCustomReason} disabled={!reason.trim()} className="w-full">
                Enviar
              </Button>
            </div>
          )}

          {step === "reason_falta_date" && (
            <div className="space-y-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start", faltaDates.length === 0 && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {faltaDates.length > 0
                      ? `${faltaDates.length} data${faltaDates.length > 1 ? "s" : ""} selecionada${faltaDates.length > 1 ? "s" : ""}`
                      : "Selecionar data(s) da falta"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="multiple"
                    selected={faltaDates}
                    onSelect={(dates) => setFaltaDates(dates || [])}
                    locale={ptBR}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              {faltaDates.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {[...faltaDates].sort((a, b) => a.getTime() - b.getTime()).map((d, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {format(d, "dd/MM/yyyy", { locale: ptBR })}
                      <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => setFaltaDates(faltaDates.filter((_, idx) => idx !== i))} />
                    </Badge>
                  ))}
                </div>
              )}
              <Button onClick={submitFaltaDates} disabled={faltaDates.length === 0} className="w-full">
                Continuar
              </Button>
            </div>
          )}

          {step === "recent_absence" && (
            <div className="flex gap-2">
              <Input
                placeholder="Ex: 29 de maio de 2025"
                value={recentAbsence}
                onChange={(e) => setRecentAbsence(e.target.value)}
                className="flex-1"
              />
              <Button onClick={submitRecentAbsence}>
                {recentAbsence ? <Check className="h-4 w-4" /> : "Pular"}
              </Button>
            </div>
          )}

          {step === "previous_suspensions_yn" && (
            <div className="flex gap-2">
              <Button onClick={() => answerPreviousSuspensionsYn(true)} className="flex-1">Sim</Button>
              <Button onClick={() => answerPreviousSuspensionsYn(false)} variant="secondary" className="flex-1">Não</Button>
            </div>
          )}

          {step === "previous_suspensions" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: 04/03/2025"
                  value={tempInput}
                  onChange={(e) => setTempInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addListItem(previousSuspensions, setPreviousSuspensions)}
                  className="flex-1"
                />
                <Button size="icon" variant={tempInput.trim() ? "default" : "outline"} onClick={() => addListItem(previousSuspensions, setPreviousSuspensions)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {previousSuspensions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {previousSuspensions.map((item, i) => (
                    <Badge key={i} variant="secondary" className="gap-1 pr-1">
                      {item}
                      <button onClick={() => removeListItem(previousSuspensions, setPreviousSuspensions, i)} className="ml-1 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Button onClick={goToThirdSuspension} variant={previousSuspensions.length > 0 ? "default" : "secondary"} className="w-full">
                {previousSuspensions.length > 0 ? "Continuar" : "Pular"}
              </Button>
            </div>
          )}

          {step === "third_suspension" && (
            <div className="flex gap-2">
              <Button onClick={() => submitThirdSuspension(true)} variant="destructive" className="flex-1">
                Sim, é a 3ª
              </Button>
              <Button onClick={() => submitThirdSuspension(false)} variant="secondary" className="flex-1">
                Não
              </Button>
            </div>
          )}

          {step === "previous_warnings_yn" && (
            <div className="flex gap-2">
              <Button onClick={() => answerPreviousWarningsYn(true)} className="flex-1">Sim</Button>
              <Button onClick={() => answerPreviousWarningsYn(false)} variant="secondary" className="flex-1">Não</Button>
            </div>
          )}

          {step === "previous_warnings" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: 01/02/2025"
                  value={tempInput}
                  onChange={(e) => setTempInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addListItem(previousWarnings, setPreviousWarnings)}
                  className="flex-1"
                />
                <Button size="icon" variant={tempInput.trim() ? "default" : "outline"} onClick={() => addListItem(previousWarnings, setPreviousWarnings)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {previousWarnings.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {previousWarnings.map((item, i) => (
                    <Badge key={i} variant="secondary" className="gap-1 pr-1">
                      {item}
                      <button onClick={() => removeListItem(previousWarnings, setPreviousWarnings, i)} className="ml-1 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Button onClick={goToAbsences} variant={previousWarnings.length > 0 ? "default" : "secondary"} className="w-full">
                {previousWarnings.length > 0 ? "Continuar" : "Pular"}
              </Button>
            </div>
          )}

          {step === "unjustified_absences_yn" && (
            <div className="flex gap-2">
              <Button onClick={() => answerUnjustifiedAbsencesYn(true)} className="flex-1">Sim</Button>
              <Button onClick={() => answerUnjustifiedAbsencesYn(false)} variant="secondary" className="flex-1">Não</Button>
            </div>
          )}

          {step === "unjustified_absences" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: 09/11/2024"
                  value={tempInput}
                  onChange={(e) => setTempInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addListItem(unjustifiedAbsences, setUnjustifiedAbsences)}
                  className="flex-1"
                />
                <Button size="icon" variant={tempInput.trim() ? "default" : "outline"} onClick={() => addListItem(unjustifiedAbsences, setUnjustifiedAbsences)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {unjustifiedAbsences.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {unjustifiedAbsences.map((item, i) => (
                    <Badge key={i} variant="secondary" className="gap-1 pr-1">
                      {item}
                      <button onClick={() => removeListItem(unjustifiedAbsences, setUnjustifiedAbsences, i)} className="ml-1 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Button onClick={goToPis} variant={unjustifiedAbsences.length > 0 ? "default" : "secondary"} className="w-full">
                {unjustifiedAbsences.length > 0 ? "Continuar" : "Pular"}
              </Button>
            </div>
          )}

          {step === "pis" && (
            <div className="flex gap-2">
              <Input
                placeholder="000.00000.00-0"
                value={pisInput}
                onChange={(e) => setPisInput(e.target.value)}
                className="flex-1"
              />
              <Button onClick={goToConfirm}>
                {pisInput ? <Check className="h-4 w-4" /> : "Pular"}
              </Button>
            </div>
          )}

          {step === "confirm" && (
            <div className="flex gap-2">
              <Button onClick={handleGenerate} disabled={isGenerating} className="flex-1 gap-2">
                <Download className="h-4 w-4" />
                {isGenerating ? "Gerando..." : "Gerar Documento"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
