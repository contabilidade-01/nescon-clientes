/**
 * Distribuição automática da escala: o cliente diz QUEM fica em que regra (grupos: "3 em
 * 12x36", "o resto em 5x2 com folga fixa na segunda", "6x1 com folga variável") e o
 * sistema sorteia a distribuição de folgas, turmas e rodízios dentro de cada grupo.
 *
 * Aleatória mas coesa:
 *  - aleatória: um sorteio com semente (dá para repetir e pedir "outra distribuição");
 *  - coesa: dentro do grupo os dias de folga são ESPALHADOS (rodízio sobre a lista
 *    embaralhada), para não juntar todo mundo de folga no mesmo dia; turmas da 12x36
 *    saem equilibradas (metade A, metade B).
 *
 * Cada tentativa passa pelo MESMO motor da grade (avaliarCenario). Só serve a que não tem
 * erro; entre as que servem, fica a que melhor cobre a demanda por dia da semana e deixa
 * o número de pessoas por dia mais uniforme.
 */
import { avaliarCenario, type ResultadoCenario } from "./cenarios";
import { configPadrao, type ConfigEmpresa, type ConfigPessoa, type ModeloChave } from "./planejamento";
import { PARES_5X2 } from "./porPessoa";
import { SEGMENTOS } from "./regras";

export interface GrupoDistribuicao {
  id: string;
  modelo: ModeloChave;
  /** Quantas pessoas entram no grupo; null = todas as que sobrarem. */
  quantidade: number | null;
  /** Ids de pessoas fixadas neste grupo (têm prioridade sobre a quantidade). */
  pessoas?: string[];
  /**
   * Dia de folga fixo (0 = domingo … 6 = sábado) ou null = variável (o sistema espalha).
   * Na 12x36 não se aplica; no 5x2 casa fechada é o dia em que a casa fecha.
   */
  folgaFixa: number | null;
  entrada?: string;
  saida?: string;
  intervaloMin?: number;
}

export interface ResultadoDistribuicao {
  /** A melhor tentativa (sem erro se `valida`). */
  cenario: ResultadoCenario;
  valida: boolean;
  semente: number;
  tentativas: number;
  validas: number;
  /** Quem ficou em cada grupo. */
  porGrupo: Record<string, string[]>;
}

type Pessoa = { id: string; nome: string };
type EmpresaDistribuicao = Pick<ConfigEmpresa, "segmento" | "temAcordoColetivo" | "demanda" | "bloqueio" | "diasFechados">;

/** Gerador com semente (mulberry32): o mesmo número dá a mesma distribuição. */
export function sorteador(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function embaralhar<T>(lista: T[], rnd: () => number): T[] {
  const out = [...lista];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** n valores tirados em rodízio da lista embaralhada: espalha sem repetir antes da hora. */
export function espalhar<T>(valores: T[], n: number, rnd: () => number): T[] {
  if (!valores.length) return [];
  const base = embaralhar(valores, rnd);
  return Array.from({ length: n }, (_, i) => base[i % base.length]);
}

/** Separa as pessoas nos grupos: primeiro as fixadas, depois por quantidade, na ordem. */
export function separarEmGrupos(pessoas: Pessoa[], grupos: GrupoDistribuicao[], rnd: () => number): Record<string, Pessoa[]> {
  const out: Record<string, Pessoa[]> = Object.fromEntries(grupos.map((g) => [g.id, []]));
  const usadas = new Set<string>();
  for (const g of grupos) {
    for (const id of g.pessoas || []) {
      const p = pessoas.find((x) => x.id === id);
      if (p && !usadas.has(id)) {
        out[g.id].push(p);
        usadas.add(id);
      }
    }
  }
  const livres = embaralhar(
    pessoas.filter((p) => !usadas.has(p.id)),
    rnd,
  );
  const resto = grupos.find((g) => g.quantidade === null);
  for (const g of grupos) {
    if (g.quantidade === null) continue;
    while (out[g.id].length < g.quantidade && livres.length) out[g.id].push(livres.shift()!);
  }
  const destino = resto ?? grupos[grupos.length - 1];
  if (destino) out[destino.id].push(...livres);
  return out;
}

const DIAS_UTEIS = [1, 2, 3, 4, 5, 6];

/** Monta a configuração de cada pessoa do grupo, com as folgas espalhadas. */
export function configsDoGrupo(
  g: GrupoDistribuicao,
  pessoas: Pessoa[],
  empresa: Pick<ConfigEmpresa, "segmento" | "diasFechados">,
  rnd: () => number,
): ConfigPessoa[] {
  const n = pessoas.length;
  const fixa = g.folgaFixa;
  const maxSemanas = Math.min(3, SEGMENTOS[empresa.segmento].domingoACadaSemanas);
  const base = pessoas.map((p) => {
    const c = configPadrao(p.id, p.nome, g.modelo);
    if (g.entrada) c.entrada = g.entrada;
    if (g.saida) c.saida = g.saida;
    if (g.intervaloMin !== undefined) c.intervaloMin = g.intervaloMin;
    return c;
  });

  switch (g.modelo) {
    case "6x1": {
      const dias = fixa !== null ? [fixa] : [0, 1, 2, 3, 4, 5, 6];
      espalhar(dias, n, rnd).forEach((d, i) => (base[i].folga6x1 = d));
      break;
    }
    case "5x2": {
      if (fixa !== null) {
        // Folga fixa + a segunda folga espalhada (o domingo entra na roda para cumprir o mínimo).
        const segundas = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== fixa);
        espalhar(segundas, n, rnd).forEach((d, i) => (base[i].folgas5x2 = [fixa, d]));
      } else {
        espalhar(PARES_5X2, n, rnd).forEach((par, i) => (base[i].folgas5x2 = [...par]));
      }
      break;
    }
    case "5x2_rev":
    case "4x3": {
      const dias = fixa !== null && fixa !== 0 ? [fixa] : DIAS_UTEIS;
      const semanas = 2 + Math.floor(rnd() * Math.max(1, maxSemanas - 1));
      espalhar(dias, n, rnd).forEach((d, i) => {
        base[i].folgaFixa = d;
        base[i].semanasRodizio = semanas;
      });
      embaralhar(
        Array.from({ length: n }, (_, i) => i % semanas),
        rnd,
      ).forEach((r, i) => (base[i].rodizio = r));
      break;
    }
    case "5x2_corrida": {
      // A folga anda sozinha; espalha a equipe pelos 7 pontos do ciclo.
      espalhar([0, 1, 2, 3, 4, 5, 6], n, rnd).forEach((r, i) => (base[i].rodizio = r));
      break;
    }
    case "5x2_fechado": {
      const fechado = fixa ?? empresa.diasFechados[0] ?? 1;
      const semanas = 1 + Math.floor(rnd() * Math.max(1, maxSemanas));
      espalhar(DIAS_UTEIS.filter((d) => d !== fechado), n, rnd).forEach((d, i) => {
        base[i].diaFechado = fechado;
        base[i].folgaFixa = d;
        base[i].semanasRodizio = semanas;
      });
      embaralhar(
        Array.from({ length: n }, (_, i) => i % semanas),
        rnd,
      ).forEach((r, i) => (base[i].rodizio = r));
      break;
    }
    case "12x36": {
      embaralhar(
        Array.from({ length: n }, (_, i) => (i % 2 ? "B" : "A") as "A" | "B"),
        rnd,
      ).forEach((t, i) => (base[i].turma = t));
      break;
    }
  }
  return base;
}

/** Quanto pior, maior: falta de gente contra a demanda pesa mais que a desigualdade entre os dias. */
export function nota(r: ResultadoCenario, demanda: number[], diasFechados: number[]): number {
  const abertos = r.mediaPorDia.map((m, d) => ({ m, d })).filter(({ d }) => !diasFechados.includes(d));
  const falta = abertos.reduce((a, { m, d }) => a + Math.max(0, (demanda[d] || 0) - m), 0);
  const media = abertos.reduce((a, x) => a + x.m, 0) / Math.max(1, abertos.length);
  const variancia = abertos.reduce((a, x) => a + (x.m - media) ** 2, 0) / Math.max(1, abertos.length);
  return r.diasDescobertos * 100 + falta * 10 + variancia;
}

export function distribuir(
  pessoas: Pessoa[],
  grupos: GrupoDistribuicao[],
  mes: string,
  empresa: EmpresaDistribuicao,
  feriados: Set<string>,
  semente = Date.now() % 1_000_000,
  tentativas = 40,
): ResultadoDistribuicao {
  let melhor: { r: ResultadoCenario; n: number; porGrupo: Record<string, string[]> } | null = null;
  let validas = 0;
  for (let t = 0; t < tentativas; t++) {
    const rnd = sorteador(semente * 7919 + t);
    const separados = separarEmGrupos(pessoas, grupos, rnd);
    const configs = grupos.flatMap((g) => configsDoGrupo(g, separados[g.id], empresa, rnd));
    // Mantém a ordem da equipe na grade.
    configs.sort((a, b) => pessoas.findIndex((p) => p.id === a.id) - pessoas.findIndex((p) => p.id === b.id));
    const p0 = configs[0] ?? configPadrao("x", "x", grupos[0]?.modelo ?? "5x2");
    const r = avaliarCenario(
      {
        id: `auto-${semente}-${t}`,
        nome: "Distribuição automática",
        descricao: grupos.map((g) => `${separados[g.id].length} em ${g.modelo}`).join(", "),
        modelo: p0.modelo,
        configs,
        turno: { entrada: p0.entrada, saida: p0.saida, intervaloMin: p0.intervaloMin },
        personalizado: false,
      },
      mes,
      empresa,
      feriados,
    );
    const porGrupo = Object.fromEntries(Object.entries(separados).map(([k, v]) => [k, v.map((p) => p.id)]));
    // Sem erro primeiro; entre as sem erro, a melhor nota; entre as com erro, a de menos erros.
    const n = r.podeAplicar ? nota(r, empresa.demanda, empresa.diasFechados) : 1e9 + r.erros;
    if (r.podeAplicar) validas++;
    if (!melhor || n < melhor.n) melhor = { r, n, porGrupo };
  }
  return {
    cenario: melhor!.r,
    valida: melhor!.r.podeAplicar,
    semente,
    tentativas,
    validas,
    porGrupo: melhor!.porGrupo,
  };
}
