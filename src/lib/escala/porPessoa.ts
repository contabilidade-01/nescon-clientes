/**
 * Simulação de uma pessoa só, com o resto da equipe parado: para cada modelo, as variações
 * de folga que cabem na regra, já medidas contra a equipe (quantos trabalham em cada dia
 * e se a demanda fica descoberta). A régua é a mesma da grade e dos cenários.
 */
import { motivoBloqueio } from "./bloqueio";
import { diaDaSemana } from "./datas";
import {
  avaliarPessoa,
  configPadrao,
  diasDoMes,
  MODELOS,
  proximaFolga,
  type Ajustes,
  type AvaliacaoPessoa,
  type ConfigEmpresa,
  type ConfigPessoa,
  type ModeloChave,
} from "./planejamento";
import { SEGMENTOS, vigenciaEm } from "./regras";

const ABREV = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
/** Pares de folga do 5x2 fixo. */
export const PARES_5X2: number[][] = [[6, 0], [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]];

type EmpresaPessoa = Pick<ConfigEmpresa, "segmento" | "temAcordoColetivo" | "demanda" | "bloqueio" | "diasFechados">;

export interface OpcaoPessoa {
  modelo: ModeloChave;
  config: ConfigPessoa;
  /** Como ficam as folgas, em poucas palavras ("folga sáb+dom"). */
  resumo: string;
  avaliacao: AvaliacaoPessoa;
  erros: number;
  avisos: number;
  motivos: string[];
  horasSemana: number;
  domingosDeFolga: number;
  /** A equipe inteira com esta opção: média de pessoas por dia da semana (domingo a sábado). */
  mediaPorDia: number[];
  /** Dias do mês com menos gente que a demanda, com esta opção. */
  diasDescobertos: number;
  podeUsar: boolean;
  /** É a configuração que a pessoa já tem. */
  atual: boolean;
}

export interface GrupoOpcoes {
  modelo: ModeloChave;
  nome: string;
  /** Variações dentro da regra, da que melhor cobre a equipe para a pior. */
  opcoes: OpcaoPessoa[];
  /** Quando nenhuma variação serve: o porquê da primeira. */
  indisponivel?: string;
}

/** Folgas da configuração, para o cartão dizer sem abrir o painel. */
export function resumoFolgas(c: ConfigPessoa): string {
  switch (c.modelo) {
    case "6x1":
      return `folga ${ABREV[c.folga6x1]}`;
    case "5x2":
      return `folga ${c.folgas5x2.map((d) => ABREV[d]).join("+")}`;
    case "5x2_rev":
      return `folga ${ABREV[c.folgaFixa]}, dom. a cada ${c.semanasRodizio} sem. (grupo ${(c.rodizio % c.semanasRodizio) + 1})`;
    case "5x2_fechado":
      return c.diaFechado === 0 || c.semanasRodizio <= 1
        ? `folga ${ABREV[c.diaFechado]}+${ABREV[c.folgaFixa]}`
        : `folga ${ABREV[c.diaFechado]}+${ABREV[c.folgaFixa]}, dom. a cada ${c.semanasRodizio} sem. (grupo ${(c.rodizio % c.semanasRodizio) + 1})`;
    case "4x3":
      return `folga dom+${ABREV[c.folgaFixa]}+${ABREV[proximaFolga(c.folgaFixa)]}`;
    case "12x36":
      return `turma ${c.turma}`;
  }
}

/** Mesmas folgas e mesmo horário: é a configuração que a pessoa já tem. */
function mesmaConfig(a: ConfigPessoa, b: ConfigPessoa): boolean {
  if (a.modelo !== b.modelo || a.entrada !== b.entrada || a.saida !== b.saida || a.intervaloMin !== b.intervaloMin) return false;
  return resumoFolgas(a) === resumoFolgas(b);
}

/** Variações de folga de um modelo para a pessoa `c`. */
function variacoes(c: ConfigPessoa, modelo: ModeloChave, mes: string, empresa: EmpresaPessoa): ConfigPessoa[] {
  // Quem já está no modelo mantém o horário dele; quem troca entra no horário padrão do modelo.
  const base = c.modelo === modelo ? { ...c } : { ...configPadrao(c.id, c.nome, modelo) };
  const domingoACada = SEGMENTOS[empresa.segmento].domingoACadaSemanas;
  const out: ConfigPessoa[] = [];
  if (modelo === "6x1") for (let d = 0; d < 7; d++) out.push({ ...base, folga6x1: d });
  if (modelo === "5x2") for (const p of PARES_5X2) out.push({ ...base, folgas5x2: p });
  if (modelo === "5x2_rev") {
    for (const n of [2, 3]) for (let f = 1; f <= 6; f++) for (let r = 0; r < n; r++) out.push({ ...base, folgaFixa: f, semanasRodizio: n, rodizio: r });
  }
  if (modelo === "5x2_fechado") {
    // O dia fechado vem da empresa; sem ele, fica o que a pessoa já tinha (domingo, de início).
    const fechados = empresa.diasFechados.length ? empresa.diasFechados : [base.diaFechado];
    for (const fechado of fechados) {
      const n = fechado === 0 ? 1 : domingoACada;
      for (let f = 1; f <= 6; f++) {
        if (f === fechado) continue;
        for (let r = 0; r < n; r++) out.push({ ...base, diaFechado: fechado, folgaFixa: f, semanasRodizio: n, rodizio: r });
      }
    }
  }
  if (modelo === "4x3") for (let f = 1; f <= 6; f++) out.push({ ...base, folgaFixa: f });
  if (modelo === "12x36") for (const t of ["A", "B"] as const) out.push({ ...base, turma: t });
  return out;
}

/**
 * Opções de escala para uma pessoa, agrupadas por modelo. `equipe` é a avaliação de todos
 * como estão hoje (a mesma da grade); a pessoa sai da conta e entra com cada variação.
 */
export function opcoesDaPessoa(
  c: ConfigPessoa,
  equipe: AvaliacaoPessoa[],
  ajustes: Ajustes,
  mes: string,
  empresa: EmpresaPessoa,
  feriados: Set<string>,
): GrupoOpcoes[] {
  const dias = diasDoMes(mes);
  const repousos = vigenciaEm(dias.at(-1)!).repousosSemanais;
  const semanas = dias.length / 7;
  const temDemanda = empresa.demanda.some((n) => n > 0);
  // Quantos dos OUTROS trabalham em cada dia do mês.
  const outros = dias.map((d) => equipe.filter((a) => a.config.id !== c.id && a.dias.find((x) => x.data === d)?.turno).length);

  const medir = (cfg: ConfigPessoa, avaliacao: AvaliacaoPessoa): OpcaoPessoa => {
    const trabalha = new Set(avaliacao.dias.filter((d) => d.turno).map((d) => d.data));
    const total = dias.map((d, i) => outros[i] + (trabalha.has(d) ? 1 : 0));
    const soma = Array(7).fill(0);
    const conta = Array(7).fill(0);
    dias.forEach((d, i) => {
      soma[diaDaSemana(d)] += total[i];
      conta[diaDaSemana(d)] += 1;
    });
    const erros = avaliacao.ocorrencias.filter((o) => o.gravidade === "erro");
    const motivos = [...new Set(erros.map((o) => o.mensagem))];
    const bloqueio = motivoBloqueio({ entrada: cfg.entrada, saida: cfg.saida, intervaloMin: cfg.intervaloMin }, empresa.bloqueio, cfg.modelo === "12x36");
    if (bloqueio) motivos.unshift(bloqueio);
    const fechados = empresa.diasFechados.filter((f) => [...trabalha].some((d) => diaDaSemana(d) === f));
    if (fechados.length) motivos.unshift(`Trabalha na ${fechados.map((f) => NOMES_DIA[f]).join(" e na ")}, dia em que a casa fecha.`);
    if (cfg.modelo === "6x1" && repousos > 1) motivos.unshift("6x1 proibida a partir de 16/12/2026: a EC 141/2026 exige duas folgas por semana.");
    if (cfg.modelo === "4x3" && !empresa.temAcordoColetivo) motivos.unshift("4x3 de 10h exige acordo ou convenção coletiva de compensação.");
    return {
      modelo: cfg.modelo,
      config: cfg,
      resumo: resumoFolgas(cfg),
      avaliacao,
      erros: erros.length,
      avisos: avaliacao.ocorrencias.length - erros.length,
      motivos: motivos.slice(0, 3),
      horasSemana: avaliacao.horas / semanas,
      domingosDeFolga: avaliacao.dias.filter((d) => diaDaSemana(d.data) === 0 && !d.turno).length,
      mediaPorDia: soma.map((s, i) => (conta[i] ? s / conta[i] : 0)),
      diasDescobertos: temDemanda ? dias.filter((d, i) => total[i] < empresa.demanda[diaDaSemana(d)]).length : 0,
      podeUsar: motivos.length === 0,
      atual: mesmaConfig(cfg, c),
    };
  };

  // Cobertura mais igual entre os dias em que a casa abre: menos dia vazio e menos dia lotado.
  const desequilibrio = (o: OpcaoPessoa) => {
    const abertos = o.mediaPorDia.filter((_, d) => !empresa.diasFechados.includes(d));
    const media = abertos.reduce((a, x) => a + x, 0) / Math.max(1, abertos.length);
    return abertos.reduce((a, x) => a + (x - media) ** 2, 0);
  };
  const ordenar = (a: OpcaoPessoa, b: OpcaoPessoa) =>
    a.diasDescobertos - b.diasDescobertos || desequilibrio(a) - desequilibrio(b) || b.domingosDeFolga - a.domingosDeFolga;

  const atual = medir(c, avaliarPessoa(c, mes, ajustes, empresa, feriados));
  const modelos = Object.keys(MODELOS) as ModeloChave[];
  return modelos.map((modelo) => {
    const todas = variacoes(c, modelo, mes, empresa).map((v) => {
      // A configuração que a pessoa já tem entra com os ajustes feitos à mão na grade.
      if (mesmaConfig(v, c)) return atual;
      return medir(v, avaliarPessoa(v, mes, {}, empresa, feriados));
    });
    const opcoes = todas.filter((o) => o.podeUsar && !o.atual).sort(ordenar);
    // A configuração atual vem primeiro, mesmo com erro, para comparar com as outras.
    const lista = [...(c.modelo === modelo ? [atual] : []), ...opcoes];
    return {
      modelo,
      nome: MODELOS[modelo],
      opcoes: lista,
      indisponivel: lista.length ? undefined : todas[0]?.motivos[0] || "Nenhuma variação cabe na regra deste mês.",
    };
  });
}
