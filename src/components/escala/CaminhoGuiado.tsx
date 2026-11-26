import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  HardHat,
  HelpCircle,
  Lock,
  Plus,
  Save,
  ShoppingBag,
  Trash2,
  UtensilsCrossed,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DIAS_TRABALHO_SEMANA, turnoQuePreenche } from "@/lib/escala/cenarios";
import { minutosTrabalhados, type Turno } from "@/lib/escala/modelos";
import { BotoesBaixar } from "@/components/escala/BotoesBaixar";
import type { ResultadoCenario } from "@/lib/escala/cenarios";
import type { Demanda } from "@/lib/escala/contingente";
import { diaDaSemana } from "@/lib/escala/datas";
import { agruparOcorrencias } from "@/lib/escala/ocorrencias";
import {
  MODELOS,
  diasDoMes,
  fraseDaPessoa,
  type AvaliacaoPessoa,
  type ConfigEmpresa,
  type ModeloChave,
} from "@/lib/escala/planejamento";
import { SEGMENTOS, type Segmento } from "@/lib/escala/regras";

const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_LETRA = ["D", "S", "T", "Q", "Q", "S", "S"];

const ATIVIDADES: Array<{ id: Segmento; icone: LucideIcon; exemplo: string }> = [
  { id: "comercio", icone: ShoppingBag, exemplo: "Lojas, mercados, farmácias" },
  { id: "restaurante", icone: UtensilsCrossed, exemplo: "Bares, restaurantes, lanchonetes" },
  { id: "construcao_civil", icone: HardHat, exemplo: "Obras e canteiros" },
  { id: "outro", icone: Building2, exemplo: "Escritórios, serviços, indústria" },
];

/** Nome das sugestões prontas em palavras do dia a dia (o nome técnico fica no modo avançado). */
const NOME_SIMPLES: Record<string, string> = {
  seg_sab: "Abre de segunda a sábado",
  fecha_seg: "Abre de terça a domingo",
  "5x2_fds": "Segunda a sexta, folga no fim de semana",
  "5x2_dom_seg": "Terça a sábado, folga domingo e segunda",
  "5x2_rev2": "Abre todos os dias, folgas em rodízio",
  "5x2_rev3": "Abre todos os dias, mais gente no domingo",
  "5x2_corrida": "Abre todos os dias, as 2 folgas andam um dia por semana",
  "5x2_quinzenal": "Abre todos os dias, domingo de folga a cada 2 semanas",
  "4x3": "4 dias de 10 horas, 3 folgas",
  "12x36": "Plantões de 12 horas, dia sim, dia não",
  "6x1": "6 dias de trabalho e 1 folga (só até 15/12/2026)",
};

type Passo = 1 | 2 | 3;

/**
 * Como a tela oferece as 42h em 5 dias (8h24): pelo acordo coletivo (art. 7º da EC), como
 * hora extra paga (sem acordo, 24min por dia) ou não oferece (bloqueio sem hora extra).
 */
export type Pode42h = "acordo" | "hora_extra" | false;

const DIAS_POR_SEMANA: Record<ModeloChave, string> = {
  "6x1": "6 dias por semana",
  "5x2": "5 dias por semana",
  "5x2_rev": "5 dias por semana",
  "5x2_corrida": "5 dias por semana",
  "5x2_quinzenal": "5 dias por semana",
  "5x2_fechado": "5 dias por semana",
  "4x3": "4 dias por semana",
  "12x36": "dia sim, dia não",
};

/** 504 -> "8h24"; 480 -> "8h". */
function fmtHoras(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

function num(n: number) {
  return (Math.round(n * 10) / 10).toString().replace(".", ",");
}

/** Hora curta para a semana: "08:00" vira "8h", "16:20" fica "16:20". */
function hora(hhmm: string) {
  return hhmm.endsWith(":00") ? `${Number(hhmm.slice(0, 2))}h` : hhmm;
}

/** Última semana inteira (domingo a sábado) do mês: no mês da virada, já é a regra nova. */
function semanaDeExemplo(mes: string): string[] {
  const dias = diasDoMes(mes);
  for (let i = dias.length - 7; i >= 0; i--) if (diaDaSemana(dias[i]) === 0) return dias.slice(i, i + 7);
  return dias.slice(0, 7);
}

/**
 * Caminho guiado do planejador, para quem não é do DP: três perguntas (empresa, equipe,
 * escala) e a escala sai pronta para salvar. Usa o mesmo estado e o mesmo motor de regras
 * das abas completas (modo avançado); aqui só muda a forma de perguntar.
 */
export function CaminhoGuiado({
  mes,
  cfg,
  travadoPeloEscritorio,
  regime12x36Padrao,
  linhas,
  cenarios,
  escalaAtual,
  cenarioAtual,
  totalErros,
  totalAvisos,
  alterado,
  salvo,
  salvando,
  onEmpresa,
  onAbrirPessoa,
  onVaga,
  onRemoverVaga,
  onEscolher,
  onSalvar,
  onMaisOpcoes,
  onBaixar,
  limiteSemanal,
  pode42h,
  onHorario,
}: {
  mes: string;
  cfg: ConfigEmpresa;
  travadoPeloEscritorio: boolean;
  regime12x36Padrao: boolean;
  linhas: AvaliacaoPessoa[];
  cenarios: ResultadoCenario[];
  escalaAtual: ResultadoCenario;
  cenarioAtual: string | null;
  totalErros: number;
  totalAvisos: number;
  alterado: boolean;
  salvo: boolean;
  salvando: boolean;
  onEmpresa: (patch: Partial<ConfigEmpresa>) => void;
  onAbrirPessoa: (id: string) => void;
  onVaga: () => void;
  onRemoverVaga: (id: string) => void;
  onEscolher: (c: ResultadoCenario) => void;
  onSalvar: () => void;
  onMaisOpcoes: () => void;
  onBaixar: (tipo: "pdf" | "xlsx") => void;
  /** Limite de horas por semana no fim do mês (42 na etapa 1). */
  limiteSemanal: number;
  /** Acordo coletivo e sem bloqueio de hora extra: dá para alongar o dia até o limite. */
  pode42h: Pode42h;
  /** Troca o horário de uma sugestão (null volta ao padrão). */
  onHorario: (cenarioId: string, turno: Turno | null) => void;
}) {
  // Empresa já respondida (por ela ou pelo escritório): abre no passo da escala.
  const [passo, setPasso] = useState<Passo>(cfg.atividadeDefinida ? 3 : 1);

  const passos: Array<{ n: Passo; titulo: string }> = [
    { n: 1, titulo: "Sua empresa" },
    { n: 2, titulo: "Sua equipe" },
    { n: 3, titulo: "Sua escala" },
  ];

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1 overflow-x-auto sm:gap-2" aria-label="Passos">
        {passos.map((p, i) => {
          const ativo = p.n === passo;
          const liberado = p.n === 1 || cfg.atividadeDefinida;
          return (
            <div key={p.n} className="flex items-center gap-2">
              {i > 0 && <span className="hidden h-px w-6 bg-border sm:block" />}
              <button
                type="button"
                disabled={!liberado}
                onClick={() => setPasso(p.n)}
                aria-current={ativo ? "step" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-sm transition disabled:opacity-50 sm:gap-2 sm:px-3",
                  ativo ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/60",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold",
                    ativo ? "bg-primary-foreground text-primary" : "bg-muted",
                  )}
                >
                  {p.n}
                </span>
                <span className={cn(!ativo && "hidden sm:inline")}>{p.titulo}</span>
              </button>
            </div>
          );
        })}
      </nav>

      {passo === 1 && (
        <PassoEmpresa
          cfg={cfg}
          travado={travadoPeloEscritorio}
          regime12x36Padrao={regime12x36Padrao}
          onContinuar={(patch) => {
            onEmpresa(patch);
            setPasso(2);
          }}
        />
      )}
      {passo === 2 && (
        <PassoEquipe
          linhas={linhas}
          onAbrirPessoa={onAbrirPessoa}
          onVaga={onVaga}
          onRemoverVaga={onRemoverVaga}
          onVoltar={() => setPasso(1)}
          onContinuar={() => setPasso(3)}
        />
      )}
      {passo === 3 && (
        <PassoEscala
          mes={mes}
          cfg={cfg}
          linhas={linhas}
          cenarios={cenarios}
          escalaAtual={escalaAtual}
          cenarioAtual={cenarioAtual}
          totalErros={totalErros}
          totalAvisos={totalAvisos}
          alterado={alterado}
          salvo={salvo}
          salvando={salvando}
          onEscolher={onEscolher}
          onSalvar={onSalvar}
          onMaisOpcoes={onMaisOpcoes}
          onBaixar={onBaixar}
          limiteSemanal={limiteSemanal}
          pode42h={pode42h}
          onHorario={onHorario}
          onVoltar={() => setPasso(2)}
        />
      )}
    </div>
  );
}

/* ---------------------------------- Passo 1 --------------------------------- */

function Opcao({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-4 py-2 text-sm font-medium transition hover:border-primary/60",
        ativo && "border-primary bg-primary/10 ring-2 ring-primary/30",
      )}
    >
      {children}
    </button>
  );
}

function PassoEmpresa({
  cfg,
  travado,
  regime12x36Padrao,
  onContinuar,
}: {
  cfg: ConfigEmpresa;
  travado: boolean;
  regime12x36Padrao: boolean;
  onContinuar: (patch: Partial<ConfigEmpresa>) => void;
}) {
  const definido = cfg.atividadeDefinida;
  // null = "Não sei"; undefined = ainda não respondeu.
  const [segmento, setSegmento] = useState<Segmento | null | undefined>(
    definido ? (cfg.naoSabe.includes("atividade") ? null : cfg.segmento) : undefined,
  );
  const [acordo, setAcordo] = useState<boolean | null | undefined>(
    definido ? (cfg.naoSabe.includes("acordo") ? null : cfg.temAcordoColetivo) : undefined,
  );
  const [usa12x36, setUsa12x36] = useState(definido ? cfg.usa12x36 : regime12x36Padrao);
  const [fechados, setFechados] = useState<number[]>(cfg.diasFechados);
  const [abreFeriado, setAbreFeriado] = useState(cfg.abreNosFeriados);
  const [demanda, setDemanda] = useState<Demanda>(cfg.demanda);
  const [comDemanda, setComDemanda] = useState(cfg.demanda.some((n) => n > 0));

  const falta = !travado && (segmento === undefined || acordo === undefined);

  function continuar() {
    const base: Partial<ConfigEmpresa> = {
      diasFechados: [...fechados].sort(),
      abreNosFeriados: abreFeriado,
      demanda: comDemanda ? demanda : (demanda.map(() => 0) as Demanda),
    };
    if (travado) return onContinuar(base);
    const naoSabe: ConfigEmpresa["naoSabe"] = [];
    if (segmento === null) naoSabe.push("atividade");
    if (acordo === null) naoSabe.push("acordo");
    onContinuar({
      ...base,
      // "Não sei" usa a regra mais exigente: comércio (domingo a cada 3 semanas, feriado só
      // com convenção) e sem acordo coletivo. O escritório confere depois.
      segmento: segmento ?? "comercio",
      temAcordoColetivo: acordo ?? false,
      usa12x36,
      naoSabe,
    });
  }

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {travado ? (
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="font-medium">{SEGMENTOS[cfg.segmento].nome}</span>,{" "}
              {cfg.temAcordoColetivo ? "com acordo coletivo" : "sem acordo coletivo"}
              {cfg.usa12x36 ? ", trabalha em plantão 12x36" : ""}.
              <span className="block text-xs text-muted-foreground">Informado pelo escritório. Se estiver errado, fale com a gente.</span>
            </span>
          </div>
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="font-medium">Qual é o ramo da empresa?</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" role="radiogroup" aria-label="Ramo da empresa">
                {ATIVIDADES.map(({ id, icone: Icone, exemplo }) => {
                  const ativo = segmento === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={ativo}
                      onClick={() => setSegmento(id)}
                      className={cn(
                        "relative flex items-center gap-3 rounded-xl border p-3 text-left transition hover:border-primary/60",
                        ativo && "border-primary bg-primary/5 ring-2 ring-primary/30",
                      )}
                    >
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted", ativo && "bg-primary text-primary-foreground")}>
                        <Icone className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{SEGMENTOS[id].nome}</span>
                        <span className="block text-xs text-muted-foreground">{exemplo}</span>
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="radio"
                  aria-checked={segmento === null}
                  onClick={() => setSegmento(null)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border border-dashed p-3 text-left transition hover:border-primary/60",
                    segmento === null && "border-primary bg-primary/5 ring-2 ring-primary/30",
                  )}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <HelpCircle className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">Não sei</span>
                    <span className="block text-xs text-muted-foreground">Usamos a regra mais segura</span>
                  </span>
                </button>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="font-medium">A empresa tem acordo com o sindicato para compensar horas?</h3>
              <p className="text-xs text-muted-foreground">
                É o acordo ou convenção coletiva que permite, por exemplo, dias de 10 horas. Na dúvida, marque "Não sei": o escritório confere.
              </p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Acordo coletivo">
                <Opcao ativo={acordo === true} onClick={() => setAcordo(true)}>
                  Sim
                </Opcao>
                <Opcao ativo={acordo === false} onClick={() => setAcordo(false)}>
                  Não
                </Opcao>
                <Opcao ativo={acordo === null} onClick={() => setAcordo(null)}>
                  Não sei
                </Opcao>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="font-medium">A equipe trabalha em plantões de 12 horas (dia sim, dia não)?</h3>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Plantão 12x36">
                <Opcao ativo={usa12x36} onClick={() => setUsa12x36(true)}>
                  Sim
                </Opcao>
                <Opcao ativo={!usa12x36} onClick={() => setUsa12x36(false)}>
                  Não
                </Opcao>
              </div>
            </section>
          </>
        )}

        <section className="space-y-2">
          <h3 className="font-medium">A empresa abre nos feriados?</h3>
          <p className="text-xs text-muted-foreground">
            Sim: no feriado trabalha quem a escala põe para trabalhar naquele dia, com pagamento em dobro ou outra folga na semana. Não: todos
            folgam no feriado.
          </p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Abre nos feriados">
            <Opcao ativo={abreFeriado} onClick={() => setAbreFeriado(true)}>
              Sim, abre
            </Opcao>
            <Opcao ativo={!abreFeriado} onClick={() => setAbreFeriado(false)}>
              Não, fecha
            </Opcao>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Em que dias a empresa abre?</h3>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias em que a empresa abre">
            {DIAS_CURTOS.map((n, i) => {
              const abre = !fechados.includes(i);
              // Ao menos 2 dias abertos (o motor guarda no máximo 5 dias fechados).
              const ultimo = abre && fechados.length >= 5;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={abre}
                  disabled={ultimo}
                  onClick={() => setFechados(abre ? [...fechados, i] : fechados.filter((d) => d !== i))}
                  className={cn(
                    "h-10 w-14 rounded-lg border text-sm font-medium transition disabled:cursor-not-allowed",
                    abre ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground line-through hover:border-primary/60",
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Toque num dia para marcar que a empresa fica fechada.</p>
        </section>

        <section className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4" checked={comDemanda} onChange={(e) => setComDemanda(e.target.checked)} />
            Quero dizer quantas pessoas preciso trabalhando em cada dia (opcional)
          </label>
          {comDemanda && (
            <div className="flex flex-wrap gap-2">
              {DIAS_CURTOS.map((n, i) => (
                <label key={n} className="flex w-14 flex-col items-center gap-1 text-xs">
                  {n}
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="h-9 px-1 text-center"
                    disabled={fechados.includes(i)}
                    value={fechados.includes(i) ? 0 : demanda[i] || ""}
                    onChange={(e) => {
                      const d = [...demanda] as Demanda;
                      d[i] = Math.max(0, Math.floor(Number(e.target.value) || 0));
                      setDemanda(d);
                    }}
                  />
                </label>
              ))}
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <Button size="lg" onClick={continuar} disabled={falta}>
            Continuar <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
        {falta && <p className="text-right text-xs text-muted-foreground">Responda o ramo e o acordo (pode ser "Não sei") para continuar.</p>}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------- Passo 2 --------------------------------- */

function PassoEquipe({
  linhas,
  onAbrirPessoa,
  onVaga,
  onRemoverVaga,
  onVoltar,
  onContinuar,
}: {
  linhas: AvaliacaoPessoa[];
  onAbrirPessoa: (id: string) => void;
  onVaga: () => void;
  onRemoverVaga: (id: string) => void;
  onVoltar: () => void;
  onContinuar: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Confira como cada pessoa trabalha hoje</CardTitle>
        <p className="text-sm text-muted-foreground">
          Trouxemos o que está no cadastro dos funcionários. Se alguém estiver diferente, toque em "Ajustar". No próximo passo você escolhe a nova
          escala.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {linhas.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Nenhum funcionário ativo cadastrado. Acrescente vagas para simular mesmo assim.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {linhas.map((l) => {
              const erro = l.ocorrencias.find((o) => o.gravidade === "erro");
              const vaga = l.config.id.startsWith("vaga-");
              return (
                <li key={l.config.id} className="flex flex-wrap items-center gap-3 p-3">
                  {erro ? <XCircle className="h-4 w-4 shrink-0 text-destructive" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.config.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {fraseDaPessoa(l.config)} <span className="opacity-70">({MODELOS[l.config.modelo]})</span>
                    </p>
                    {erro && <p className="text-xs text-destructive">{erro.mensagem}</p>}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onAbrirPessoa(l.config.id)}>
                    Ajustar
                  </Button>
                  {vaga && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onRemoverVaga(l.config.id)} aria-label={`Remover ${l.config.nome}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Button variant="ghost" size="sm" onClick={onVaga}>
          <Plus className="mr-1 h-4 w-4" /> Acrescentar uma vaga (pessoa a contratar)
        </Button>
        <div className="flex justify-between gap-2 pt-2">
          <Button variant="ghost" onClick={onVoltar}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar
          </Button>
          <Button size="lg" onClick={onContinuar} disabled={linhas.length === 0}>
            Continuar <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------- Passo 3 --------------------------------- */

function PassoEscala({
  mes,
  cfg,
  linhas,
  cenarios,
  escalaAtual,
  cenarioAtual,
  totalErros,
  totalAvisos,
  alterado,
  salvo,
  salvando,
  onEscolher,
  onSalvar,
  onMaisOpcoes,
  onBaixar,
  limiteSemanal,
  pode42h,
  onHorario,
  onVoltar,
}: {
  mes: string;
  cfg: ConfigEmpresa;
  linhas: AvaliacaoPessoa[];
  cenarios: ResultadoCenario[];
  escalaAtual: ResultadoCenario;
  cenarioAtual: string | null;
  totalErros: number;
  totalAvisos: number;
  alterado: boolean;
  salvo: boolean;
  salvando: boolean;
  onEscolher: (c: ResultadoCenario) => void;
  onSalvar: () => void;
  onMaisOpcoes: () => void;
  onBaixar: (tipo: "pdf" | "xlsx") => void;
  /** Limite de horas por semana no fim do mês (42 na etapa 1). */
  limiteSemanal: number;
  /** Acordo coletivo e sem bloqueio de hora extra: dá para alongar o dia até o limite. */
  pode42h: Pode42h;
  /** Troca o horário de uma sugestão (null volta ao padrão). */
  onHorario: (cenarioId: string, turno: Turno | null) => void;
  onVoltar: () => void;
}) {
  const temDemanda = cfg.demanda.some((n) => n > 0);
  // As 3 melhores sugestões que já passam nas regras: primeiro as que cobrem a demanda,
  // depois as que dão mais domingos de folga.
  const sugestoes = useMemo(
    () =>
      cenarios
        .filter((c) => c.podeAplicar)
        .sort((a, b) => a.diasDescobertos - b.diasDescobertos || b.domingosDeFolga - a.domingosDeFolga)
        .slice(0, 3),
    [cenarios],
  );
  const semana = useMemo(() => semanaDeExemplo(mes), [mes]);
  const problemas = useMemo(
    () =>
      linhas.flatMap((l) =>
        agruparOcorrencias(l.ocorrencias.filter((o) => o.gravidade === "erro")).map((g) => `${l.config.nome}: ${g.mensagem}`),
      ),
    [linhas],
  );
  const mostrarAtual = cenarioAtual === null && linhas.length > 0;

  return (
    <div className="space-y-4">
      {/* Semáforo: o que falta para salvar, em uma frase. */}
      <Card
        className={cn(
          "border-2",
          totalErros ? "border-destructive/60" : totalAvisos ? "border-amber-500/60" : "border-emerald-600/60",
        )}
      >
        <CardContent className="flex flex-wrap items-start gap-4 p-4">
          <div className="min-w-0 flex-1 space-y-1">
            {totalErros ? (
              <>
                <p className="flex items-center gap-2 font-semibold text-destructive">
                  <XCircle className="h-5 w-5" /> Falta corrigir {problemas.length === 1 ? "1 ponto" : `${problemas.length} pontos`} antes de salvar
                </p>
                <ul className="list-disc pl-6 text-sm text-muted-foreground">
                  {problemas.slice(0, 4).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                  {problemas.length > 4 && <li>e mais {problemas.length - 4}.</li>}
                </ul>
                <p className="text-sm">O jeito mais fácil: escolha uma das sugestões abaixo, que já vêm dentro da lei.</p>
              </>
            ) : totalAvisos ? (
              <p className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-5 w-5" /> Pode salvar. Há {totalAvisos === 1 ? "1 aviso" : `${totalAvisos} avisos`} para conferir no modo avançado.
              </p>
            ) : (
              <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5" /> Tudo certo: a escala está dentro da lei.
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button size="lg" onClick={onSalvar} disabled={Boolean(totalErros) || salvando}>
              {totalErros ? <Lock className="mr-1.5 h-4 w-4" /> : <Save className="mr-1.5 h-4 w-4" />}
              {salvando ? "Salvando..." : "Salvar escala"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {alterado ? "Mudanças ainda não salvas" : salvo ? "Escala salva" : "Ainda não salva"}
            </span>
            <BotoesBaixar onBaixar={onBaixar} />
          </div>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h3 className="font-medium">Escolha uma escala</h3>
        {sugestoes.length === 0 && !mostrarAtual ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nenhuma sugestão pronta cabe nas regras com essa equipe e esses dias de funcionamento. Volte ao passo 1 para rever os dias, ou fale com o
            escritório.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {mostrarAtual && (
              <CartaoSugestao
                titulo="A escala atual da equipe"
                descricao="Cada pessoa no horário e nas folgas do passo 2, com os ajustes que você fez."
                c={escalaAtual}
                temDemanda={temDemanda}
                emUso
                onEscolher={() => undefined}
              />
            )}
            {sugestoes.map((c) => (
              <CartaoSugestao
                key={c.id}
                titulo={NOME_SIMPLES[c.id] ?? c.nome}
                descricao={c.descricao}
                c={c}
                temDemanda={temDemanda}
                emUso={cenarioAtual === c.id}
                onEscolher={() => onEscolher(c)}
                limiteSemanal={limiteSemanal}
                pode42h={pode42h}
                onHorario={(t) => onHorario(c.id, t)}
              />
            ))}
          </div>
        )}
        <Button variant="link" className="h-auto px-0 text-sm" onClick={onMaisOpcoes}>
          Ver todas as opções e mexer dia a dia (modo avançado)
        </Button>
      </section>

      {linhas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Semana de cada pessoa ({semana[0].slice(8, 10)}/{semana[0].slice(5, 7)} a {semana[6].slice(8, 10)}/{semana[6].slice(5, 7)})
            </CardTitle>
            <p className="text-xs text-muted-foreground">As outras semanas seguem o mesmo jeito; quem tem rodízio troca o dia da folga.</p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[420px] text-xs">
              <thead>
                <tr className="border-b">
                  <th className="p-2 text-left font-medium">Pessoa</th>
                  {semana.map((d) => (
                    <th key={d} className="p-1 text-center font-medium">
                      {DIAS_LETRA[diaDaSemana(d)]}
                      <span className="block font-normal text-muted-foreground">{d.slice(8)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.config.id} className="border-b last:border-0">
                    <td className="max-w-[110px] truncate p-2 font-medium sm:max-w-[200px]">{l.config.nome}</td>
                    {semana.map((d) => {
                      const t = l.dias.find((x) => x.data === d)?.turno;
                      return (
                        <td key={d} className="p-0.5 text-center">
                          <span
                            className={cn(
                              "block rounded px-0.5 py-1 tabular-nums leading-tight",
                              t ? "bg-primary/10" : "bg-muted font-semibold text-muted-foreground",
                            )}
                          >
                            {t ? (
                              <>
                                {hora(t.entrada)}
                                <span className="block">{hora(t.saida)}</span>
                              </>
                            ) : (
                              "Folga"
                            )}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Button variant="ghost" onClick={onVoltar}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar para a equipe
      </Button>
    </div>
  );
}

function CartaoSugestao({
  titulo,
  descricao,
  c,
  temDemanda,
  emUso,
  onEscolher,
  limiteSemanal,
  pode42h,
  onHorario,
}: {
  titulo: string;
  descricao: string;
  c: ResultadoCenario;
  temDemanda: boolean;
  emUso: boolean;
  onEscolher: () => void;
  limiteSemanal?: number;
  pode42h?: Pode42h;
  onHorario?: (t: Turno | null) => void;
}) {
  const dias = DIAS_TRABALHO_SEMANA[c.modelo];
  const semana = dias ? (minutosTrabalhados(c.turno) * dias) / 60 : null;
  const preencher = limiteSemanal && onHorario ? turnoQuePreenche(c.turno, c.modelo, limiteSemanal) : null;
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border p-4", emUso && "border-primary bg-primary/5 ring-2 ring-primary/30")}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-snug">{titulo}</p>
        {emUso && (
          <Badge className="shrink-0">
            <Check className="mr-1 h-3 w-3" /> Em uso
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{descricao}</p>
      {emUso && c.erros > 0 && <p className="text-xs font-medium text-destructive">Tem pontos fora da regra (veja acima).</p>}
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]" title="Média de pessoas trabalhando em cada dia">
        {c.mediaPorDia.map((m, i) => (
          <div key={i} className="rounded bg-muted/60 py-1">
            <span className="block text-muted-foreground">{DIAS_LETRA[i]}</span>
            <span className="font-semibold tabular-nums">{Math.round(m)}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Pessoas trabalhando por dia · {fmtHoras(minutosTrabalhados(c.turno))} por dia, {DIAS_POR_SEMANA[c.modelo]}
        {semana !== null && (
          <>
            {" "}
            · <span className="font-medium text-foreground">{fmtHoras(semana * 60)} por semana</span>
            {limiteSemanal && semana < limiteSemanal ? ` (o limite é ${limiteSemanal}h)` : ""}
          </>
        )}
        {c.modelo === "12x36" && " · média de 2 semanas abaixo do limite"}
      </p>
      {preencher && pode42h && (
        <Button size="sm" variant="outline" className="h-auto whitespace-normal py-1 text-xs" onClick={() => onHorario?.(preencher)}>
          Usar as {limiteSemanal}h: {preencher.entrada} às {preencher.saida} ({fmtHoras(minutosTrabalhados(preencher))} por dia)
        </Button>
      )}
      {preencher && pode42h === "hora_extra" && (
        <p className="text-[11px] text-muted-foreground">
          Sem acordo coletivo, o que passar de 8h por dia ({fmtHoras(minutosTrabalhados(preencher) - 480)} por dia,{" "}
          {fmtHoras((minutosTrabalhados(preencher) - 480) * (dias ?? 5))} por semana) é hora extra paga com 50% a mais. A partir de
          16/12/2027 o limite cai para 40h: volte ao horário de 8h.
        </p>
      )}
      {preencher && !pode42h && (
        <p className="text-[11px] text-muted-foreground">
          Para usar as {limiteSemanal}h em {dias} dias ({fmtHoras(minutosTrabalhados(preencher))} por dia) é preciso acordo coletivo de compensação ou
          liberar a hora extra no bloqueio de jornada.
        </p>
      )}
      {c.personalizado && onHorario && (
        <button type="button" className="self-start text-[11px] text-primary underline" onClick={() => onHorario(null)}>
          Voltar ao horário padrão
        </button>
      )}
      {temDemanda && (
        <p className={cn("text-xs", c.diasDescobertos ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
          {c.diasDescobertos
            ? `Falta gente em ${c.diasDescobertos === 1 ? "1 dia" : `${c.diasDescobertos} dias`} do mês`
            : "Cobre as pessoas que você precisa"}
        </p>
      )}
      {!emUso && (
        <Button size="sm" className="mt-auto" onClick={onEscolher}>
          Quero esta
        </Button>
      )}
    </div>
  );
}
