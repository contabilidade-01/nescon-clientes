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
import {
  avaliarPessoa,
  configPadrao,
  diasDoMes,
  type ConfigEmpresa,
  type ConfigPessoa,
  type ModeloChave,
} from "./planejamento";
import { vigenciaEm } from "./regras";

export interface Cenario {
  id: string;
  nome: string;
  descricao: string;
  modelo: ModeloChave;
  configs: ConfigPessoa[];
  /** Motivo de nem montar o cenário (ex.: 6x1 depois da emenda). */
  indisponivel?: string;
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
  podeAplicar: boolean;
}

type Pessoa = { id: string; nome: string };

/**
 * `variacao` muda quem folga em que dia sem mudar o modelo: o botão "outra variação"
 * soma 1 e a tela recalcula.
 */
export function montarCenarios(pessoas: Pessoa[], mes: string, empresa: Pick<ConfigEmpresa, "temAcordoColetivo">, variacao = 0): Cenario[] {
  const repousos = vigenciaEm(diasDoMes(mes).at(-1)!).repousosSemanais;
  const cada = (modelo: ModeloChave, f: (c: ConfigPessoa, i: number) => Partial<ConfigPessoa> = () => ({})) =>
    pessoas.map((p, i) => {
      const c = configPadrao(p.id, p.nome, modelo);
      return { ...c, ...f(c, i) };
    });
  const v = Math.max(0, Math.floor(variacao));
  const espalha = (i: number) => ((i + v) % 6) + 1;

  return [
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
      descricao: "Mais gente no domingo: cada pessoa folga 1 domingo a cada 3, o mínimo do comércio.",
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
  ];
}

export function avaliarCenario(
  cenario: Cenario,
  mes: string,
  empresa: Pick<ConfigEmpresa, "segmento" | "temAcordoColetivo" | "demanda" | "bloqueio">,
  feriados: Set<string>,
): ResultadoCenario {
  const dias = diasDoMes(mes);
  const avaliacoes = cenario.configs.map((c) => avaliarPessoa(c, mes, {}, empresa, feriados));
  const ocorrencias = avaliacoes.flatMap((a) => a.ocorrencias);
  const erros = ocorrencias.filter((o) => o.gravidade === "erro");
  const motivos = [...new Set(erros.map((o) => o.mensagem))];
  const bloqueio = bloqueioDoCenario(cenario.configs, empresa.bloqueio);
  if (bloqueio) motivos.unshift(bloqueio);
  if (cenario.indisponivel) motivos.unshift(cenario.indisponivel);

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
    motivos: motivos.slice(0, 3),
    mediaPorDia: soma.map((s, i) => (conta[i] ? s / conta[i] : 0)),
    diasDescobertos,
    horasSemana: horas / n / (dias.length / 7),
    domingosDeFolga: domingos / n,
    podeAplicar: !cenario.indisponivel && !bloqueio && erros.length === 0 && cenario.configs.length > 0,
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
  empresa: Pick<ConfigEmpresa, "segmento" | "temAcordoColetivo" | "demanda" | "bloqueio">,
  feriados: Set<string>,
  variacao = 0,
): ResultadoCenario[] {
  return montarCenarios(pessoas, mes, empresa, variacao).map((c) => avaliarCenario(c, mes, empresa, feriados));
}
