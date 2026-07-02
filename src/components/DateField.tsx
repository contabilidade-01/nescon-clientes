import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export function toInputDateValue(date?: Date) {
  return date ? format(date, "yyyy-MM-dd") : "";
}

export function fromInputDateValue(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

export type DateFieldProps = {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  min?: Date;
  max?: Date;
  id?: string;
};

export function DateField({
  value,
  onChange,
  placeholder = "Selecionar",
  className,
  disabled,
  min,
  max,
  id,
}: DateFieldProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Input
        id={id}
        type="date"
        disabled={disabled}
        value={toInputDateValue(value)}
        min={min ? toInputDateValue(min) : undefined}
        max={max ? toInputDateValue(max) : undefined}
        className={cn("mt-1", className)}
        onChange={(e) => {
          const next = fromInputDateValue(e.target.value);
          if (!next) {
            onChange(undefined);
            return;
          }
          if (min && next < min) return;
          if (max && next > max) return;
          onChange(next);
        }}
      />
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "mt-1 w-full justify-start text-left font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(value, "dd/MM/yyyy", { locale: ptBR }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={onChange}
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
  );
}
