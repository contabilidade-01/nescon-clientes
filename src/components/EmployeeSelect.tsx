import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { maskCPF } from "@/lib/masks";
import { api } from "@/lib/api";

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
  /** Enquanto true, mostra "Carregando..." em vez do aviso de lista vazia. */
  loading?: boolean;
  /**
   * Quando informado, o cliente pode cadastrar ali mesmo quem ainda não está na lista
   * (admissão recente que a folha ainda não trouxe). Recebe o funcionário criado.
   */
  onCreated?: (employee: EmployeeOption) => void;
};

/** Cadastro rápido: só nome e CPF. O escritório unifica com a folha depois. */
function QuickAddEmployee({
  onCreated,
  onCancel,
}: {
  onCreated: (employee: EmployeeOption) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [saving, setSaving] = useState(false);

  const salvar = async () => {
    setSaving(true);
    try {
      const emp = await api.employees.create({ name: name.trim().toUpperCase(), cpf: cpf.trim() });
      toast.success("Funcionário cadastrado");
      onCreated({ id: emp.id, name: emp.name, cpf: emp.cpf });
    } catch (e) {
      toast.error((e as Error).message || "Erro ao cadastrar funcionário");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">
        Entrou há pouco e ainda não aparece? Cadastre aqui — o escritório confirma no próximo
        fechamento da folha.
      </p>
      <Input placeholder="Nome completo" value={name} onChange={(e) => setName(e.target.value)} />
      <Input placeholder="CPF" inputMode="numeric" value={cpf} onChange={(e) => setCpf(maskCPF(e.target.value))} />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={salvar}
          disabled={saving || name.trim().length < 2 || cpf.replace(/\D/g, "").length !== 11}
        >
          <UserPlus className="mr-1 h-4 w-4" /> {saving ? "Cadastrando..." : "Cadastrar"}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}

/** A partir de quantos funcionários o campo de busca aparece. */
const SEARCH_THRESHOLD = 8;

/** Select nativo — estável em Safari/iOS (Radix Select costuma travar a tela no telefone). */
export function EmployeeSelect({
  employees,
  value,
  onChange,
  label = "Selecionar Funcionário *",
  placeholder = "Escolha o funcionário",
  className,
  loading = false,
  onCreated,
}: Props) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const handleCreated = (emp: EmployeeOption) => {
    setAdding(false);
    setQuery("");
    onCreated?.(emp);
    onChange(emp.id);
  };

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return employees;
    const digits = text.replace(/\D/g, "");
    return employees.filter((emp) => {
      const byName = (emp.name ?? "").toLowerCase().includes(text);
      const byCpf =
        digits.length > 0 && String(emp.cpf ?? "").replace(/\D/g, "").includes(digits);
      return byName || byCpf;
    });
  }, [employees, query]);

  // O funcionário já escolhido permanece visível mesmo que a busca o filtre,
  // senão o select nativo mostraria um valor em branco.
  const selected = employees.find((e) => e.id === value);
  const options =
    selected && !filtered.some((e) => e.id === selected.id)
      ? [selected, ...filtered]
      : filtered;

  if (!loading && employees.length === 0) {
    return (
      <div className={className}>
        <Label>{label}</Label>
        {onCreated ? (
          <QuickAddEmployee onCreated={handleCreated} />
        ) : (
        <div className="mt-1 rounded-md border border-dashed bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
          Nenhum funcionário cadastrado.
          <Link
            to="/funcionarios"
            className="mt-1 flex items-center justify-center gap-1 font-medium text-primary underline underline-offset-2"
          >
            <UserPlus className="h-4 w-4" /> Cadastrar funcionários
          </Link>
        </div>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <Label>{label}</Label>
      {employees.length > SEARCH_THRESHOLD && (
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            inputMode="search"
            placeholder="Buscar por nome ou CPF..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      )}
      <select
        className={cn(
          "mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        )}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
      >
        <option value="">
          {loading
            ? "Carregando funcionários..."
            : options.length === 0
              ? "Nenhum resultado para a busca"
              : placeholder}
        </option>
        {options.map((emp) => (
          <option key={emp.id} value={emp.id}>
            {emp.name}
            {emp.cpf ? ` - ${maskCPF(String(emp.cpf))}` : " (CPF pendente)"}
          </option>
        ))}
      </select>
      {!loading && query && options.length > 0 && !value && (
        <p className="mt-1 text-xs text-muted-foreground">
          {options.length === 1
            ? "1 funcionário encontrado — selecione acima."
            : `${options.length} funcionários encontrados — selecione acima.`}
        </p>
      )}
      {onCreated && !loading &&
        (adding ? (
          <QuickAddEmployee onCreated={handleCreated} onCancel={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            onClick={() => setAdding(true)}
          >
            <UserPlus className="h-3.5 w-3.5" /> Não está na lista? Cadastrar funcionário
          </button>
        ))}
    </div>
  );
}
