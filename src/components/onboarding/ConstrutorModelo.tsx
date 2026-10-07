import { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  TIPO_BLOCO_AJUDA,
  TIPO_BLOCO_LABEL,
  blocoVazio,
  type Bloco,
  type Regras,
  type TipoBloco,
} from "@/lib/onboardingModelo";

const TIPOS: TipoBloco[] = ["boas_vindas", "etapa", "documento", "prazo_recorrente", "contato", "marco"];

const SELECT_CLASS = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm";

const AREAS: Array<[NonNullable<Regras["areas"]>[number], string]> = [
  ["contabil", "Contábil"],
  ["fiscal", "Fiscal"],
  ["pessoal", "Pessoal"],
];
const ENQUADRAMENTOS: Array<[NonNullable<Regras["enquadramento"]>[number], string]> = [
  ["mei", "MEI"],
  ["simples", "Simples"],
  ["presumido", "Presumido"],
  ["real", "Real"],
];
const TIPOS_EMPRESA: Array<[NonNullable<Regras["tipoEmpresa"]>[number], string]> = [
  ["servico", "Serviço"],
  ["comercio", "Comércio"],
  ["industria", "Indústria"],
];

function alternar<T>(lista: T[] | undefined, valor: T): T[] {
  const atual = lista || [];
  return atual.includes(valor) ? atual.filter((v) => v !== valor) : [...atual, valor];
}

function Grupo<T extends string>({
  titulo,
  opcoes,
  valor,
  onChange,
}: {
  titulo: string;
  opcoes: Array<[T, string]>;
  valor: T[] | undefined;
  onChange: (v: T[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-muted-foreground">{titulo}</legend>
      <div className="flex flex-wrap gap-1.5">
        {opcoes.map(([v, rotulo]) => {
          const ligado = (valor || []).includes(v);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={ligado}
              onClick={() => onChange(alternar(valor, v))}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${ligado ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
            >
              {rotulo}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Editor dos quatro critérios; vale tanto para `regras` do modelo quanto para `condicao` de um bloco. */
export function EditorRegras({ regras, onChange }: { regras: Regras; onChange: (r: Regras) => void }) {
  const limpar = (r: Regras): Regras => {
    const out: Regras = { ...r };
    (Object.keys(out) as Array<keyof Regras>).forEach((k) => {
      const v = out[k];
      if (v === undefined || (Array.isArray(v) && !v.length)) delete out[k];
    });
    return out;
  };
  const f = regras.comFuncionarios;
  return (
    <div className="space-y-3">
      <Grupo titulo="Áreas contratadas (todas as marcadas)" opcoes={AREAS} valor={regras.areas} onChange={(areas) => onChange(limpar({ ...regras, areas }))} />
      <Grupo titulo="Enquadramento" opcoes={ENQUADRAMENTOS} valor={regras.enquadramento} onChange={(enquadramento) => onChange(limpar({ ...regras, enquadramento }))} />
      <Grupo titulo="Tipo de empresa" opcoes={TIPOS_EMPRESA} valor={regras.tipoEmpresa} onChange={(tipoEmpresa) => onChange(limpar({ ...regras, tipoEmpresa }))} />
      <div>
        <Label className="text-xs text-muted-foreground">Funcionários</Label>
        <select
          className={`${SELECT_CLASS} mt-1`}
          value={f === undefined ? "" : f ? "sim" : "nao"}
          onChange={(e) => onChange(limpar({ ...regras, comFuncionarios: e.target.value === "" ? undefined : e.target.value === "sim" }))}
        >
          <option value="">Tanto faz</option>
          <option value="sim">Só com funcionários</option>
          <option value="nao">Só sem funcionários</option>
        </select>
      </div>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{rotulo}</Label>
      {children}
    </div>
  );
}

/** Formulário de um bloco, conforme o tipo. */
function EditorBloco({ bloco, onChange }: { bloco: Bloco; onChange: (b: Bloco) => void }) {
  const set = (parcial: Partial<Bloco>) => onChange({ ...bloco, ...parcial });
  const temCondicao = Boolean(bloco.condicao && Object.keys(bloco.condicao).length);
  const [abrirCondicao, setAbrirCondicao] = useState(temCondicao);
  const comPrazo = bloco.tipo === "documento" || bloco.tipo === "marco";

  return (
    <div className="space-y-3 border-t px-3 pb-3 pt-3">
      <Campo rotulo="Título">
        <Input value={bloco.titulo} maxLength={160} onChange={(e) => set({ titulo: e.target.value })} aria-label="Título do bloco" />
      </Campo>
      <Campo rotulo={bloco.tipo === "boas_vindas" ? "Mensagem" : "Descrição"}>
        <Textarea value={bloco.descricao} maxLength={1200} rows={3} onChange={(e) => set({ descricao: e.target.value })} aria-label="Descrição do bloco" />
      </Campo>

      {bloco.tipo === "documento" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Formatos aceitos (separe por vírgula)">
              <Input
                value={(bloco.formatos || []).join(", ")}
                placeholder="pdf, xml, ofx"
                onChange={(e) => set({ formatos: e.target.value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) })}
                aria-label="Formatos aceitos"
              />
            </Campo>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={bloco.obrigatorio !== false} onChange={(e) => set({ obrigatorio: e.target.checked })} />
                Obrigatório
              </label>
            </div>
          </div>
          <Campo rotulo="Como enviar">
            <Input value={bloco.comoEnviar || ""} maxLength={400} onChange={(e) => set({ comoEnviar: e.target.value })} aria-label="Como enviar" />
          </Campo>
        </>
      )}

      {comPrazo && bloco.prazo && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="Contar a partir de">
            <select
              className={SELECT_CLASS}
              value={bloco.prazo.ref}
              aria-label="Contar a partir de"
              onChange={(e) => set({ prazo: { ...bloco.prazo!, ref: e.target.value as "assinatura" | "inicio" } })}
            >
              <option value="assinatura">Assinatura do contrato</option>
              <option value="inicio">Início da prestação</option>
            </select>
          </Campo>
          <Campo rotulo="Dias">
            <Input
              type="number"
              min={0}
              max={365}
              value={bloco.prazo.dias}
              aria-label="Dias de prazo"
              onChange={(e) => set({ prazo: { ...bloco.prazo!, dias: Math.max(0, Math.min(365, Number(e.target.value) || 0)) } })}
            />
          </Campo>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={bloco.prazo.uteis} onChange={(e) => set({ prazo: { ...bloco.prazo!, uteis: e.target.checked } })} />
              Dias úteis
            </label>
          </div>
        </div>
      )}

      {bloco.tipo === "prazo_recorrente" && (
        <Campo rotulo="Regra do mês (aceita {{prazos.diaVariaveisFolha|20}})">
          <Input value={bloco.regra || ""} maxLength={400} onChange={(e) => set({ regra: e.target.value })} aria-label="Regra do mês" />
        </Campo>
      )}
      {bloco.tipo === "contato" && (
        <Campo rotulo="Quem atende e como">
          <Input value={bloco.contato || ""} maxLength={400} onChange={(e) => set({ contato: e.target.value })} aria-label="Contato" />
        </Campo>
      )}

      <div className="rounded-md bg-muted/50 p-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={abrirCondicao}
            onChange={(e) => {
              setAbrirCondicao(e.target.checked);
              if (!e.target.checked) set({ condicao: undefined });
            }}
          />
          Mostrar só em alguns contratos
        </label>
        {abrirCondicao && (
          <div className="mt-3">
            <EditorRegras regras={bloco.condicao || {}} onChange={(condicao) => set({ condicao: Object.keys(condicao).length ? condicao : undefined })} />
          </div>
        )}
      </div>
    </div>
  );
}

function resumoBloco(b: Bloco): string {
  if (b.tipo === "documento" || b.tipo === "marco") {
    if (!b.prazo) return "";
    const base = b.prazo.ref === "inicio" ? "início" : "assinatura";
    return `${b.prazo.dias} ${b.prazo.uteis ? "dias úteis" : "dias"} após ${base}`;
  }
  if (b.tipo === "prazo_recorrente") return b.regra || "";
  if (b.tipo === "contato") return b.contato || "";
  return b.descricao;
}

function ItemBloco({
  bloco,
  aberto,
  onAlternar,
  onChange,
  onRemover,
}: {
  bloco: Bloco;
  aberto: boolean;
  onAlternar: () => void;
  onChange: (b: Bloco) => void;
  onRemover: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bloco.uid as string });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const resumo = resumoBloco(bloco);
  return (
    <li ref={setNodeRef} style={style} className="rounded-lg border bg-card" data-testid="bloco-modelo">
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent active:cursor-grabbing"
          aria-label={`Arrastar bloco ${bloco.titulo || TIPO_BLOCO_LABEL[bloco.tipo]}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onAlternar} aria-expanded={aberto}>
          {aberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <Badge variant="secondary" className="shrink-0">
            {TIPO_BLOCO_LABEL[bloco.tipo]}
          </Badge>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{bloco.titulo || <em className="font-normal text-muted-foreground">Sem título</em>}</span>
            {resumo && <span className="block truncate text-xs text-muted-foreground">{resumo}</span>}
          </span>
          {bloco.condicao && Object.keys(bloco.condicao).length > 0 && (
            <Badge variant="outline" className="shrink-0">
              condicional
            </Badge>
          )}
        </button>
        <Button type="button" variant="ghost" size="icon" onClick={onRemover} aria-label={`Remover bloco ${bloco.titulo || TIPO_BLOCO_LABEL[bloco.tipo]}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {aberto && <EditorBloco bloco={bloco} onChange={onChange} />}
    </li>
  );
}

function ItemPaleta({ tipo, onAdicionar }: { tipo: TipoBloco; onAdicionar: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `pal:${tipo}` });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onAdicionar}
      title={TIPO_BLOCO_AJUDA[tipo]}
      style={{ transform: CSS.Translate.toString(transform), zIndex: isDragging ? 50 : undefined }}
      className={`flex touch-none items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent ${isDragging ? "shadow-lg" : ""}`}
      {...attributes}
      {...listeners}
    >
      <Plus className="h-3.5 w-3.5" />
      {TIPO_BLOCO_LABEL[tipo]}
    </button>
  );
}

function AreaDeSoltar({ children, vazio }: { children: React.ReactNode; vazio: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "lista" });
  return (
    <div ref={setNodeRef} className={`min-h-24 rounded-lg transition-colors ${isOver ? "bg-primary/5 ring-2 ring-primary/30" : ""}`}>
      {children}
      {vazio && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Arraste um tipo de bloco para cá, clique num deles ou peça ao agente de IA para montar o roteiro.
        </p>
      )}
    </div>
  );
}

/**
 * Lista de blocos do modelo: arrastar para reordenar e arrastar da paleta para inserir. Cada
 * bloco abre um formulário próprio. Controlado: quem usa guarda o estado.
 */
export function ListaBlocos({ blocos, onChange }: { blocos: Bloco[]; onChange: (b: Bloco[]) => void }) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = useMemo(() => blocos.map((b) => b.uid as string), [blocos]);

  const inserir = (tipo: TipoBloco, indice: number) => {
    const novo = blocoVazio(tipo);
    const copia = [...blocos];
    copia.splice(Math.max(0, Math.min(indice, copia.length)), 0, novo);
    onChange(copia);
    setAbertos((a) => ({ ...a, [novo.uid as string]: true }));
  };

  const aoSoltar = (e: DragEndEvent) => {
    const ativo = String(e.active.id);
    const sobre = e.over ? String(e.over.id) : null;
    if (!sobre) return;
    if (ativo.startsWith("pal:")) {
      const alvo = sobre === "lista" ? blocos.length : ids.indexOf(sobre);
      inserir(ativo.slice(4) as TipoBloco, alvo < 0 ? blocos.length : alvo);
      return;
    }
    const de = ids.indexOf(ativo);
    const para = sobre === "lista" ? blocos.length - 1 : ids.indexOf(sobre);
    if (de >= 0 && para >= 0 && de !== para) onChange(arrayMove(blocos, de, para));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={aoSoltar}>
      <div className="mb-3 flex flex-wrap gap-2" aria-label="Tipos de bloco">
        {TIPOS.map((t) => (
          <ItemPaleta key={t} tipo={t} onAdicionar={() => inserir(t, blocos.length)} />
        ))}
      </div>
      <AreaDeSoltar vazio={!blocos.length}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {blocos.map((b) => (
              <ItemBloco
                key={b.uid}
                bloco={b}
                aberto={Boolean(abertos[b.uid as string])}
                onAlternar={() => setAbertos((a) => ({ ...a, [b.uid as string]: !a[b.uid as string] }))}
                onChange={(novo) => onChange(blocos.map((x) => (x.uid === b.uid ? novo : x)))}
                onRemover={() => onChange(blocos.filter((x) => x.uid !== b.uid))}
              />
            ))}
          </ol>
        </SortableContext>
      </AreaDeSoltar>
    </DndContext>
  );
}

export function CartaoSecao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        {children}
      </CardContent>
    </Card>
  );
}
