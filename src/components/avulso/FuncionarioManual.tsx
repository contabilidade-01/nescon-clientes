import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { maskCPF } from "@/lib/masks";

const OUTRO = "__outro__";

/**
 * Funcionário no link avulso: escolhe da lista da empresa (só nomes, vinda pelo CNPJ)
 * ou digita o nome completo à mão. CPF é sempre opcional e digitado: a lista não traz CPF.
 */
export function FuncionarioManual({
  nomes,
  nome,
  cpf,
  onNome,
  onCpf,
}: {
  nomes?: string[];
  nome: string;
  cpf: string;
  onNome: (v: string) => void;
  onCpf: (v: string) => void;
}) {
  const lista = nomes ?? [];
  const temLista = lista.length > 0;
  const escolhido = lista.includes(nome.trim()) ? nome.trim() : nome.trim() ? OUTRO : "";

  return (
    <div className="space-y-3">
      {temLista && (
        <div>
          <Label htmlFor="av-func-lista">Funcionário da empresa</Label>
          <Select
            value={escolhido || undefined}
            onValueChange={(v) => {
              onNome(v === OUTRO ? "" : v);
              onCpf("");
            }}
          >
            <SelectTrigger id="av-func-lista" className="mt-1">
              <SelectValue placeholder={`Escolha na lista (${lista.length})`} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {lista.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
              <SelectItem value={OUTRO}>Não está na lista: digitar o nome</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div>
        <Label htmlFor="av-func-nome">{temLista ? "Nome completo *" : "Nome do funcionário *"}</Label>
        <Input
          id="av-func-nome"
          placeholder="Nome completo"
          autoComplete="off"
          value={nome}
          onChange={(e) => onNome(e.target.value)}
          className="mt-1"
        />
        {temLista && (
          <p className="mt-1 text-xs text-muted-foreground">
            Preenchido ao escolher na lista. Se o funcionário não aparece, digite o nome completo aqui.
          </p>
        )}
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
