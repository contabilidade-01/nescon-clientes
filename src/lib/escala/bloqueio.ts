/**
 * Bloqueio intencional de jornada: com ele ligado, o planejador RECUSA a mudança que
 * deixaria alguém trabalhando além do limite do dia — em vez de só pintar de vermelho.
 * É escolha da empresa (fica na configuração dela):
 *  - desligado: deixa montar e só avisa (o padrão do motor de regras).
 *  - limite_legal: barra acima de 10h trabalhadas (8h + 2h extras, CLT art. 59);
 *    na 12x36, acima de 12h.
 *  - sem_hora_extra: barra qualquer minuto acima de 8h (na 12x36, acima de 12h).
 */
import { minutosTrabalhados, type Turno } from "./modelos";
import { CLT } from "./regras";

export type ModoBloqueio = "desligado" | "limite_legal" | "sem_hora_extra";

export const MODOS_BLOQUEIO: Record<ModoBloqueio, string> = {
  desligado: "Só avisar",
  limite_legal: "Bloquear acima de 10h (8h + 2h extras)",
  sem_hora_extra: "Bloquear qualquer hora extra (acima de 8h)",
};

/** Teto do dia em minutos para o modo, ou null quando não bloqueia. */
export function tetoDoDia(modo: ModoBloqueio, regime12x36: boolean): number | null {
  if (modo === "desligado") return null;
  if (regime12x36) return CLT.plantao12x36Horas * 60;
  const base = CLT.limiteDiarioHoras * 60;
  return modo === "limite_legal" ? base + CLT.maxHorasExtrasDia * 60 : base;
}

/** Motivo do bloqueio, ou null se o turno pode ficar. Folga nunca bloqueia. */
export function motivoBloqueio(turno: Turno | null, modo: ModoBloqueio, regime12x36: boolean): string | null {
  if (!turno) return null;
  const teto = tetoDoDia(modo, regime12x36);
  if (teto === null) return null;
  const trab = minutosTrabalhados(turno);
  if (trab <= teto) return null;
  const fmt = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
  return `Bloqueado: ${fmt(trab)} de trabalho no dia passa do limite de ${fmt(teto)}.`;
}
