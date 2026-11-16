/**
 * Jornada do funcionário contra a EC 141/2026: diz se o que está no cadastro cabe na
 * regra de uma data. Usado na lista de funcionários do cliente, na conferência e no
 * painel de prontidão do escritório. Os números vêm de src/lib/escala/regras.ts.
 */
import { CLT, VIGENCIAS, vigenciaEm, type Vigencia } from "@/lib/escala/regras";

export type EscalaFuncionario = "5x2" | "6x1" | "12x36" | "4x3" | "outra";

export const ESCALAS_FUNCIONARIO: Array<{ id: EscalaFuncionario; label: string }> = [
  { id: "5x2", label: "5x2 (5 dias, 2 folgas)" },
  { id: "6x1", label: "6x1 (6 dias, 1 folga)" },
  { id: "12x36", label: "12x36 (plantões)" },
  { id: "4x3", label: "4x3 (4 dias de 10h)" },
  { id: "outra", label: "Outra" },
];

export const FOLGAS_FUNCIONARIO = [
  "Sábado e domingo",
  "Domingo",
  "Domingo e segunda-feira",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Folga variável (rodízio)",
  "Conforme escala 12x36",
] as const;

export interface JornadaCadastro {
  carga_semanal?: number | string | null;
  escala?: string | null;
  folga?: string | null;
  horario_entrada?: string | null;
  horario_saida?: string | null;
  hipersuficiente?: boolean | null;
}

export type NivelJornada = "ok" | "atencao" | "fora" | "sem_dado";

export interface SituacaoJornada {
  nivel: NivelJornada;
  /** Frase curta para a lista ("Acima de 42h"). */
  rotulo: string;
  /** Explicação para o cliente, quando há o que fazer. */
  detalhe?: string;
  vigencia: Vigencia;
}

/** Etapas da emenda: 42h em 16/12/2026, 40h em 16/12/2027. */
export const ETAPA_42H = VIGENCIAS[1];
export const ETAPA_40H = VIGENCIAS[2];

/** Divisor mensal do salário-hora para um limite semanal (44 → 220, 42 → 210, 40 → 200). */
export function divisorMensal(horasSemana: number): number {
  return Math.round(horasSemana * 5);
}

export function cargaNumero(v: JornadaCadastro["carga_semanal"]): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Texto curto do cadastro: "44h · 6x1 · folga Domingo". */
export function resumoJornada(j: JornadaCadastro): string {
  const partes: string[] = [];
  const c = cargaNumero(j.carga_semanal);
  if (c) partes.push(`${String(c).replace(".", ",")}h`);
  if (j.escala) partes.push(j.escala === "outra" ? "outra escala" : j.escala);
  if (j.folga) partes.push(`folga ${j.folga.toLowerCase()}`);
  if (j.horario_entrada && j.horario_saida) partes.push(`${j.horario_entrada}–${j.horario_saida}`);
  return partes.join(" · ");
}

/**
 * Situação da jornada numa data 'YYYY-MM-DD'.
 *  - fora: carga acima do limite, ou 6x1 depois de 16/12/2026 (a emenda exige 2 folgas).
 *  - atencao: 12x36 na etapa 2 (40h: a média com intervalo indenizado é 42h) ou 42h
 *    na etapa 1 (só cabe em 5 dias com acordo/convenção que amplie o dia para 8h24).
 *  - sem_dado: o cadastro não diz a carga nem a escala.
 */
export function situacaoJornada(j: JornadaCadastro, data: string): SituacaoJornada {
  const v = vigenciaEm(data);
  const carga = cargaNumero(j.carga_semanal);
  const escala = j.escala || null;

  if (j.hipersuficiente) {
    return { nivel: "ok", rotulo: "Hipersuficiente", detalhe: "Fora do limite de horas da emenda; mantém as folgas.", vigencia: v };
  }
  if (!carga && !escala) return { nivel: "sem_dado", rotulo: "Jornada não informada", vigencia: v };

  if (escala === "12x36") {
    if (v.limiteSemanalHoras < 42) {
      return {
        nivel: "atencao",
        rotulo: "12x36: conferir intervalo",
        detalhe: `A 12x36 continua permitida. Com 1h de intervalo usufruído a média fica em 38h30 e cabe nas ${v.limiteSemanalHoras}h; com intervalo indenizado a média (42h) passa e precisa de previsão na convenção coletiva.`,
        vigencia: v,
      };
    }
    return { nivel: "ok", rotulo: "12x36", vigencia: v };
  }

  if (escala === "6x1" && v.repousosSemanais >= 2) {
    return {
      nivel: "fora",
      rotulo: "6x1 não vale mais",
      detalhe: `Desde ${dataBR(ETAPA_42H.inicio)} são 2 folgas por semana. Passe para 5x2 ou outra escala no planejador.`,
      vigencia: v,
    };
  }

  if (carga && carga > v.limiteSemanalHoras) {
    return {
      nivel: "fora",
      rotulo: `Acima de ${v.limiteSemanalHoras}h`,
      detalhe: `${String(carga).replace(".", ",")}h por semana passa do limite de ${v.limiteSemanalHoras}h em vigor desde ${dataBR(v.inicio)}. O salário não pode ser reduzido.`,
      vigencia: v,
    };
  }

  if (carga && v.repousosSemanais >= 2 && carga > CLT.limiteDiarioHoras * 5) {
    return {
      nivel: "atencao",
      rotulo: "Precisa de acordo",
      detalhe: `${String(carga).replace(".", ",")}h em 5 dias passa de 8h por dia: só com acordo ou convenção que amplie a jornada diária.`,
      vigencia: v,
    };
  }

  return { nivel: "ok", rotulo: "Dentro da regra", vigencia: v };
}

/**
 * Como a jornada fica nas próximas etapas: o que é ok hoje e deixa de ser em 16/12/2026
 * ou 16/12/2027. Devolve a primeira etapa futura em que a situação piora.
 */
export function proximoProblema(
  j: JornadaCadastro,
  hoje: string,
): { etapa: Vigencia; situacao: SituacaoJornada } | null {
  const atual = situacaoJornada(j, hoje);
  const peso = { sem_dado: 0, ok: 0, atencao: 1, fora: 2 } as const;
  for (const etapa of VIGENCIAS) {
    if (etapa.inicio <= hoje) continue;
    const s = situacaoJornada(j, etapa.inicio);
    if (peso[s.nivel] > peso[atual.nivel]) return { etapa, situacao: s };
  }
  return null;
}

export function dataBR(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export function hojeISO(agora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}
