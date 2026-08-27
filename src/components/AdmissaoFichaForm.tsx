import { useEffect, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { maskCNPJ, maskCPF } from "@/lib/masks";
import { cn } from "@/lib/utils";
import {
  DOCS_OBRIGATORIOS,
  JORNADA_PRESETS,
  OPCOES,
  UFS,
  type AdmissionAnexo,
  type AdmissionDados,
  type AnexoKind,
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
  pendingByKind: Partial<Record<AnexoKind, File>>;
  onPendingByKind: (next: Partial<Record<AnexoKind, File>>) => void;
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

function CameraCaptureDialog({
  open,
  title,
  onClose,
  onCapture,
  onUnavailable,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onCapture: (file: File) => void;
  onUnavailable: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const parar = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setErro(null);
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onUnavailableRef.current();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
      } catch {
        if (!cancelado) {
          setErro("Não foi possível abrir a câmera. Permitindo escolher um arquivo de imagem.");
          parar();
          onUnavailableRef.current();
        }
      }
    })();
    return () => {
      cancelado = true;
      parar();
    };
  }, [open]);

  const capturar = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" }));
        parar();
        onClose();
      },
      "image/jpeg",
      0.88,
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tirar foto — {title}</DialogTitle>
        </DialogHeader>
        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : (
          <video ref={videoRef} className="max-h-80 w-full rounded-md bg-black" playsInline muted autoPlay />
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={capturar} disabled={Boolean(erro)}>
            Capturar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocAttach({
  kind,
  label,
  obrigatorio,
  aplicavel,
  file,
  savedName,
  onFile,
  onTirarFoto,
  fallbackInputRef,
}: {
  kind: AnexoKind;
  label: string;
  obrigatorio?: boolean;
  aplicavel?: boolean;
  file?: File;
  savedName?: string;
  onFile: (kind: AnexoKind, file: File | undefined) => void;
  onTirarFoto: (kind: AnexoKind, label: string) => void;
  fallbackInputRef: (el: HTMLInputElement | null) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">
        {label}
        {obrigatorio && <span className="ml-1 text-xs font-semibold text-destructive">Obrigatório — anexe</span>}
        {aplicavel && <span className="ml-1 text-xs text-muted-foreground">quando aplicável</span>}
      </p>
      {savedName && !file && <p className="text-xs text-emerald-600">Arquivo na pasta da empresa: {savedName}</p>}
      {file && <p className="text-xs text-foreground">Novo: {file.name}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onTirarFoto(kind, label)}>
          Tirar foto
        </Button>
        <input
          ref={fallbackInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onFile(kind, e.target.files?.[0])}
        />
        <label className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs">
          Anexar arquivo
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => onFile(kind, e.target.files?.[0])}
          />
        </label>
      </div>
    </div>
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
  pendingByKind,
  onPendingByKind,
}: Props) {
  const set = (patch: Partial<AdmissionDados>) => onDados({ ...dados, ...patch });
  const savedByKind = Object.fromEntries(
    anexos.filter((a) => a.kind).map((a) => [a.kind as string, a.file_name]),
  );
  const fallbackInputs = useRef<Partial<Record<AnexoKind, HTMLInputElement | null>>>({});
  const [camera, setCamera] = useState<{ kind: AnexoKind; label: string } | null>(null);

  const setFile = (kind: AnexoKind, file: File | undefined) => {
    const next = { ...pendingByKind };
    if (file) next[kind] = file;
    else delete next[kind];
    onPendingByKind(next);
    if (kind in dados && typeof dados[kind as keyof AdmissionDados] === "boolean") {
      set({ [kind]: Boolean(file || savedByKind[kind]) } as Partial<AdmissionDados>);
    }
  };

  const docProps = (kind: AnexoKind) => ({
    kind,
    file: pendingByKind[kind],
    savedName: savedByKind[kind],
    onFile: setFile,
    onTirarFoto: (k: AnexoKind, lbl: string) => setCamera({ kind: k, label: lbl }),
    fallbackInputRef: (el: HTMLInputElement | null) => {
      fallbackInputs.current[kind] = el;
    },
  });

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
          Cada item obrigatório precisa de foto ou arquivo.{" "}
          <span className="font-medium text-foreground">Tirar foto</span> abre a câmera (celular ou
          webcam do computador, se você permitir).{" "}
          <span className="font-medium text-foreground">Anexar arquivo</span> abre uma pasta do seu
          computador. Os arquivos vão para a pasta de admissão da empresa; o escritório acessa pelo
          painel.
        </p>
        <p className="text-xs font-medium">Obrigatórios</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {DOCS_OBRIGATORIOS.map((d) => (
            <DocAttach key={d.key} {...docProps(d.key)} label={d.label} obrigatorio />
          ))}
        </div>
        <p className="text-xs font-medium">Quando aplicável</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <DocAttach
            {...docProps("docReservistaCopia")}
            label="Carteira de reservista (homem)"
            aplicavel
          />
          <DocAttach
            {...docProps("docCertidaoCivil")}
            label="Certidão de casamento ou nascimento (solteiro)"
            aplicavel
          />
        </div>
        <p className="text-xs font-medium">Opcional</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <DocAttach {...docProps("docFoto")} label="Foto 3x4" />
          <DocAttach {...docProps("docCopias")} label="CTPS parte da foto e verso" />
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
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={dados.filhoDeficiente} onCheckedChange={(c) => set({ filhoDeficiente: c === true })} />
              Filho com deficiência
            </label>
            <div className="sm:col-span-2">
              <DocAttach
                {...docProps("filhoCertidao")}
                label="Anexar certidão de nascimento dos filhos"
                obrigatorio
              />
            </div>
            <DocAttach
              {...docProps("filhoVacina")}
              label="Cartão de vacina (< 5 anos)"
              aplicavel
            />
            <DocAttach
              {...docProps("filhoEscolaridade")}
              label="Regularidade escolar (> 7 anos)"
              aplicavel
            />
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
          <Field label="Local de nascimento *">
            <Input value={dados.localNascimento} onChange={(e) => set({ localNascimento: e.target.value })} />
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
          <Field label="12. Filiação — pai *">
            <Input value={dados.pai} onChange={(e) => set({ pai: e.target.value })} />
          </Field>
          <Field label="Mãe *">
            <Input value={dados.mae} onChange={(e) => set({ mae: e.target.value })} />
          </Field>
          <Field label="13. Estado civil *">
            <NativeSelect value={dados.estadoCivil} onChange={(v) => set({ estadoCivil: v })} options={OPCOES.estadoCivil} />
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
      <CameraCaptureDialog
        open={Boolean(camera)}
        title={camera?.label || ""}
        onClose={() => setCamera(null)}
        onCapture={(file) => {
          if (camera) setFile(camera.kind, file);
        }}
        onUnavailable={() => {
          const kind = camera?.kind;
          setCamera(null);
          window.setTimeout(() => {
            if (kind) fallbackInputs.current[kind]?.click();
          }, 200);
        }}
      />
    </div>
  );
}

