import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { maskCNPJ, maskCPF } from "@/lib/masks";
import {
  JORNADA_PRESETS,
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
          Para efetivar a contratação, a empresa deverá enviar os documentos abaixo. Marque o que já
          tem — o salvamento não exige checklist completo.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["docLivro", "Livro de Registro ou Ficha de Registro"],
              ["docCtps", "CTPS (carteira de trabalho)"],
              ["docAso", "Atestado médico admissional (ASO)"],
              ["docFoto", "Uma foto 3x4"],
              ["docCopias", "Cópias: CPF, RG, título, certidão, reservista, comprovante com CEP, CTPS foto/verso"],
              ["docPis", "Cadastro do PIS (cartão ou extrato ativo da Caixa)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox checked={dados[key]} onCheckedChange={(c) => set({ [key]: c === true } as Partial<AdmissionDados>)} />
              <span>{label}</span>
            </label>
          ))}
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
          <Field label="2. Endereço" className="space-y-1.5 sm:col-span-2">
            <Input value={dados.endereco} onChange={(e) => set({ endereco: e.target.value })} />
          </Field>
          <Field label="3. Cidade">
            <Input value={dados.cidade} onChange={(e) => set({ cidade: e.target.value })} />
          </Field>
          <Field label="CEP">
            <Input value={maskCepLocal(dados.cep)} onChange={(e) => set({ cep: e.target.value.replace(/\D/g, "").slice(0, 8) })} />
          </Field>
          <Field label="4. Nacionalidade">
            <Input value={dados.nacionalidade} onChange={(e) => set({ nacionalidade: e.target.value })} />
          </Field>
          <Field label="5. Data de nascimento">
            <Input type="date" value={dados.nascimento} onChange={(e) => set({ nascimento: e.target.value })} />
          </Field>
          <Field label="6. Identidade">
            <Input value={dados.identidade} onChange={(e) => set({ identidade: e.target.value })} />
          </Field>
          <Field label="Órgão emissor">
            <Input value={dados.identidadeOrgao} onChange={(e) => set({ identidadeOrgao: e.target.value })} />
          </Field>
          <Field label="Local">
            <Input value={dados.identidadeLocal} onChange={(e) => set({ identidadeLocal: e.target.value })} />
          </Field>
          <Field label="Data de emissão">
            <Input type="date" value={dados.identidadeEmissao} onChange={(e) => set({ identidadeEmissao: e.target.value })} />
          </Field>
          <Field label="Tel.">
            <Input value={dados.telefone} onChange={(e) => set({ telefone: e.target.value })} />
          </Field>
          <Field label="7. CPF">
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
            <Input maxLength={2} value={dados.tituloUf} onChange={(e) => set({ tituloUf: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="9. Carteira de reservista">
            <Input value={dados.reservista} onChange={(e) => set({ reservista: e.target.value })} />
          </Field>
          <Field label="Categoria">
            <Input value={dados.reservistaCategoria} onChange={(e) => set({ reservistaCategoria: e.target.value })} />
          </Field>
          <Field label="UF reservista">
            <Input maxLength={2} value={dados.reservistaUf} onChange={(e) => set({ reservistaUf: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="10. CTPS digital — número">
            <Input value={dados.ctpsNumero} onChange={(e) => set({ ctpsNumero: e.target.value })} />
          </Field>
          <Field label="Série">
            <Input value={dados.ctpsSerie} onChange={(e) => set({ ctpsSerie: e.target.value })} />
          </Field>
          <Field label="UF CTPS">
            <Input maxLength={2} value={dados.ctpsUf} onChange={(e) => set({ ctpsUf: e.target.value.toUpperCase() })} />
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
          <Field label="13. Estado civil">
            <Input value={dados.estadoCivil} onChange={(e) => set({ estadoCivil: e.target.value })} />
          </Field>
          <Field label="Cônjuge">
            <Input value={dados.conjuge} onChange={(e) => set({ conjuge: e.target.value })} />
          </Field>
          <Field label="14. Grau de instrução">
            <Input value={dados.grauInstrucao} onChange={(e) => set({ grauInstrucao: e.target.value })} />
          </Field>
          <Field label="Completo / incompleto">
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={dados.grauCompleto === "completo" ? "default" : "outline"} onClick={() => set({ grauCompleto: "completo" })}>
                Completo
              </Button>
              <Button type="button" size="sm" variant={dados.grauCompleto === "incompleto" ? "default" : "outline"} onClick={() => set({ grauCompleto: "incompleto" })}>
                Incompleto / cursando
              </Button>
            </div>
          </Field>
          <Field label="15. Declaração de cor/raça">
            <Input value={dados.corRaca} onChange={(e) => set({ corRaca: e.target.value })} />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">Informações do empregador para a admissão</h2>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">1. Emprego</Label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={dados.primeiroEmprego === "primeiro" ? "default" : "outline"} onClick={() => set({ primeiroEmprego: "primeiro" })}>
              É 1º emprego
            </Button>
            <Button type="button" size="sm" variant={dados.primeiroEmprego === "outro" ? "default" : "outline"} onClick={() => set({ primeiroEmprego: "outro" })}>
              Já teve outro emprego
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="2. Data de admissão">
            <Input type="date" value={dados.dataAdmissao} onChange={(e) => set({ dataAdmissao: e.target.value })} />
          </Field>
          <Field label="3. Salário">
            <Input value={dados.salario} onChange={(e) => set({ salario: e.target.value })} />
          </Field>
          <Field label="Função">
            <Input value={dados.funcao} onChange={(e) => set({ funcao: e.target.value })} />
          </Field>
          <Field label="5. Contrato de experiência">
            <Input value={dados.contratoExperiencia} onChange={(e) => set({ contratoExperiencia: e.target.value })} />
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
              <Input value={dados.diaFolga} onChange={(e) => set({ diaFolga: e.target.value, jornadaPreset: "personalizado" })} />
            </Field>
            <Field label="Intervalo">
              <Input value={dados.intervalo} onChange={(e) => set({ intervalo: e.target.value, jornadaPreset: "personalizado" })} />
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
            6. Desconto de vale-transporte — 6% do salário base, conforme CLT
          </Label>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={dados.valeTransporte === "sim" ? "default" : "outline"} onClick={() => set({ valeTransporte: "sim" })}>
              SIM
            </Button>
            <Button type="button" size="sm" variant={dados.valeTransporte === "nao" ? "default" : "outline"} onClick={() => set({ valeTransporte: "nao" })}>
              NÃO
            </Button>
          </div>
        </div>
        <Field label="8. Data do documento ASO (exame admissional)">
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

