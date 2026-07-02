import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { maskCPF } from "@/lib/masks";

export type EmployeeOption = {
  id: string;
  name: string;
  cpf: string;
};

type Props = {
  employees: EmployeeOption[];
  value: string;
  onChange: (employeeId: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
};

/** Select nativo — estável em Safari/iOS (Radix Select costuma travar a tela no telefone). */
export function EmployeeSelect({
  employees,
  value,
  onChange,
  label = "Selecionar Funcionário *",
  placeholder = "Escolha o funcionário",
  className,
}: Props) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <select
        className={cn(
          "mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        )}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {employees.map((emp) => (
          <option key={emp.id} value={emp.id}>
            {emp.name} - {maskCPF(String(emp.cpf || ""))}
          </option>
        ))}
      </select>
    </div>
  );
}
