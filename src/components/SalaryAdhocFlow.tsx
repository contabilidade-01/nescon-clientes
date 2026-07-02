import { useState, useEffect, useRef } from "react";
import { Check, X, RefreshCw, Download } from "lucide-react";
import { format, startOfMonth, parse } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/DateField";
import { MultiDateField } from "@/components/MultiDateField";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  calculateAdhocSalary,
  formatBRL,
  parseMoneyBR,
  type PeriodMode,
  type AdhocSalaryResult,
} from "@/lib/calculateAdhocSalary";
import { ADHOC_VALE_COMPOSITE_LABEL, downloadAdhocPayslipPdf } from "@/lib/generateAdhocPayslipPdf";
import { toast } from "sonner";

function periodModeLabel(m: PeriodMode): string {
  switch (m) {
    case "worked_days":
      return "Quantidade de dias informada";
    case "start_in_month":
      return "Início no mês (até o fim do mês, corridos)";
    case "closed_month":
      return "Mês fechado (30 dias de provento; faltas descontam à parte)";
  }
}

type Step =
  | "employee_name"
  | "base_salary"
  | "period_mode"
  | "ref_month"
  | "worked_days_input"
  | "start_date_pick"
  | "absences"
  | "vale"
  | "outros"
  | "result";

interface Message {
  from: "bot" | "user";
  text: string;
}

export function SalaryAdhocFlow() {
  const { company } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [step, setStep] = useState<Step>("employee_name");

  const [employeeName, setEmployeeName] = useState("");
  const [baseSalaryRaw, setBaseSalaryRaw] = useState("");
  const [periodMode, setPeriodMode] = useState<PeriodMode | null>(null);
  const [refMonthStr, setRefMonthStr] = useState("");
  const [workedDays, setWorkedDays] = useState(1);
  const [startDateInMonth, setStartDateInMonth] = useState<Date | undefined>();
  const [faltaDates, setFaltaDates] = useState<Date[]>([]);
  const [valeRaw, setValeRaw] = useState("");
  const [outrosRaw, setOutrosRaw] = useState("");
  const [result, setResult] = useState<AdhocSalaryResult | null>(null);

  const addBot = (text: string) => setMessages((m) => [...m, { from: "bot", text }]);
  const addUser = (text: string) => setMessages((m) => [...m, { from: "user", text }]);

  useEffect(() => {
    addBot(
      "Cálculo de salário avulso (experiência / treino, sem cadastro obrigatório).\n\n" +
        "Indique o nome do funcionário para começar."
    );
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, step, result]);

  const refMonthDate = refMonthStr
    ? startOfMonth(parse(`${refMonthStr}-01`, "yyyy-MM-dd", new Date()))
    : undefined;

  const monthBounds = refMonthDate
    ? {
        start: startOfMonth(refMonthDate),
        end: new Date(refMonthDate.getFullYear(), refMonthDate.getMonth() + 1, 0),
      }
    : null;

  const submitName = () => {
    const n = employeeName.trim();
    if (n.length < 2) {
      toast.error("Nome muito curto");
      return;
    }
    addUser(n);
    addBot("Qual o salário base mensal (contratual), em reais?");
    setStep("base_salary");
  };

  const submitBaseSalary = () => {
    const v = parseMoneyBR(baseSalaryRaw);
    if (v == null || v <= 0) {
      toast.error("Informe um valor válido (ex.: 3000 ou 3.000,50)");
      return;
    }
    addUser(formatBRL(v));
    addBot(
      "Como calcular os dias do período?\n\n" +
        "• Dias trabalhados: você informa quantos dias entram no provento\n" +
        "• Início no mês: dias corridos do início até o fim do mês de referência\n" +
        "• Mês fechado: 30 dias de provento (as faltas marcam desconto à parte, não mudam o bruto)"
    );
    setStep("period_mode");
  };

  const selectMode = (mode: PeriodMode) => {
    setPeriodMode(mode);
    if (mode === "worked_days") {
      addUser("Dias trabalhados (informo a quantidade)");
    } else if (mode === "start_in_month") {
      addUser("Data de início no mês de referência");
    } else {
      addUser("Mês fechado (30 dias)");
    }
    addBot("Qual o mês de referência da folha? (ano-mês)");
    setStep("ref_month");
  };

  const submitRefMonth = () => {
    if (!refMonthStr || refMonthStr.length < 7) {
      toast.error("Selecione o mês de referência");
      return;
    }
    const label = format(parse(`${refMonthStr}-01`, "yyyy-MM-dd", new Date()), "MMMM/yyyy", { locale: ptBR });
    addUser(label.charAt(0).toUpperCase() + label.slice(1));
    if (periodMode === "worked_days") {
      addBot("Quantos dias de salário devem ser pagos nesse período? (1 a 31)");
      setStep("worked_days_input");
    } else if (periodMode === "start_in_month") {
      addBot("Em que dia o funcionário começou a trabalhar nesse mês?");
      setStep("start_date_pick");
    } else {
      addBot(
        "Marque os dias de falta, se houver. Cada falta gera desconto de um dia (valor/dia); o bruto segue os 30 dias de provento. Pode avançar sem marcar."
      );
      setStep("absences");
    }
  };

  const submitWorkedDays = () => {
    const d = Math.min(31, Math.max(1, Math.floor(workedDays)));
    setWorkedDays(d);
    addUser(`${d} dia(s)`);
    addBot(
      "Marque no calendário os dias de falta (cada um desconta um valor/dia sobre o bruto). Não pode haver mais faltas que dias do período. Pode avançar sem marcar."
    );
    setStep("absences");
  };

  const submitStartDate = () => {
    if (!startDateInMonth) {
      toast.error("Escolha a data de início");
      return;
    }
    addUser(format(startDateInMonth, "dd/MM/yyyy", { locale: ptBR }));
    addBot(
      "Marque os dias de falta (cada um desconta um valor/dia). Não pode haver mais faltas que dias do período. Pode avançar sem marcar."
    );
    setStep("absences");
  };

  const submitAbsences = () => {
    if (faltaDates.length > 0) {
      const txt = [...faltaDates]
        .sort((a, b) => a.getTime() - b.getTime())
        .map((d) => format(d, "dd/MM/yyyy", { locale: ptBR }))
        .join(", ");
      addUser(`Faltas: ${txt}`);
    } else {
      addUser("Sem faltas");
    }
    addBot(
      `**${ADHOC_VALE_COMPOSITE_LABEL}** (R$) — valor total a descontar. Se não houver, digite **0** e confirme.`
    );
    setStep("vale");
  };

  const submitVale = () => {
    const parsed = parseMoneyBR(valeRaw || "0");
    if (parsed == null) {
      toast.error("Valor de vale inválido");
      return;
    }
    addUser(formatBRL(parsed));
    addBot("Outros descontos (R$)? 0 se não houver.");
    setStep("outros");
  };

  const submitOutros = () => {
    const o = parseMoneyBR(outrosRaw || "0");
    if (o == null) {
      toast.error("Valor de outros descontos inválido");
      return;
    }
    addUser(formatBRL(o));

    if (!periodMode || !refMonthDate) {
      toast.error("Dados incompletos");
      return;
    }
    const base = parseMoneyBR(baseSalaryRaw);
    if (base == null) {
      toast.error("Salário base inválido");
      return;
    }

    const wd = Math.min(31, Math.max(1, Math.floor(workedDays)));
    const out = calculateAdhocSalary({
      salarioBase: base,
      modo: periodMode,
      diasTrabalhadosInformado: periodMode === "worked_days" ? wd : null,
      refMonth: refMonthDate,
      dataInicioNoMes: periodMode === "start_in_month" ? startDateInMonth ?? null : null,
      faltas: faltaDates,
      descontoVale: parseMoneyBR(valeRaw || "0") ?? 0,
      descontosOutros: o,
    });

    if (!out.ok) {
      toast.error(out.error);
      return;
    }
    setResult(out.data);
    const r = out.data;
    addBot(
      `**Resultado**\n` +
        `• Funcionário: ${employeeName.trim()}\n` +
        `• Salário base **contratual** (mês cheio, referência): ${formatBRL(base)}\n` +
        `• Valor de um dia (base ÷ 30): ${formatBRL(r.valorDia)}\n` +
        `• Dias de provento (3.1 / 3.2 / 3.3): **${r.diasBrutos}** · Faltas: **${r.faltasCount}** (ref.: dias após faltas = ${r.diasLiquidos})\n` +
        `• **Bruto** (valor/dia × dias de provento, **sem** embutir faltas): ${formatBRL(r.bruto)}\n` +
        `• **Desconto por faltas** (valor/dia × faltas): ${formatBRL(r.descontoFaltas)}\n` +
        `• ${ADHOC_VALE_COMPOSITE_LABEL}: ${formatBRL(r.descontoVale)}\n` +
        `• Outros descontos: ${formatBRL(r.descontosOutros)}\n` +
        `• **Líquido: ${formatBRL(r.liquido)}**\n\n` +
        `_Bruto conforme o modo escolhido; faltas entram só como desconto monetário._\n` +
        `_Cálculo simplificado; confira com DP / contabilidade._`
    );
    if (company) {
      addBot(`Empresa: ${company.name}`);
    }
    setStep("result");
  };

  const handleDownloadPayslip = async () => {
    if (!result || !periodMode || !refMonthStr || !refMonthDate) {
      toast.error("Dados incompletos para o recibo");
      return;
    }
    const base = parseMoneyBR(baseSalaryRaw);
    if (base == null) {
      toast.error("Salário base inválido");
      return;
    }
    const faltaDatesText =
      faltaDates.length > 0
        ? [...faltaDates]
            .sort((a, b) => a.getTime() - b.getTime())
            .map((d) => format(d, "dd/MM/yyyy", { locale: ptBR }))
            .join(", ")
        : "";
    const refTitleRaw = format(refMonthDate, "MMMM 'de' yyyy", { locale: ptBR });
    const refMonthTitle = refTitleRaw.charAt(0).toUpperCase() + refTitleRaw.slice(1);
    try {
      await downloadAdhocPayslipPdf({
        companyName: company?.name ?? "",
        companyCnpjDigits: company?.cnpj ?? "",
        refMonthTitle,
        employeeName: employeeName.trim(),
        employeeCode: "—",
        salarioBase: base,
        diasBrutos: result.diasBrutos,
        faltasCount: result.faltasCount,
        diasLiquidos: result.diasLiquidos,
        descontoFaltas: result.descontoFaltas,
        valorDia: result.valorDia,
        bruto: result.bruto,
        vale: result.descontoVale,
        outros: result.descontosOutros,
        liquido: result.liquido,
        faltaDatesText,
        modoDescricao: periodModeLabel(periodMode),
      });
      toast.success("Recibo baixado (PDF)");
    } catch {
      toast.error("Não foi possível gerar o recibo");
    }
  };

  const resetNewCalculation = () => {
    setEmployeeName("");
    setBaseSalaryRaw("");
    setPeriodMode(null);
    setRefMonthStr("");
    setWorkedDays(1);
    setStartDateInMonth(undefined);
    setFaltaDates([]);
    setValeRaw("");
    setOutrosRaw("");
    setResult(null);
    setStep("employee_name");
    setMessages([{ from: "bot", text: "Novo cálculo. Indique o nome do funcionário." }]);
  };

  const isDateInRefMonth = (d: Date) =>
    monthBounds
      ? d >= monthBounds.start && d <= monthBounds.end
      : true;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
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

        <div className="pt-2 pb-6">
          {step === "employee_name" && (
            <div className="flex gap-2">
              <Input
                placeholder="Nome completo do funcionário"
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && submitName()}
              />
              <Button onClick={submitName}>
                <Check className="h-4 w-4" />
              </Button>
            </div>
          )}

          {step === "base_salary" && (
            <div className="space-y-2">
              <Input
                placeholder="Ex.: 3000 ou 3.000,50"
                value={baseSalaryRaw}
                onChange={(e) => setBaseSalaryRaw(e.target.value)}
                inputMode="decimal"
              />
              <Button onClick={submitBaseSalary} className="w-full">
                Continuar
              </Button>
            </div>
          )}

          {step === "period_mode" && (
            <div className="flex flex-col gap-2">
              <Button onClick={() => selectMode("worked_days")} className="w-full">
                3.1 · Quantidade de dias trabalhados
              </Button>
              <Button onClick={() => selectMode("start_in_month")} variant="secondary" className="w-full">
                3.2 · Data de início no mês de referência
              </Button>
              <Button onClick={() => selectMode("closed_month")} variant="outline" className="w-full">
                3.3 · Mês fechado (30 dias de provento)
              </Button>
            </div>
          )}

          {step === "ref_month" && (
            <div className="space-y-2">
              <Label className="text-xs">Mês de referência</Label>
              <Input
                type="month"
                value={refMonthStr}
                onChange={(e) => setRefMonthStr(e.target.value)}
              />
              <Button onClick={submitRefMonth} disabled={!refMonthStr} className="w-full">
                Continuar
              </Button>
            </div>
          )}

          {step === "worked_days_input" && (
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                max={31}
                value={workedDays}
                onChange={(e) => setWorkedDays(parseInt(e.target.value, 10) || 1)}
                className="flex-1"
              />
              <Button onClick={submitWorkedDays}>
                <Check className="h-4 w-4" />
              </Button>
            </div>
          )}

          {step === "start_date_pick" && monthBounds && (
            <div className="space-y-2">
              <DateField
                value={startDateInMonth}
                onChange={(d) => d && isDateInRefMonth(d) && setStartDateInMonth(d)}
                min={monthBounds.start}
                max={monthBounds.end}
                placeholder="Data de início no mês"
                className="mt-0"
              />
              <Button onClick={submitStartDate} disabled={!startDateInMonth} className="w-full">
                Continuar
              </Button>
            </div>
          )}

          {step === "absences" && refMonthDate && monthBounds && (
            <div className="space-y-2">
              <MultiDateField
                value={faltaDates}
                onChange={setFaltaDates}
                placeholder="Marcar dias de falta (opcional)"
                min={monthBounds.start}
                max={monthBounds.end}
                defaultMonth={refMonthDate}
              />
              <p className="text-xs text-muted-foreground">
                Dias marcados:{" "}
                {[...faltaDates]
                  .sort((a, b) => a.getTime() - b.getTime())
                  .map((d) => format(d, "dd/MM/yyyy", { locale: ptBR }))
                  .join(", ") || "—"}
              </p>
              <Button onClick={submitAbsences} className="w-full">
                Continuar
              </Button>
            </div>
          )}

          {step === "vale" && (
            <div className="space-y-2">
              <Input
                placeholder={`${ADHOC_VALE_COMPOSITE_LABEL} — R$ (0 se não houver)`}
                value={valeRaw}
                onChange={(e) => setValeRaw(e.target.value)}
                inputMode="decimal"
              />
              <Button onClick={submitVale} className="w-full">
                Confirmar
              </Button>
            </div>
          )}

          {step === "outros" && (
            <div className="space-y-2">
              <Input
                placeholder="0,00"
                value={outrosRaw}
                onChange={(e) => setOutrosRaw(e.target.value)}
                inputMode="decimal"
              />
              <Button onClick={submitOutros} className="w-full">
                Calcular líquido
              </Button>
            </div>
          )}

          {step === "result" && result && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <p className="text-sm font-semibold">Resumo numérico</p>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>Salário base (contratual): {formatBRL(parseMoneyBR(baseSalaryRaw) ?? 0)}</li>
                <li>Bruto (dias de provento): {formatBRL(result.bruto)}</li>
                {result.descontoFaltas > 0 && (
                  <li>Desconto faltas ({result.faltasCount}): {formatBRL(result.descontoFaltas)}</li>
                )}
                <li>Líquido: {formatBRL(result.liquido)}</li>
              </ul>
              <Button className="w-full gap-2" onClick={handleDownloadPayslip}>
                <Download className="h-4 w-4" />
                Baixar recibo (PDF)
              </Button>
              <Button variant="outline" className="w-full gap-2" onClick={resetNewCalculation}>
                <RefreshCw className="h-4 w-4" />
                Novo cálculo
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
