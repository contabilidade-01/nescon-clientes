import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { maskCPF } from "@/lib/masks";

/** Funcionário digitado à mão (link avulso): nome obrigatório, CPF opcional. */
export function FuncionarioManual({
  nome,
  cpf,
  onNome,
  onCpf,
}: {
  nome: string;
  cpf: string;
  onNome: (v: string) => void;
  onCpf: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="av-func-nome">Nome do funcionário *</Label>
        <Input
          id="av-func-nome"
          placeholder="Nome completo"
          autoComplete="off"
          value={nome}
          onChange={(e) => onNome(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="av-func-cpf">
          CPF <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id="av-func-cpf"
          inputMode="numeric"
          placeholder="000.000.000-00"
          autoComplete="off"
          value={maskCPF(cpf)}
          onChange={(e) => onCpf(e.target.value.replace(/\D/g, "").slice(0, 11))}
          className="mt-1"
        />
        <p className="mt-1 text-xs text-muted-foreground">Sem CPF, o documento sai com o campo em branco para preencher à mão.</p>
      </div>
    </div>
  );
}
