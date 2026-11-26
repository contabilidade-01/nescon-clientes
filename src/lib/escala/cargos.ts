import type { Demanda } from "./contingente";
import { diaDaSemana } from "./datas";
import type { DiaEscala } from "./modelos";
import type { Segmento } from "./regras";

/**
 * Cargos na escala: a empresa diz o cargo de cada pessoa (vem do cadastro da folha e pode
 * ser trocado na tela) e, se quiser, quantas pessoas de cada cargo precisa por dia da
 * semana (ex.: restaurante com 1 cozinheiro, 1 ajudante de cozinha e 2 garçons). A grade, a
 * semana do modo simples e o PDF mostram o cargo ao lado do nome e quantos de cada cargo
 * trabalham no dia, marcando o dia que fica abaixo do mínimo. Não é regra da lei: é aviso.
 */

/** Cargo limpo (até 40 letras, espaços normais) ou undefined. */
export function nomeDeCargo(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  return s || undefined;
}

/** Chave para comparar cargos ("COZINHEIRO" = "Cozinheiro"). */
export function chaveDoCargo(c: string): string {
  return c
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Sugestões do campo cargo por atividade (o cliente pode digitar qualquer outro). */
export const CARGOS_SUGERIDOS: Record<Segmento, string[]> = {
  restaurante: ["Cozinheiro(a)", "Ajudante de cozinha", "Garçom/Garçonete", "Ajudante geral", "Atendente", "Caixa", "Auxiliar de limpeza", "Gerente"],
  comercio: ["Vendedor(a)", "Caixa", "Repositor(a)", "Estoquista", "Atendente", "Auxiliar de limpeza", "Gerente"],
  construcao_civil: ["Pedreiro", "Servente", "Carpinteiro", "Armador", "Eletricista", "Encarregado"],
  outro: ["Auxiliar administrativo", "Recepcionista", "Atendente", "Auxiliar de limpeza", "Gerente"],
};

/** Lê `cargos` (id -> cargo) e `minimoPorCargo` (cargo -> 7 números) do JSON salvo. */
export function normalizarCargos(o: Record<string, unknown>): { cargos: Record<string, string>; minimoPorCargo: Record<string, Demanda> } {
  const cargos: Record<string, string> = {};
  if (o.cargos && typeof o.cargos === "object" && !Array.isArray(o.cargos)) {
    for (const [id, c] of Object.entries(o.cargos as Record<string, unknown>)) {
      const nome = nomeDeCargo(c);
      if (nome) cargos[id] = nome;
    }
  }
  const minimoPorCargo: Record<string, Demanda> = {};
  if (o.minimoPorCargo && typeof o.minimoPorCargo === "object" && !Array.isArray(o.minimoPorCargo)) {
    for (const [c, v] of Object.entries(o.minimoPorCargo as Record<string, unknown>)) {
      const nome = nomeDeCargo(c);
      if (!nome || !Array.isArray(v) || v.length !== 7) continue;
      const d = v.map((n) => Math.max(0, Math.min(99, Math.floor(Number(n) || 0)))) as Demanda;
      if (d.some((n) => n > 0)) minimoPorCargo[nome] = d;
    }
  }
  return { cargos, minimoPorCargo };
}

/**
 * Cargo de cada pessoa na escala: o que a empresa marcou na tela vale; senão o do cadastro
 * da folha; senão o que já estava no mês (vaga simulada).
 */
export function aplicarCargos<T extends { id: string; cargo?: string }>(
  configs: T[],
  cargosDaEmpresa: Record<string, string> | undefined,
  doCadastro: Map<string, string | null | undefined>,
): T[] {
  return configs.map((c) => {
    const cargo = nomeDeCargo(cargosDaEmpresa?.[c.id]) ?? nomeDeCargo(doCadastro.get(c.id)) ?? nomeDeCargo(c.cargo);
    return cargo === c.cargo ? c : { ...c, cargo };
  });
}

/** Cargos da equipe e os que têm mínimo, na ordem em que aparecem (sem repetir). */
export function cargosEmUso(pessoas: Array<{ cargo?: string }>, minimoPorCargo: Record<string, Demanda> = {}): string[] {
  const vistos = new Map<string, string>();
  for (const c of [...Object.keys(minimoPorCargo), ...pessoas.map((p) => p.cargo)]) {
    if (c && !vistos.has(chaveDoCargo(c))) vistos.set(chaveDoCargo(c), c);
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b));
}

export interface CoberturaDoCargo {
  cargo: string;
  /** Quantos desse cargo trabalham em cada data. */
  porDia: Map<string, number>;
  /** Mínimo por dia da semana (0 = sem mínimo). */
  minimo: Demanda;
  /** Datas abaixo do mínimo. */
  faltas: string[];
}

/** Quantos de cada cargo trabalham em cada data, contra o mínimo do dia da semana. */
export function coberturaPorCargo(
  linhas: Array<{ config: { cargo?: string }; dias: DiaEscala[] }>,
  datas: string[],
  minimoPorCargo: Record<string, Demanda> = {},
): CoberturaDoCargo[] {
  const cargos = cargosEmUso(
    linhas.map((l) => l.config),
    minimoPorCargo,
  );
  const minimoDe = (cargo: string): Demanda =>
    Object.entries(minimoPorCargo).find(([c]) => chaveDoCargo(c) === chaveDoCargo(cargo))?.[1] ?? [0, 0, 0, 0, 0, 0, 0];
  return cargos.map((cargo) => {
    const k = chaveDoCargo(cargo);
    const doCargo = linhas.filter((l) => l.config.cargo && chaveDoCargo(l.config.cargo) === k);
    const porDia = new Map(datas.map((d) => [d, doCargo.filter((l) => l.dias.find((x) => x.data === d)?.turno).length]));
    const minimo = minimoDe(cargo);
    const faltas = datas.filter((d) => (porDia.get(d) ?? 0) < minimo[diaDaSemana(d)]);
    return { cargo, porDia, minimo, faltas };
  });
}
