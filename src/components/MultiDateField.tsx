import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { fromInputDateValue, toInputDateValue } from "@/components/DateField";

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export type MultiDateFieldProps = {
  value: Date[];
  onChange: (dates: Date[]) => void;
  placeholder?: string;
  className?: string;
  min?: Date;
  max?: Date;
  defaultMonth?: Date;
};

export function MultiDateField({
  value,
  onChange,
  placeholder = "Selecionar datas",
  className,
  min,
  max,
  defaultMonth,
}: MultiDateFieldProps) {
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState("");

  const sorted = [...value].sort((a, b) => a.getTime() - b.getTime());

  const removeDate = (date: Date) => {
    onChange(value.filter((v) => !sameDay(v, date)));
  };

  const addDraftDate = () => {
    const next = fromInputDateValue(draft);
    if (!next) return;
    if (min && next < min) return;
    if (max && next > max) return;
    if (value.some((v) => sameDay(v, next))) return;
    onChange([...value, next]);
    setDraft("");
  };

  if (isMobile) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex gap-2">
          <Input
            type="date"
            value={draft}
            min={min ? toInputDateValue(min) : undefined}
            max={max ? toInputDateValue(max) : undefined}
            className="flex-1"
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="button" variant="outline" onClick={addDraftDate} disabled={!draft}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {sorted.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {sorted.map((d) => (
              <Badge key={d.getTime()} variant="secondary" className="text-xs">
                {format(d, "dd/MM/yyyy", { locale: ptBR })}
                <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => removeDate(d)} />
              </Badge>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn("w-full justify-start", value.length === 0 && "text-muted-foreground")}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value.length > 0
              ? `${value.length} data${value.length > 1 ? "s" : ""} selecionada${value.length > 1 ? "s" : ""}`
              : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="multiple"
            defaultMonth={defaultMonth}
            selected={value}
            onSelect={(dates) => onChange(dates || [])}
            disabled={
              min || max
                ? (d) => {
                    if (!d) return false;
                    if (min && d < min) return true;
                    if (max && d > max) return true;
                    return false;
                  }
                : undefined
            }
            locale={ptBR}
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
      {sorted.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {sorted.map((d) => (
            <Badge key={d.getTime()} variant="secondary" className="text-xs">
              {format(d, "dd/MM/yyyy", { locale: ptBR })}
              <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => removeDate(d)} />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
