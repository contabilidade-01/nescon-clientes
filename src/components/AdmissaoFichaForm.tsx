import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { maskCNPJ, maskCPF } from "@/lib/masks";
import { cn } from "@/lib/utils";
import {
  JORNADA_PRESETS,
  OPCOES,
  UFS,
  type AdmissionDados,
  type AdmissionAnexo,
} from "@/lib/admissionFicha";

function maskCepLocal(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

type Props = {
  dados: AdmissionDados;
  onDados: (next: AdmissionDados) => void;
  empresaCnpj: string;
  empresaNome: string;
  contatoEmail: string;
  contatoTelefone: string;
  onEmpresa: (p: {
    empresaCnpj?: string;
    empresaNome?: string;
    contatoEmail?: string;
    contatoTelefone?: string;
  }) => void;
  cnpjLocked?: boolean;
  exigirContatoExterno?: boolean;
  lookupHint?: string | null;
  onCnpjBlur?: () => void;
  anexos?: AdmissionAnexo[];
  pendingFiles: File[];
  onPendingFiles: (files: File[]) => void;
};

const Field = ({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={className ?? "space-y-1.5"}>
    <Label className="text-xs text-muted-foreground">{label}</Label>
    {children}
  </div>
);

function NativeSelect({
  value,
  onChange,
  options,
  placeholder = "Selecione",
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  const opts = value && !(options as readonly string[]).includes(value) ? [value, ...options] : [...options];
  return (
    <select
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function DocItem({
  checked,
  onChange,
  children,
  obrigatorio,
  aplicavel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  obrigatorio?: boolean;
  aplicavel?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      <span>
        {children}
        {obrigatorio && <span className="ml-1 text-xs font-semibold text-destructive">Obrigatório</span>}
        {aplicavel && <span className="ml-1 text-xs text-muted-foreground">quando aplicável</span>}
      </span>
    </label>
  );
}

export function AdmissaoFichaForm({
  dados,
  onDados,
  empresaCnpj,
  empresaNome,
  contatoEmail,
  contatoTelefone,
  onEmpresa,
  cnpjLocked,
  exigirContatoExterno,
  lookupHint,
  onCnpjBlur,
  anexos = [],
  pendingFiles,
  onPendingFiles,
}: Props) {
  const set = (patch: Partial<AdmissionDados>) => onDados({ ...dados, ...patch });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">Empresa</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="CNPJ *">
            <Input
              value={maskCNPJ(empresaCnpj)}
              disabled={cnpjLocked}
              onChange={(e) => onEmpresa({ empresaCnpj: e.target.value.replace(/\D/g, "").slice(0, 14) })}
              onBlur={onCnpjBlur}
              inputMode="numeric"
            />
          </Field>
          <Field label="Razão social *">
            <Input value={empresaNome} onChange={(e) => onEmpresa({ empresaNome: e.target.value })} />
          </Field>
        </div>
        {lookupHint && <p className="text-xs text-muted-foreground">{lookupHint}</p>}
        {exigirContatoExterno && (
          <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="sm:col-span-2 text-xs text-amber-800 dark:text-amber-200">
              Este CNPJ não está na carteira da Nescon. Informe e-mail e telefone da empresa para o
              escritório entrar em contato.
            </p>
            <Field label="E-mail da empresa *">
              <Input
                type="email"
                value={contatoEmail}
                onChange={(e) => onEmpresa({ contatoEmail: e.target.value })}
              />
            </Field>
            <Field label="Telefone da empresa *">
              <Input
                value={contatoTelefone}
                onChange={(e) => onEmpresa({ contatoTelefone: e.target.value })}
              />
            </Field>
          </div>
        )}
        {!exigirContatoExterno && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="E-mail (opcional)">
              <Input
                type="email"
                value={contatoEmail}
                onChange={(e) => onEmpresa({ contatoEmail: e.target.value })}
              />
            </Field>
            <Field label="Telefone (opcional)">
              <Input
                value={contatoTelefone}
                onChange={(e) => onEmpresa({ contatoTelefone: e.target.value })}
              />
            </Field>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">Documentos para envio</h2>
        <p className="text-xs text-muted-foreground">
          Base CLT, eSocial (S-2200) e NR-7. Marque o que já está em mãos. Os itens obrigatórios
          precisam estar marcados para salvar.
        </p>
        <p className="text-xs font-medium">Obrigatórios</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <DocItem obrigatorio checked={dados.docLivro} onChange={(v) => set({ docLivro: v })}>
            Livro de Registro ou Ficha de Registro
          </DocItem>
          <DocItem obrigatorio checked={dados.docCtps} onChange={(v) => set({ docCtps: v })}>
            CTPS digital
          </DocItem>
          <DocItem obrigatorio checked={dados.docAso} onChange={(v) => set({ docAso: v })}>
            Atestado médico admissional (ASO)
          </DocItem>
          <DocItem obrigatorio checked={dados.docCpf} onChange={(v) => set({ docCpf: v })}>
            Cópia do CPF
          </DocItem>
          <DocItem obrigatorio checked={dados.docRg} onChange={(v) => set({ docRg: v })}>
            Cópia da identidade (RG ou CNH)
          </DocItem>
          <DocItem obrigatorio checked={dados.docComprovante} onChange={(v) => set({ docComprovante: v })}>
            Comprovante de residência com CEP
          </DocItem>
          <DocItem obrigatorio checked={dados.docPis} onChange={(v) => set({ docPis: v })}>
            Cadastro do PIS (cartão ou extrato ativo da Caixa)
          </DocItem>
        </div>
        <p className="text-xs font-medium">Quando aplicável</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <DocItem aplicavel checked={dados.docTitulo} onChange={(v) => set({ docTitulo: v })}>
            Título de eleitor
          </DocItem>
          <DocItem aplicavel checked={dados.docReservistaCopia} onChange={(v) => set({ docReservistaCopia: v })}>
            Carteira de reservista (homem)
          </DocItem>
          <DocItem aplicavel checked={dados.docCertidaoCivil} onChange={(v) => set({ docCertidaoCivil: v })}>
            Certidão de casamento ou nascimento (solteiro)
          </DocItem>
        </div>
        <p className="text-xs font-medium">Opcional</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <DocItem checked={dados.docFoto} onChange={(v) => set({ docFoto: v })}>
            Foto 3x4
          </DocItem>
          <DocItem checked={dados.docCopias} onChange={(v) => set({ docCopias: v })}>
            CTPS parte da foto e verso
          </DocItem>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={dados.temFilhos} onCheckedChange={(c) => set({ temFilhos: c === true })} />
          <span>
            Possui filhos menores de 14 anos ou com deficiência (enviar certidão de nascimento; vacina
            para menores de 5 anos; regularidade escolar para maiores de 7 anos)
          </span>
        </label>
        {dados.temFilhos && (
          <div className="ml-6 grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={dados.filhoDeficiente} onCheckedChange={(c) => set({ filhoDeficiente: c === true })} />
              Filho com deficiência
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={dados.filhoCertidao} onCheckedChange={(c) => set({ filhoCertidao: c === true })} />
              Certidão de nascimento
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={dados.filhoVacina} onCheckedChange={(c) => set({ filhoVacina: c === true })} />
              Cartão de vacina (&lt; 5 anos)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={dados.filhoEscolaridade}
                onCheckedChange={(c) => set({ filhoEscolaridade: c === true })}
              />
              Regularidade escolar (&gt; 7 anos)
            </label>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">Dados cadastrais</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="1. Nome *" className="space-y-1.5 sm:col-span-2">
            <Input value={dados.nome} onChange={(e) => set({ nome: e.target.value })} />
          </Field>
          <Field label="2. Endereço *" className="space-y-1.5 sm:col-span-2">
            <Input value={dados.endereco} onChange={(e) => set({ endereco: e.target.value })} />
          </Field>
          <Field label="3. Cidade *">
            <Input value={dados.cidade} onChange={(e) => set({ cidade: e.target.value })} />
          </Field>
          <Field label="CEP *">
            <Input value={maskCepLocal(dados.cep)} onChange={(e) => set({ cep: e.target.value.replace(/\D/g, "").slice(0, 8) })} />
          </Field>
          <Field label="4. Nacionalidade *">
            <NativeSelect value={dados.nacionalidade} onChange={(v) => set({ nacionalidade: v })} options={OPCOES.nacionalidade} />
          </Field>
          <Field label="Sexo">
            <NativeSelect value={dados.sexo} onChange={(v) => set({ sexo: v })} options={OPCOES.sexo} />
          </Field>
          <Field label="5. Data de nascimento *">
            <Input type="date" value={dados.nascimento} onChange={(e) => set({ nascimento: e.target.value })} />
          </Field>
          <Field label="6. Identidade *">
            <Input value={dados.identidade} onChange={(e) => set({ identidade: e.target.value })} />
          </Field>
          <Field label="Órgão emissor">
            <NativeSelect value={dados.identidadeOrgao} onChange={(v) => set({ identidadeOrgao: v })} options={OPCOES.identidadeOrgao} />
          </Field>
          <Field label="Local de atendimento">
            <Input value={dados.identidadeLocal} onChange={(e) => set({ identidadeLocal: e.target.value })} />
          </Field>
          <Field label="Data de emissão">
            <Input type="date" value={dados.identidadeEmissao} onChange={(e) => set({ identidadeEmissao: e.target.value })} />
          </Field>
          <Field label="Tel.">
            <Input value={dados.telefone} onChange={(e) => set({ telefone: e.target.value })} />
          </Field>
          <Field label="7. CPF *">
            <Input value={maskCPF(dados.cpf)} onChange={(e) => set({ cpf: e.target.value.replace(/\D/g, "").slice(0, 11) })} />
          </Field>
          <Field label="8. Título de eleitor">
            <Input value={dados.titulo} onChange={(e) => set({ titulo: e.target.value })} />
          </Field>
          <Field label="Zona">
            <Input value={dados.tituloZona} onChange={(e) => set({ tituloZona: e.target.value })} />
          </Field>
          <Field label="Seção">
            <Input value={dados.tituloSecao} onChange={(e) => set({ tituloSecao: e.target.value })} />
          </Field>
          <Field label="UF">
            <NativeSelect value={dados.tituloUf} onChange={(v) => set({ tituloUf: v })} options={UFS} placeholder="UF" />
          </Field>
          <Field label="9. Carteira de reservista">
            <Input value={dados.reservista} onChange={(e) => set({ reservista: e.target.value })} />
          </Field>
          <Field label="Categoria">
            <NativeSelect value={dados.reservistaCategoria} onChange={(v) => set({ reservistaCategoria: v })} options={OPCOES.reservistaCategoria} />
          </Field>
          <Field label="UF reservista">
            <NativeSelect value={dados.reservistaUf} onChange={(v) => set({ reservistaUf: v })} options={UFS} placeholder="UF" />
          </Field>
          <Field label="10. CTPS digital — número">
            <Input value={dados.ctpsNumero} onChange={(e) => set({ ctpsNumero: e.target.value })} />
          </Field>
          <Field label="Série">
            <Input value={dados.ctpsSerie} onChange={(e) => set({ ctpsSerie: e.target.value })} />
          </Field>
          <Field label="UF CTPS">
            <NativeSelect value={dados.ctpsUf} onChange={(v) => set({ ctpsUf: v })} options={UFS} placeholder="UF" />
          </Field>
          <Field label="Data emissão CTPS">
            <Input type="date" value={dados.ctpsEmissao} onChange={(e) => set({ ctpsEmissao: e.target.value })} />
          </Field>
          <Field label="11. PIS/PASEP">
            <Input value={dados.pis} onChange={(e) => set({ pis: e.target.value })} />
          </Field>
          <Field label="12. Filiação — pai">
            <Input value={dados.pai} onChange={(e) => set({ pai: e.target.value })} />
          </Field>
          <Field label="Mãe">
            <Input value={dados.mae} onChange={(e) => set({ mae: e.target.value })} />
          </Field>
          <Field label="13. Estado civil *">
            <NativeSelect value={dados.estadoCivil} onChange={(v) => set({ estadoCivil: v })} options={OPCOES.estadoCivil} />
          </Field>
          <Field label="Cônjuge">
            <Input value={dados.conjuge} onChange={(e) => set({ conjuge: e.target.value })} />
          </Field>
          <Field label="14. Grau de instrução *">
            <NativeSelect value={dados.grauInstrucao} onChange={(v) => set({ grauInstrucao: v })} options={OPCOES.grauInstrucao} />
          </Field>
          <Field label="Completo / incompleto">
            <NativeSelect
              value={dados.grauCompleto === "completo" ? "Completo" : dados.grauCompleto === "incompleto" ? "Incompleto / cursando" : ""}
              onChange={(v) =>
                set({
                  grauCompleto: v.startsWith("Completo") ? "completo" : v ? "incompleto" : "",
                })
              }
              options={["Completo", "Incompleto / cursando"]}
            />
          </Field>
          <Field label="15. Declaração de cor/raça *">
            <NativeSelect value={dados.corRaca} onChange={(v) => set({ corRaca: v })} options={OPCOES.corRaca} />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">Informações do empregador para a admissão</h2>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">1. Emprego *</Label>
          <NativeSelect
            value={dados.primeiroEmprego === "primeiro" ? "É 1º emprego" : dados.primeiroEmprego === "outro" ? "Já teve outro emprego" : ""}
            onChange={(v) =>
              set({
                primeiroEmprego: v.startsWith("É 1º") ? "primeiro" : v ? "outro" : "",
              })
            }
            options={["É 1º emprego", "Já teve outro emprego"]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="2. Data de admissão *">
            <Input type="date" value={dados.dataAdmissao} onChange={(e) => set({ dataAdmissao: e.target.value })} />
          </Field>
          <Field label="3. Salário *">
            <Input value={dados.salario} onChange={(e) => set({ salario: e.target.value })} />
          </Field>
          <Field label="Função *">
            <Input value={dados.funcao} onChange={(e) => set({ funcao: e.target.value })} />
          </Field>
          <Field label="5. Contrato de experiência">
            <NativeSelect value={dados.contratoExperiencia} onChange={(v) => set({ contratoExperiencia: v })} options={OPCOES.contratoExperiencia} />
          </Field>
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-medium">4. Jornada — escolha um modelo (pode editar depois)</p>
          <div className="flex flex-wrap gap-2">
            {JORNADA_PRESETS.map((p) => (
              <Button
                key={p.id}
                type="button"
                size="sm"
                variant={dados.jornadaPreset === p.id ? "default" : "outline"}
                onClick={() => set(p.fields)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Carga horária mensal">
              <Input value={dados.cargaMensal} onChange={(e) => set({ cargaMensal: e.target.value, jornadaPreset: "personalizado" })} />
            </Field>
            <Field label="Carga horária semanal">
              <Input value={dados.cargaSemanal} onChange={(e) => set({ cargaSemanal: e.target.value, jornadaPreset: "personalizado" })} />
            </Field>
            <Field label="Dia de folga">
              <NativeSelect
                value={dados.diaFolga}
                onChange={(v) => set({ diaFolga: v, jornadaPreset: "personalizado" })}
                options={OPCOES.diaFolga}
              />
            </Field>
            <Field label="Intervalo">
              <NativeSelect
                value={dados.intervalo}
                onChange={(v) => set({ intervalo: v, jornadaPreset: "personalizado" })}
                options={OPCOES.intervalo}
              />
            </Field>
            <Field label="7. Horário de entrada">
              <Input type="time" value={dados.horarioEntrada} onChange={(e) => set({ horarioEntrada: e.target.value, jornadaPreset: "personalizado" })} />
            </Field>
            <Field label="Horário de saída">
              <Input type="time" value={dados.horarioSaida} onChange={(e) => set({ horarioSaida: e.target.value, jornadaPreset: "personalizado" })} />
            </Field>
            <Field label="Observação da escala" className="space-y-1.5 sm:col-span-2">
              <Textarea
                rows={2}
                value={dados.jornadaObs}
                onChange={(e) => set({ jornadaObs: e.target.value, jornadaPreset: "personalizado" })}
              />
            </Field>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            6. Desconto de vale-transporte * — 6% do salário base, conforme CLT
          </Label>
          <NativeSelect
            value={dados.valeTransporte === "sim" ? "SIM" : dados.valeTransporte === "nao" ? "NÃO" : ""}
            onChange={(v) => set({ valeTransporte: v === "SIM" ? "sim" : v === "NÃO" ? "nao" : "" })}
            options={["SIM", "NÃO"]}
          />
        </div>
        <Field label="8. Data do documento ASO (exame admissional) *">
          <Input type="date" value={dados.asoData} onChange={(e) => set({ asoData: e.target.value })} />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">Anexos (opcional)</h2>
        <p className="text-xs text-muted-foreground">PDF ou imagem, até 10 MB cada. Enviados ao salvar.</p>
        <Input
          type="file"
          multiple
          accept="application/pdf,image/*"
          onChange={(e) => {
            const extra = Array.from(e.target.files || []);
            onPendingFiles([...pendingFiles, ...extra]);
            e.target.value = "";
          }}
        />
        {pendingFiles.length > 0 && (
          <ul className="text-xs text-muted-foreground">
            {pendingFiles.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                Novo: {f.name}{" "}
                <button type="button" className="text-destructive underline" onClick={() => onPendingFiles(pendingFiles.filter((_, j) => j !== i))}>
                  remover
                </button>
              </li>
            ))}
          </ul>
        )}
        {anexos.length > 0 && (
          <ul className="text-xs">
            {anexos.map((a) => (
              <li key={a.id}>{a.file_name}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

