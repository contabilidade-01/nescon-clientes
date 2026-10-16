/**
 * Cenários prontos de escala para o mês: cada um monta a equipe inteira num modelo,
 * passa pelo mesmo motor de regras da grade e só pode ser aplicado se não tiver erro.
 *
 * A variedade fica aqui (quem folga em que dia, quantas semanas o domingo leva para
 * voltar, turmas da 12x36); a régua não muda: domingo pelo mínimo do segmento, as duas
 * folgas da emenda, jornada, interjornada e feriados.
 */
import { motivoBloqueio, type ModoBloqueio } from "./bloqueio";
import { diaDaSemana } from "./datas";
import { minutosTrabalhados, type Turno } from "./modelos";
import {
  avaliarPessoa,
  configPadrao,
  diasDoMes,
  MODELOS,
  type Ajustes,
  type ConfigEmpresa,
  type ConfigPessoa,
  type ModeloChave,
} from "./planejamento";
import { SEGMENTOS, vigenciaEm } from "./regras";

export interface Cenario {
  id: string;
  nome: string;
  descricao: string;
  modelo: ModeloChave;
  configs: ConfigPessoa[];
  /** Motivo de nem montar o cenário (ex.: 6x1 depois da emenda). */
  indisponivel?: string;
  /** Horário que todos do cenário cumprem (o padrão do modelo ou o que o cliente digitou). */
  turno: Turno;
  personalizado: boolean;
}

export interface ResultadoCenario extends Cenario {
  erros: number;
  avisos: number;
  /** Primeiros motivos de erro, para a tela dizer por que não dá. */
  motivos: string[];
  /** Média de pessoas trabalhando em cada dia da semana (domingo a sábado). */
  mediaPorDia: number[];
  /** Dias do mês em que trabalham menos pessoas do que a demanda pede. */
  diasDescobertos: number;
  /** Média de horas por semana por pessoa. */
  horasSemana: number;
  domingosDeFolga: number;
  /** Maior semana de alguém e o limite dela: passa disso, a tela pinta de vermelho. */
  maiorSemana: number;
  limiteSemana: number;
  /** Horas do dia acima de 8h (hora extra) ou do teto (erro). */
  horasDia: number;
  /** A semana acima do limite é erro (sem acordo), aviso (acordo ou 12x36) ou não acontece. */
  semanaAcima: "erro" | "atencao" | null;
  podeAplicar: boolean;
}

const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

type Pessoa = { id: string; nome: string };

/**
 * `variacao` muda quem folga em que dia sem mudar o modelo: o botão "outra variação"
 * soma 1 e a tela recalcula.
 */
export function montarCenarios(
  pessoas: Pessoa[],
  mes: string,
  empresa: Pick<ConfigEmpresa, "temAcordoColetivo" | "segmento">,
  variacao = 0,
  horarios: Record<string, Turno> = {},
): Cenario[] {
  const repousos = vigenciaEm(diasDoMes(mes).at(-1)!).repousosSemanais;
  const v = Math.max(0, Math.floor(variacao));
  const espalha = (i: number) => ((i + v) % 6) + 1;
  // Fecha num dia da semana: a 2ª folga gira pelos dias em que a casa abre (menos domingo).
  const espalhaSem = (fechado: number, i: number) => {
    const dias = [1, 2, 3, 4, 5, 6].filter((d) => d !== fechado);
    return dias[(i + v) % dias.length];
  };
  const domingoACada = SEGMENTOS[empresa.segmento].domingoACadaSemanas;

  const base: Array<Omit<Cenario, "configs" | "turno" | "personalizado"> & { configs: (id: string) => ConfigPessoa[] }> = [];
  const cada =
    (modelo: ModeloChave, f: (c: ConfigPessoa, i: number) => Partial<ConfigPessoa> = () => ({})) =>
    (id: string) =>
      pessoas.map((p, i) => {
        const c = configPadrao(p.id, p.nome, modelo);
        const h = horarios[id];
        return { ...c, ...f(c, i), ...(h ? { entrada: h.entrada, saida: h.saida, intervaloMin: h.intervaloMin } : {}) };
      });

  base.push(
    {
      id: "seg_sab",
      nome: "Segunda a sábado (fecha no domingo)",
      descricao: "Todos folgam no domingo e em mais 1 dia da semana, escalonado: a casa abre de segunda a sábado com a equipe quase inteira.",
      modelo: "5x2_fechado",
      configs: cada("5x2_fechado", (_, i) => ({ diaFechado: 0, folgaFixa: espalhaSem(0, i), semanasRodizio: 1 })),
    },
    {
      id: "fecha_seg",
      nome: "Fecha na segunda (abre de terça a domingo)",
      descricao: `Todos folgam na segunda; a outra folga gira na semana e cai no domingo 1 vez a cada ${domingoACada} semanas, o mínimo de ${SEGMENTOS[empresa.segmento].nome.toLowerCase()}.`,
      modelo: "5x2_fechado",
      configs: cada("5x2_fechado", (_, i) => ({
        diaFechado: 1,
        folgaFixa: espalhaSem(1, i),
        semanasRodizio: domingoACada,
        rodizio: (i + v) % domingoACada,
      })),
    },
    {
      id: "5x2_fds",
      nome: "5x2 com fim de semana livre",
      descricao: "Segunda a sexta, 8h. Todos folgam sábado e domingo.",
      modelo: "5x2",
      configs: cada("5x2", () => ({ folgas5x2: [6, 0] })),
    },
    {
      id: "5x2_dom_seg",
      nome: "5x2 com folga domingo e segunda",
      descricao: "Abre no sábado; todos folgam domingo e segunda.",
      modelo: "5x2",
      configs: cada("5x2", () => ({ folgas5x2: [0, 1] })),
    },
    {
      id: "5x2_rev2",
      nome: "5x2 em rodízio (domingo a cada 2 semanas)",
      descricao: "Abre todo dia. Metade da equipe folga em cada domingo; a outra folga cai durante a semana.",
      modelo: "5x2_rev",
      configs: cada("5x2_rev", (_, i) => ({ folgaFixa: espalha(i), rodizio: (i + v) % 2, semanasRodizio: 2 })),
    },
    {
      id: "5x2_rev3",
      nome: "5x2 em rodízio (domingo a cada 3 semanas)",
      descricao: "Mais gente no domingo: cada pessoa folga 1 domingo a cada 3 (no comércio, é o mínimo da lei).",
      modelo: "5x2_rev",
      configs: cada("5x2_rev", (_, i) => ({ folgaFixa: espalha(i), rodizio: (i + v) % 3, semanasRodizio: 3 })),
    },
    {
      id: "4x3",
      nome: "4x3 de 10h",
      descricao: "Quatro dias de 10h (40h) e três folgas, uma no domingo. Compensação de jornada: exige acordo.",
      modelo: "4x3",
      configs: cada("4x3", (_, i) => ({ folgaFixa: espalha(i) })),
      indisponivel: empresa.temAcordoColetivo ? undefined : "Exige acordo ou convenção coletiva de compensação (dias de 10h).",
    },
    {
      id: "12x36",
      nome: "12x36 em duas turmas",
      descricao: "Plantões de 12h em dias alternados; as turmas A e B se revezam e cobrem todos os dias.",
      modelo: "12x36",
      configs: cada("12x36", (_, i) => ({ turma: (i + v) % 2 === 0 ? "A" : "B" })),
    },
    {
      id: "6x1",
      nome: "6x1 de 44h com folga no domingo",
      descricao: "A escala de hoje. Só vale até 15/12/2026.",
      modelo: "6x1",
      configs: cada("6x1", () => ({ folga6x1: 0 })),
      indisponivel:
        repousos > 1 ? "Proibida a partir de 16/12/2026: a EC 141/2026 exige duas folgas por semana." : undefined,
    },
  );

  return base.map((c) => {
    const configs = c.configs(c.id);
    const p = configs[0] ?? configPadrao("x", "x", c.modelo);
    return {
      ...c,
      configs,
      turno: { entrada: p.entrada, saida: p.saida, intervaloMin: p.intervaloMin },
      personalizado: Boolean(horarios[c.id]),
    };
  });
}

type EmpresaCenario = Pick<ConfigEmpresa, "segmento" | "temAcordoColetivo" | "demanda" | "bloqueio"> & { diasFechados?: number[] };

export function avaliarCenario(
  cenario: Cenario,
  mes: string,
  empresa: EmpresaCenario,
  feriados: Set<string>,
  ajustes: Ajustes = {},
): ResultadoCenario {
  const dias = diasDoMes(mes);
  const avaliacoes = cenario.configs.map((c) => avaliarPessoa(c, mes, ajustes, empresa, feriados));
  const ocorrencias = avaliacoes.flatMap((a) => a.ocorrencias);
  const erros = ocorrencias.filter((o) => o.gravidade === "erro");
  const motivos = [...new Set(erros.map((o) => o.mensagem))];
  const bloqueio = bloqueioDoCenario(cenario.configs, empresa.bloqueio);
  if (bloqueio) motivos.unshift(bloqueio);
  // A casa fechada não é regra da lei, mas escalar gente no dia fechado não serve.
  const fechados = (empresa.diasFechados || []).filter((d) =>
    avaliacoes.some((a) => a.dias.some((x) => x.turno && diaDaSemana(x.data) === d)),
  );
  const foraDoFuncionamento = fechados.length
    ? `Escala gente na ${fechados.map((d) => NOMES_DIA[d]).join(" e na ")}, dia em que a casa fecha.`
    : null;
  if (foraDoFuncionamento) motivos.unshift(foraDoFuncionamento);
  if (cenario.indisponivel) motivos.unshift(cenario.indisponivel);
  const pior = avaliacoes.reduce(
    (a, x) => (x.maiorSemana - x.limiteSemana > a.maiorSemana - a.limiteSemana ? x : a),
    avaliacoes[0] ?? { maiorSemana: 0, limiteSemana: 0 },
  );

  const trabalhando = dias.map((d) => avaliacoes.filter((a) => a.dias.find((x) => x.data === d)?.turno).length);
  const soma = Array(7).fill(0);
  const conta = Array(7).fill(0);
  dias.forEach((d, i) => {
    soma[diaDaSemana(d)] += trabalhando[i];
    conta[diaDaSemana(d)] += 1;
  });
  const temDemanda = empresa.demanda.some((n) => n > 0);
  const diasDescobertos = temDemanda ? dias.filter((d, i) => trabalhando[i] < empresa.demanda[diaDaSemana(d)]).length : 0;
  const horas = avaliacoes.reduce((a, x) => a + x.horas, 0);
  const n = Math.max(1, cenario.configs.length);
  const domingos = avaliacoes.reduce(
    (a, x) => a + x.dias.filter((d) => diaDaSemana(d.data) === 0 && !d.turno).length,
    0,
  );

  return {
    ...cenario,
    erros: erros.length,
    avisos: ocorrencias.length - erros.length,
    motivos: motivos.slice(0, 4),
    mediaPorDia: soma.map((s, i) => (conta[i] ? s / conta[i] : 0)),
    diasDescobertos,
    horasSemana: horas / n / (dias.length / 7),
    domingosDeFolga: domingos / n,
    maiorSemana: pior.maiorSemana,
    limiteSemana: pior.limiteSemana,
    horasDia: minutosTrabalhados(cenario.turno) / 60,
    semanaAcima: avaliacoes.some((a) => a.semanaAcima === "erro")
      ? "erro"
      : avaliacoes.some((a) => a.semanaAcima === "atencao")
        ? "atencao"
        : null,
    podeAplicar: !cenario.indisponivel && !bloqueio && !foraDoFuncionamento && erros.length === 0 && cenario.configs.length > 0,
  };
}

function bloqueioDoCenario(configs: ConfigPessoa[], modo: ModoBloqueio): string | null {
  const c = configs[0];
  if (!c) return null;
  return motivoBloqueio({ entrada: c.entrada, saida: c.saida, intervaloMin: c.intervaloMin }, modo, c.modelo === "12x36");
}

export function simularCenarios(
  pessoas: Pessoa[],
  mes: string,
  empresa: EmpresaCenario,
  feriados: Set<string>,
  variacao = 0,
  horarios: Record<string, Turno> = {},
): ResultadoCenario[] {
  return montarCenarios(pessoas, mes, empresa, variacao, horarios).map((c) => avaliarCenario(c, mes, empresa, feriados));
}

/**
 * A escala que está na grade hoje, medida com a mesma régua dos cenários, para comparar
 * (ex.: o restaurante em 12x36 contra segunda a sábado).
 */
export function avaliarEscalaAtual(
  configs: ConfigPessoa[],
  ajustes: Ajustes,
  mes: string,
  empresa: EmpresaCenario,
  feriados: Set<string>,
): ResultadoCenario {
  const p = configs[0] ?? configPadrao("x", "x", "5x2");
  const modelos = [...new Set(configs.map((c) => c.modelo))];
  return avaliarCenario(
    {
      id: "atual",
      nome: "Escala atual",
      descricao: `O que está na grade agora: ${modelos.map((m) => MODELOS[m]).join(", ") || "sem ninguém"}.`,
      modelo: p.modelo,
      configs,
      turno: { entrada: p.entrada, saida: p.saida, intervaloMin: p.intervaloMin },
      personalizado: false,
    },
    mes,
    empresa,
    feriados,
    ajustes,
  );
}
