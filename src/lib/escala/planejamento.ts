/**
 * Estado do planejador: o modelo escolhido para cada pessoa e os ajustes que o usuário
 * fez à mão (arrastar folga, editar horário de um dia). Fica separado da tela para dar
 * para testar sem React.
 */
import { diaDaSemana, diasEntre, inicioDaSemana, somarDias } from "./datas";
import { DiaEscala, ModeloEscala, Turno, escala5x2, escala6x1, gerarDias, minutosTrabalhados } from "./modelos";
import { MODOS_BLOQUEIO, type ModoBloqueio } from "./bloqueio";
import { DEMANDA_VAZIA, type Demanda } from "./contingente";
import type { FeriadoLocal } from "./feriados";
import { SEGMENTOS, viradaNoMes, vigenciaEm, type PerfilJornada, type Segmento } from "./regras";
import { nomeDeCargo, normalizarCargos } from "./cargos";
import { mediasDa12x36, validarEscala, type Ocorrencia, type ResumoSemana } from "./validar";

/**
 * - 6x1: só até 15/12/2026.
 * - 5x2: folgas fixas na semana.
 * - 5x2_rev: 5x2 com folgas em rodízio (o domingo de folga gira entre a equipe).
 * - 5x2_fechado: folga fixa no dia em que a casa fecha + 1 folga escalonada; se a casa
 *   abre no domingo, a 2ª folga cai no domingo a cada `semanasRodizio` semanas.
 * - 5x2_corrida: 5x2 com as 2 folgas juntas andando um dia por semana (seg+ter, ter+qua…),
 *   sempre dentro da semana de domingo a sábado; o ciclo tem 7 semanas.
 * - 5x2_domingo: domingo de folga toda semana + 1 folga que anda um dia por semana
 *   (ter, qua, qui, sex); ciclo de 4 semanas, nunca duas folgas seguidas e nunca mais
 *   de 4 dias seguidos de trabalho.
 * - 5x2_quinzenal: 5x2 em ciclo de 4 semanas com o domingo de folga a cada 2 semanas
 *   (dom+seg, seg+ter, dom+sáb, qui+sex): serve a restaurante/comércio e a mulheres.
 * - 5x2_3semanas: 5x2 em ciclo de 3 semanas (dom+sex, qua+qui, seg+ter): domingo de folga
 *   a cada 3 semanas, o mínimo do comércio/restaurante.
 * - 4x3: 4 dias de 10h, folga no domingo e em mais 2 dias (compensação, exige acordo).
 * - 12x36: plantão dia sim, dia não.
 */
export type ModeloChave = "6x1" | "5x2" | "5x2_rev" | "5x2_corrida" | "5x2_domingo" | "5x2_quinzenal" | "5x2_3semanas" | "5x2_fechado" | "4x3" | "12x36";

export const MODELOS: Record<ModeloChave, string> = {
  "6x1": "6x1",
  "5x2": "5x2 fixo",
  "5x2_rev": "5x2 rodízio",
  "5x2_corrida": "5x2 folga corrida",
  "5x2_domingo": "5x2 domingo fixo + folga variável",
  "5x2_quinzenal": "5x2 domingo quinzenal",
  "5x2_3semanas": "5x2 domingo a cada 3 semanas",
  "5x2_fechado": "5x2 casa fechada",
  "4x3": "4x3 (10h)",
  "12x36": "12x36",
};

/**
 * O modelo em palavras, para quem não é do DP: a sigla aparece pequena ao lado.
 */
export const MODELOS_EXPLICADOS: Record<ModeloChave, string> = {
  "6x1": "6 dias de trabalho e 1 folga",
  "5x2": "5 dias de trabalho, folgas fixas",
  "5x2_rev": "5 dias de trabalho, folgas que mudam a cada semana",
  "5x2_corrida": "5 dias de trabalho, as 2 folgas andam um dia por semana",
  "5x2_domingo": "5 dias de trabalho, folga todo domingo e mais 1 dia que muda a cada semana",
  "5x2_quinzenal": "5 dias de trabalho, folga no domingo a cada 2 semanas",
  "5x2_3semanas": "5 dias de trabalho, folga no domingo a cada 3 semanas",
  "5x2_fechado": "5 dias de trabalho, folga no dia em que a empresa fecha e em mais 1",
  "4x3": "4 dias de 10 horas e 3 folgas",
  "12x36": "Plantão de 12 horas e folga de 36 horas",
};

const NOMES_DIA_LONGO = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function listaDias(ds: number[]): string {
  const n = ds.map((d) => NOMES_DIA_LONGO[d]);
  return n.length > 1 ? `${n.slice(0, -1).join(", ")} e ${n.at(-1)}` : n[0] || "";
}

/** "Trabalha 5 dias e folga sábado e domingo, das 08:00 às 17:00." */
export function fraseDaPessoa(c: ConfigPessoa): string {
  const horario = `das ${c.entrada} às ${c.saida}`;
  switch (c.modelo) {
    case "6x1":
      return `Trabalha 6 dias e folga ${listaDias([c.folga6x1])}, ${horario}.`;
    case "5x2":
      return `Trabalha 5 dias e folga ${listaDias(c.folgas5x2)}, ${horario}.`;
    case "5x2_rev":
      return `Trabalha 5 dias; as folgas mudam a cada semana e caem no domingo a cada ${c.semanasRodizio} semanas, ${horario}.`;
    case "5x2_corrida":
      return `Trabalha 5 dias; as 2 folgas andam um dia por semana (${listaDias(folgasDaCorrida(c.rodizio))} na 1ª semana do ciclo), ${horario}.`;
    case "5x2_domingo":
      return `Trabalha 5 dias; folga todo domingo e mais 1 dia que anda um dia por semana (${listaDias(folgasDoDomingoFixo(c.rodizio))} na 1ª semana do ciclo), ${horario}.`;
    case "5x2_quinzenal":
      return `Trabalha 5 dias; folga no domingo a cada 2 semanas (${listaDias(folgasDaQuinzenal(c.rodizio))} na 1ª semana do ciclo), ${horario}.`;
    case "5x2_3semanas":
      return `Trabalha 5 dias; folga no domingo a cada 3 semanas (${listaDias(folgasDo3Semanas(c.rodizio))} na 1ª semana do ciclo), ${horario}.`;
    case "5x2_fechado":
      return `Trabalha 5 dias; folga ${listaDias([c.diaFechado])} (empresa fechada) e mais 1 dia, ${horario}.`;
    case "4x3":
      return `Trabalha 4 dias de 10 horas e folga 3, ${horario}.`;
    case "12x36":
      return `Plantão de 12 horas em dias alternados (turma ${c.turma}), ${horario}.`;
  }
}

/** O que o cadastro do funcionário diz da jornada (conferência feita pelo cliente). */
export interface CadastroJornada {
  escala?: string | null;
  folga?: string | null;
  horario_entrada?: string | null;
  horario_saida?: string | null;
}

const FOLGA_DIA: Record<string, number> = {
  domingo: 0,
  "segunda-feira": 1,
  "terça-feira": 2,
  "quarta-feira": 3,
  "quinta-feira": 4,
  "sexta-feira": 5,
  sábado: 6,
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Primeira escala de quem ainda não tem mês salvo, a partir do cadastro: modelo, folga e
 * horário que o cliente já informou. A 6x1 depois de 16/12/2026 vira o modelo padrão do mês
 * (com a 6x1 até a virada, quando é o mês dela); 4x3 sem acordo também cai no padrão.
 * Sem escala no cadastro, devolve null e vale o padrão.
 */
export function configDoCadastro(
  id: string,
  nome: string,
  cad: CadastroJornada | undefined,
  padrao: ModeloChave,
  opcoes: { permite6x1?: boolean; temAcordo?: boolean } = {},
): ConfigPessoa | null {
  if (!cad?.escala || cad.escala === "outra") return null;
  const folga = (cad.folga || "").trim().toLowerCase();
  const diaFolga = folga in FOLGA_DIA ? FOLGA_DIA[folga] : null;
  const horario = (c: ConfigPessoa): ConfigPessoa =>
    cad.horario_entrada && cad.horario_saida && HORA.test(cad.horario_entrada) && HORA.test(cad.horario_saida)
      ? { ...c, entrada: cad.horario_entrada, saida: cad.horario_saida }
      : c;
  switch (cad.escala) {
    case "12x36":
      return horario(configPadrao(id, nome, "12x36"));
    case "4x3":
      return opcoes.temAcordo ? horario(configPadrao(id, nome, "4x3")) : null;
    case "6x1": {
      if (opcoes.permite6x1) return horario({ ...configPadrao(id, nome, "6x1"), folga6x1: diaFolga ?? 0 });
      // Depois da emenda: modelo novo com o horário padrão dele (o de 44h não serve) e,
      // no mês da virada, a 6x1 com a mesma folga até o domingo antes da semana do dia 16.
      return { ...configPadrao(id, nome, padrao), folga6x1: diaFolga ?? 0 };
    }
    case "5x2": {
      if (folga === "sábado e domingo") return horario({ ...configPadrao(id, nome, "5x2"), folgas5x2: [6, 0] });
      if (folga === "domingo e segunda-feira") return horario({ ...configPadrao(id, nome, "5x2"), folgas5x2: [0, 1] });
      if (folga.includes("rodízio") || folga.includes("variável")) return horario(configPadrao(id, nome, "5x2_rev"));
      if (diaFolga !== null && diaFolga > 0) return horario({ ...configPadrao(id, nome, "5x2_rev"), folgaFixa: diaFolga });
      return horario(configPadrao(id, nome, "5x2"));
    }
    default:
      return null;
  }
}

/** Data base dos rodízios: um domingo fixo, para a semana do rodízio não depender do mês aberto. */
export const BASE_RODIZIO = "2026-01-04";

export interface ConfigPessoa {
  id: string;
  nome: string;
  modelo: ModeloChave;
  entrada: string;
  saida: string;
  intervaloMin: number;
  /** 6x1: dia da folga fixa. 0 = domingo. */
  folga6x1: number;
  /** 5x2: dias de folga. */
  folgas5x2: number[];
  /** 12x36: turma A trabalha no 1º dia do mês de referência, B no seguinte. */
  turma: "A" | "B";
  /** 5x2 rodízio e 4x3: dia de folga que acompanha o domingo (1 = segunda … 6 = sábado). */
  folgaFixa: number;
  /** 5x2 rodízio: em que semana do rodízio a pessoa começa (espalha os domingos). */
  rodizio: number;
  /**
   * De quantas em quantas semanas a folga cai no domingo: 2 ou 3 no 5x2 rodízio; de 1 a 7
   * no 5x2 casa fechada (respeitando o mínimo do segmento).
   */
  semanasRodizio: number;
  /** 5x2 casa fechada: dia em que o estabelecimento não abre (0 = domingo, 1 = segunda…). */
  diaFechado: number;
  /**
   * No mês da etapa 1 (dez/2026): a pessoa segue na 6x1 (folga em `folga6x1`) até o
   * domingo 13/12 e passa ao modelo escolhido na segunda 14/12, para a semana do dia 16
   * já ter as 2 folgas. Nos outros meses não muda nada.
   */
  seisPorUmAteVirada: boolean;
  /**
   * Unidade (loja, filial com o mesmo CNPJ) em que a pessoa trabalha, ex.: "Mairiporã",
   * "Terra Preta". Só etiqueta e filtro da grade; vazio = sem unidade.
   */
  unidade?: string;
  /** Cargo (cozinheiro, garçom…): etiqueta e conta de cobertura por cargo; vem do cadastro ou da tela. */
  cargo?: string;
  /**
   * Sexo da pessoa: "F" aplica o domingo de folga a cada 2 semanas (art. 386 da CLT).
   * Vazio = sem a regra da mulher.
   */
  sexo?: "F" | "M";
}

/** Ajustes manuais: pessoa -> data -> turno (null = folga). */
export type Ajustes = Record<string, Record<string, Turno | null>>;

const HORARIOS: Record<ModeloChave, [string, string]> = {
  "6x1": ["08:00", "16:20"], // 7h20 x 6 = 44h
  "5x2": ["08:00", "17:00"], // 8h x 5 = 40h
  "5x2_rev": ["08:00", "17:00"],
  "5x2_corrida": ["08:00", "17:00"],
  "5x2_domingo": ["08:00", "17:00"],
  "5x2_quinzenal": ["08:00", "17:00"],
  "5x2_3semanas": ["08:00", "17:00"],
  "5x2_fechado": ["08:00", "17:00"],
  "4x3": ["07:00", "18:00"], // 10h x 4 = 40h
  "12x36": ["07:00", "19:00"],
};

export function configPadrao(id: string, nome: string, modelo: ModeloChave = "6x1"): ConfigPessoa {
  return {
    id,
    nome,
    modelo,
    entrada: HORARIOS[modelo][0],
    saida: HORARIOS[modelo][1],
    intervaloMin: 60,
    folga6x1: 0,
    folgas5x2: [6, 0],
    turma: "A",
    folgaFixa: 1,
    rodizio: 0,
    semanasRodizio: 2,
    diaFechado: 0,
    seisPorUmAteVirada: true,
  };
}

/**
 * Modelo que já nasce dentro da regra do mês: 6x1 enquanto vale 1 repouso semanal, 5x2
 * depois; 12x36 quando a empresa trabalha nesse regime.
 */
export function modeloPadraoDoMes(mes: string, usa12x36 = false): ModeloChave {
  if (usa12x36) return "12x36";
  return vigenciaEm(diasDoMes(mes).at(-1)!).repousosSemanais > 1 ? "5x2" : "6x1";
}

/** Próximo dia de folga do rodízio: sempre de segunda a sábado e diferente do anterior. */
export function proximaFolga(d: number): number {
  return ((d + 2) % 6) + 1;
}

/** 2ª folga de quem tem folga fixa no dia fechado: nunca o próprio dia fechado nem o domingo. */
export function segundaFolga(fechado: number, desejada: number): number {
  for (let k = 0; k < 7; k++) {
    const d = ((desejada - 1 + k) % 6) + 1;
    if (d !== fechado) return d;
  }
  return 1;
}

/**
 * Semanas do rodízio de folgas: a 1ª tem domingo + `folgaFixa`; cada semana seguinte
 * repete uma folga da anterior e anda a outra. Como semanas vizinhas dividem um dia de
 * folga, nunca passam 6 dias seguidos de trabalho.
 */
export function semanasDoRodizio(folgaFixa: number, n: number): number[][] {
  const d = [folgaFixa];
  for (let i = 1; i < n; i++) d.push(proximaFolga(d[i - 1]));
  return [[0, d[0]], ...d.slice(1).map((x, i) => [d[i], x])];
}

/**
 * Folga corrida: as 2 folgas juntas andam um dia por semana. Para nunca deixar uma semana
 * (domingo a sábado) com 1 folga só, a dupla fica sempre dentro da semana: depois de
 * sex+sáb vêm dom+sáb e dom+seg (o domingo de folga cai 2 vezes a cada 7 semanas). Andar
 * um dia por semana sem parar seria um 6x2 e daria, a cada 8 semanas, 2 semanas com 1 folga
 * e 48h.
 */
export const SEMANAS_CORRIDA: number[][] = [
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [0, 6],
  [0, 1],
];

/**
 * Domingo fixo + folga variável: o domingo é folga toda semana e a 2ª folga anda um dia por
 * semana, de terça a sexta. Ela nunca cai no sábado nem na segunda, então nunca há duas
 * folgas seguidas (sáb+dom ou dom+seg) e nunca passam de 4 dias seguidos de trabalho.
 */
export const SEMANAS_DOMINGO: number[][] = [
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
];

/** Folgas da semana `grupo` do ciclo do domingo fixo (0 = dom+ter). */
export function folgasDoDomingoFixo(grupo: number): number[] {
  const n = SEMANAS_DOMINGO.length;
  return SEMANAS_DOMINGO[((grupo % n) + n) % n];
}

/** Folgas da semana `grupo` do ciclo da folga corrida (0 = seg+ter). */
export function folgasDaCorrida(grupo: number): number[] {
  const n = SEMANAS_CORRIDA.length;
  return SEMANAS_CORRIDA[((grupo % n) + n) % n];
}

/**
 * Domingo quinzenal: ciclo de 4 semanas em que o domingo de folga volta a cada 2 semanas
 * (regra da mulher, art. 386 da CLT, que também cobre os 3 do comércio). Ordem testada para
 * nunca passar de 6 dias seguidos de trabalho nem deixar semana com 1 folga só.
 */
export const SEMANAS_QUINZENAL: number[][] = [
  [0, 1],
  [1, 2],
  [0, 6],
  [4, 5],
];

/** Folgas da semana `grupo` do ciclo do domingo quinzenal (0 = dom+seg). */
export function folgasDaQuinzenal(grupo: number): number[] {
  const n = SEMANAS_QUINZENAL.length;
  return SEMANAS_QUINZENAL[((grupo % n) + n) % n];
}

/**
 * Domingo a cada 3 semanas: ciclo dom+sex, qua+qui, seg+ter. Os trechos de trabalho ficam
 * sempre entre 3 e 4 dias (4, 4, 3, 4), sem dia solto entre duas folgas; o sábado, dia mais
 * cheio de restaurante e comércio, nunca é folga, e cada outro dia folga em só 1 das 3 semanas.
 */
export const SEMANAS_3SEMANAS: number[][] = [
  [0, 5],
  [3, 4],
  [1, 2],
];

/** Folgas da semana `grupo` do ciclo de 3 semanas (0 = dom+sex). */
export function folgasDo3Semanas(grupo: number): number[] {
  const n = SEMANAS_3SEMANAS.length;
  return SEMANAS_3SEMANAS[((grupo % n) + n) % n];
}

/** Datas do mês 'YYYY-MM'. */
export function diasDoMes(mes: string): string[] {
  const inicio = `${mes}-01`;
  const [a, m] = mes.split("-").map(Number);
  const proximo = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
  const n = diasEntre(inicio, proximo);
  return Array.from({ length: n }, (_, i) => somarDias(inicio, i));
}

export function modeloDaPessoa(c: ConfigPessoa, mes: string): ModeloEscala {
  const turno: Turno = { entrada: c.entrada, saida: c.saida, intervaloMin: c.intervaloMin };
  if (c.modelo === "5x2") return escala5x2(turno, c.folgas5x2);
  if (c.modelo === "5x2_rev") {
    const n = c.semanasRodizio === 3 ? 3 : 2;
    const base = somarDias(BASE_RODIZIO, -7 * (((c.rodizio % n) + n) % n));
    return { tipo: "rotativo", nome: "5x2 rodízio", turno, semanas: semanasDoRodizio(c.folgaFixa, n), base };
  }
  if (c.modelo === "5x2_corrida") {
    const n = SEMANAS_CORRIDA.length;
    const base = somarDias(BASE_RODIZIO, -7 * (((c.rodizio % n) + n) % n));
    return { tipo: "rotativo", nome: "5x2 folga corrida", turno, semanas: SEMANAS_CORRIDA, base };
  }
  if (c.modelo === "5x2_domingo") {
    const n = SEMANAS_DOMINGO.length;
    const base = somarDias(BASE_RODIZIO, -7 * (((c.rodizio % n) + n) % n));
    return { tipo: "rotativo", nome: "5x2 domingo fixo", turno, semanas: SEMANAS_DOMINGO, base };
  }
  if (c.modelo === "5x2_quinzenal") {
    const n = SEMANAS_QUINZENAL.length;
    const base = somarDias(BASE_RODIZIO, -7 * (((c.rodizio % n) + n) % n));
    return { tipo: "rotativo", nome: "5x2 domingo quinzenal", turno, semanas: SEMANAS_QUINZENAL, base };
  }
  if (c.modelo === "5x2_3semanas") {
    const n = SEMANAS_3SEMANAS.length;
    const base = somarDias(BASE_RODIZIO, -7 * (((c.rodizio % n) + n) % n));
    return { tipo: "rotativo", nome: "5x2 domingo a cada 3 semanas", turno, semanas: SEMANAS_3SEMANAS, base };
  }
  if (c.modelo === "5x2_fechado") {
    const fechado = c.diaFechado;
    const outra = segundaFolga(fechado, c.folgaFixa);
    // Fecha no domingo: a semana é sempre a mesma. Fecha em outro dia: a 2ª folga cai no
    // domingo uma semana a cada N; como a folga do dia fechado se repete toda semana, nunca
    // passam 6 dias seguidos.
    if (fechado === 0) return { tipo: "semanal", nome: "5x2 casa fechada", turno, diasFolga: [0, outra] };
    const n = Math.min(7, Math.max(1, c.semanasRodizio));
    const semanas = Array.from({ length: n }, (_, i) => (i === 0 ? [fechado, 0] : [fechado, outra]));
    const base = somarDias(BASE_RODIZIO, -7 * (((c.rodizio % n) + n) % n));
    return { tipo: "rotativo", nome: "5x2 casa fechada", turno, semanas, base };
  }
  if (c.modelo === "4x3") {
    return { tipo: "semanal", nome: "4x3", turno, diasFolga: [0, c.folgaFixa, proximaFolga(c.folgaFixa)] };
  }
  if (c.modelo === "12x36") {
    const base = somarDias(`${mes}-01`, c.turma === "A" ? 0 : 1);
    return { tipo: "ciclo", nome: "12x36", base, ciclo: [turno, null] };
  }
  return escala6x1(turno, c.folga6x1);
}

/**
 * Dias da pessoa para VALIDAR: o mês inteiro mais o que faltar para fechar a primeira e
 * a última semana (domingo a sábado). Sem isso as semanas das pontas ficariam de fora da
 * conferência de horas e de folgas.
 */
export function diasParaValidar(
  c: ConfigPessoa,
  mes: string,
  ajustes: Ajustes,
  feriados: Set<string> = new Set(),
  opcoes: { abreNosFeriados?: boolean } = {},
): DiaEscala[] {
  const dias = diasDoMes(mes);
  const de = inicioDaSemana(dias[0]);
  const ultimo = dias[dias.length - 1];
  const ate = somarDias(ultimo, 6 - diaDaSemana(ultimo));
  const meus = ajustes[c.id] || {};
  // Feriado nasce de folga (fora a 12x36, que já paga o feriado no plantão). Trabalhar
  // nele é escolha do cliente, feita à mão, e a validação cobra a regra do segmento.
  // Se a empresa marcou que abre nos feriados, o feriado segue o modelo (quem está escalado
  // trabalha) e a validação avisa do pagamento em dobro ou da folga compensatória.
  const folgaNoFeriado = c.modelo !== "12x36" && !opcoes.abreNosFeriados;
  const ateVirada = diasAteAVirada(c, mes, de, ate);
  return gerarDias(modeloDaPessoa(c, mes), de, ate).map((d, i) => {
    if (Object.prototype.hasOwnProperty.call(meus, d.data)) return { data: d.data, turno: meus[d.data] };
    if (folgaNoFeriado && feriados.has(d.data)) return { data: d.data, turno: null };
    return ateVirada?.[i] ?? d;
  });
}

/**
 * Último dia da 6x1 no mês em que passam a valer as 2 folgas: o domingo que abre a semana
 * da etapa (13/12/2026). Essa semana já cobra 2 folgas, então o modelo novo entra na
 * segunda (14/12) e o domingo fica com a folga da 6x1; trocar no meio da semana deixaria
 * a semana da virada com 1 folga e mais de 42h.
 */
export function ultimoDiaDa6x1(viradaInicio: string): string {
  return inicioDaSemana(viradaInicio);
}

/**
 * No mês em que passam a valer as 2 folgas (dez/2026), os dias até `ultimoDiaDa6x1`
 * seguem a 6x1 de 44h que a pessoa já fazia. Devolve esses dias (alinhados com
 * `de`..`ate`), ou null quando não se aplica.
 */
function diasAteAVirada(c: ConfigPessoa, mes: string, de: string, ate: string): Array<DiaEscala | undefined> | null {
  const virada = viradaNoMes(mes);
  if (!virada || !c.seisPorUmAteVirada || c.modelo === "6x1" || c.modelo === "12x36") return null;
  if (virada.repousosSemanais <= vigenciaEm(somarDias(virada.inicio, -1)).repousosSemanais) return null;
  const ultimo = ultimoDiaDa6x1(virada.inicio);
  const turno: Turno = { entrada: HORARIOS["6x1"][0], saida: HORARIOS["6x1"][1], intervaloMin: 60 };
  return gerarDias(escala6x1(turno, c.folga6x1), de, ate).map((d) => (d.data <= ultimo ? d : undefined));
}

/** Regras que apontam um dia específico; as semanais e mensais vão só para a lista. */
export const REGRAS_DO_DIA = new Set(["JORNADA_DIARIA", "HORA_EXTRA", "INTERVALO", "INTERJORNADA", "DIAS_SEGUIDOS", "DOMINGO", "FERIADO"]);

export interface AvaliacaoPessoa {
  config: ConfigPessoa;
  /** Só os dias do mês planejado. */
  dias: DiaEscala[];
  /** O que vale para o mês: regras do dia que caem nele + regras de semana e de mês. */
  ocorrencias: Ocorrencia[];
  porDia: Map<string, "erro" | "atencao">;
  horas: number;
  /**
   * Semana mais carregada que toca o mês, e o limite da regra naquela semana. Na 12x36 é
   * a maior MÉDIA de duas semanas seguidas (a régua do regime), não a semana de 4 plantões.
   */
  maiorSemana: number;
  limiteSemana: number;
  /** Como a validação trata a semana acima do limite: erro, aviso (acordo/12x36) ou nada. */
  semanaAcima: "erro" | "atencao" | null;
  /**
   * Semanas inteiras (domingo a sábado) que tocam o mês, com os dias do mês vizinho: é
   * assim que a lei conta, então a semana cortada pelo mês aparece com as horas reais.
   */
  diasComVizinhos: DiaEscala[];
  semanasInteiras: ResumoSemana[];
}

export function perfilDa(c: ConfigPessoa, empresa: Pick<ConfigEmpresa, "segmento" | "temAcordoColetivo">): PerfilJornada {
  return {
    segmento: empresa.segmento,
    temAcordoColetivo: empresa.temAcordoColetivo,
    regime12x36: c.modelo === "12x36",
    mulher: c.sexo === "F",
  };
}

export function avaliarPessoa(
  c: ConfigPessoa,
  mes: string,
  ajustes: Ajustes,
  empresa: Pick<ConfigEmpresa, "segmento" | "temAcordoColetivo"> & { abreNosFeriados?: boolean },
  feriados: Set<string>,
): AvaliacaoPessoa {
  const todos = diasParaValidar(c, mes, ajustes, feriados, { abreNosFeriados: empresa.abreNosFeriados });
  const resultado = validarEscala(todos, perfilDa(c, empresa), feriados);
  const dias = todos.filter((d) => d.data.startsWith(mes));
  const porDia = new Map<string, "erro" | "atencao">();
  for (const o of resultado.ocorrencias) {
    if (!REGRAS_DO_DIA.has(o.regra)) continue;
    if (porDia.get(o.data) !== "erro") porDia.set(o.data, o.gravidade);
  }
  // As semanas das pontas entram na conta, mas o aviso de um dia do mês vizinho não é deste mês.
  const ocorrencias = resultado.ocorrencias.filter((o) => o.data.startsWith(mes) || !REGRAS_DO_DIA.has(o.regra));
  const horas = dias.reduce((a, d) => a + (d.turno ? minutosTrabalhados(d.turno) : 0), 0) / 60;
  const semanas = c.modelo === "12x36" ? mediasDa12x36(resultado.semanas) : resultado.semanas.filter((x) => x.completa);
  const pior = semanas.reduce<(typeof semanas)[number] | null>((a, x) => (!a || x.horas - x.limiteHoras > a.horas - a.limiteHoras ? x : a), null);
  const limite = ocorrencias.filter((o) => o.regra === "LIMITE_SEMANAL");
  const semanaAcima = limite.some((o) => o.gravidade === "erro") ? "erro" : limite.length ? "atencao" : null;
  return {
    config: c,
    dias,
    ocorrencias,
    porDia,
    horas,
    maiorSemana: pior?.horas ?? 0,
    limiteSemana: pior?.limiteHoras ?? 0,
    semanaAcima,
    diasComVizinhos: todos,
    semanasInteiras: resultado.semanas,
  };
}

/** Identidade de cada erro, para saber se uma mudança criou erro NOVO. */
export function chavesDeErro(ocorrencias: Ocorrencia[]): Set<string> {
  return new Set(ocorrencias.filter((o) => o.gravidade === "erro").map((o) => `${o.regra}|${o.data}`));
}

/** Erros que existem em `depois` e não existiam em `antes`. */
export function errosNovos(antes: Ocorrencia[], depois: Ocorrencia[]): Ocorrencia[] {
  const velhos = chavesDeErro(antes);
  return depois.filter((o) => o.gravidade === "erro" && !velhos.has(`${o.regra}|${o.data}`));
}

/** Troca o conteúdo de duas células (mesma pessoa = mover folga; outra pessoa = troca de turno). */
export function trocarCelulas(
  ajustes: Ajustes,
  a: { pessoa: string; data: string; turno: Turno | null },
  b: { pessoa: string; data: string; turno: Turno | null },
): Ajustes {
  const out: Ajustes = { ...ajustes, [a.pessoa]: { ...(ajustes[a.pessoa] || {}) } };
  if (b.pessoa !== a.pessoa) out[b.pessoa] = { ...(ajustes[b.pessoa] || {}) };
  out[a.pessoa][a.data] = b.turno;
  out[b.pessoa][b.data] = a.turno;
  return out;
}

export function definirCelula(ajustes: Ajustes, pessoa: string, data: string, turno: Turno | null): Ajustes {
  return { ...ajustes, [pessoa]: { ...(ajustes[pessoa] || {}), [data]: turno } };
}

/** O que vale para a empresa toda e fica salvo uma vez só (escala_config). */
export interface ConfigEmpresa {
  segmento: Segmento;
  temAcordoColetivo: boolean;
  bloqueio: ModoBloqueio;
  incluirFacultativos: boolean;
  /**
   * A casa abre nos feriados: quem o modelo põe para trabalhar no dia trabalha (pagar em
   * dobro ou dar folga compensatória). Desligado, todo feriado nasce de folga (fora a 12x36).
   */
  abreNosFeriados: boolean;
  feriadosLocais: FeriadoLocal[];
  /** Pessoas necessárias por dia da semana (domingo a sábado). */
  demanda: Demanda;
  /** Horas trabalhadas por dia usadas na simulação de contingente. */
  horasPorDia: number;
  salarioMedio: number | null;
  /** O cliente já marcou a atividade; antes disso a tela pede a atividade e não simula. */
  atividadeDefinida: boolean;
  /** A empresa trabalha (ou quer simular) em 12x36. */
  usa12x36: boolean;
  /** Dias da semana em que a casa não abre (0 = domingo). Cenário que escala gente neles sai da lista. */
  diasFechados: number[];
  /**
   * Atividade e acordo coletivo marcados pelo escritório: no portal o cliente só vê, não
   * muda (são respostas que o cliente raramente sabe).
   */
  atividadePeloEscritorio: boolean;
  /** O que o cliente respondeu "Não sei" (o sistema usou a regra mais segura): o escritório confere. */
  naoSabe: Array<"atividade" | "acordo">;
  /**
   * Times por unidade (lojas com o mesmo CNPJ), montados antes da escala e válidos para
   * todos os meses: unidades criadas, em que unidade cada pessoa está (id -> unidade) e
   * quem fica fora da escala (outra empresa, outro regime, afastado).
   */
  unidades: string[];
  times: Record<string, string>;
  foraDaEscala: string[];
  /** Cargo marcado na tela (id -> cargo), acima do cargo do cadastro; vale para todos os meses. */
  cargos: Record<string, string>;
  /** Pessoas de cada cargo necessárias por dia da semana (domingo a sábado). Só aviso. */
  minimoPorCargo: Record<string, Demanda>;
  /**
   * Funcionários registrados em OUTRA empresa do grupo (outro CNPJ) que trabalham nesta
   * escala (ex.: do Queijeiro 3 na unidade Terra Preta da Matriz). Entram como se fossem
   * da equipe; a empresa de origem os põe "fora da escala" (ver `cedidos`).
   */
  emprestados: Emprestado[];
  /** Na empresa de origem: quem foi cedido para a escala de outra empresa (id -> nome do destino). */
  cedidos: Record<string, string>;
}

export interface Emprestado {
  id: string;
  nome: string;
  cargo?: string;
  origemId: string;
  origemNome: string;
}

function normalizarEmprestimos(o: Record<string, unknown>): Pick<ConfigEmpresa, "emprestados" | "cedidos"> {
  const texto = (v: unknown, n = 120) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const vistos = new Set<string>();
  const emprestados: Emprestado[] = [];
  for (const e of Array.isArray(o.emprestados) ? o.emprestados : []) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const id = texto(r.id, 64);
    const nome = texto(r.nome);
    const origemId = texto(r.origemId, 64);
    if (!id || !nome || !origemId || vistos.has(id)) continue;
    vistos.add(id);
    emprestados.push({ id, nome, origemId, origemNome: texto(r.origemNome) || "outra empresa", cargo: texto(r.cargo, 40) || undefined });
  }
  const cedidos: Record<string, string> = {};
  if (o.cedidos && typeof o.cedidos === "object" && !Array.isArray(o.cedidos)) {
    for (const [id, d] of Object.entries(o.cedidos as Record<string, unknown>)) if (texto(d)) cedidos[id] = texto(d);
  }
  return { emprestados, cedidos };
}

/** A escala de um mês (escala_planejamentos). */
export interface PlanoMes {
  configs: ConfigPessoa[];
  ajustes: Ajustes;
}

export function configEmpresaPadrao(): ConfigEmpresa {
  return {
    segmento: "comercio",
    temAcordoColetivo: false,
    bloqueio: "limite_legal",
    incluirFacultativos: false,
    abreNosFeriados: false,
    feriadosLocais: [],
    demanda: [...DEMANDA_VAZIA] as Demanda,
    horasPorDia: 8,
    salarioMedio: null,
    atividadeDefinida: false,
    usa12x36: false,
    diasFechados: [],
    atividadePeloEscritorio: false,
    naoSabe: [],
    unidades: [],
    times: {},
    foraDaEscala: [],
    cargos: {},
    minimoPorCargo: {},
    emprestados: [],
    cedidos: {},
  };
}

function normalizarTimes(o: Record<string, unknown>): Pick<ConfigEmpresa, "unidades" | "times" | "foraDaEscala"> {
  const times: Record<string, string> = {};
  if (o.times && typeof o.times === "object" && !Array.isArray(o.times)) {
    for (const [id, u] of Object.entries(o.times as Record<string, unknown>)) {
      const nome = nomeDeUnidade(u);
      if (nome) times[id] = nome;
    }
  }
  const unidades = [...new Set([...(Array.isArray(o.unidades) ? o.unidades : []).map(nomeDeUnidade), ...Object.values(times)])].filter(
    (u): u is string => Boolean(u),
  );
  const foraDaEscala = Array.isArray(o.foraDaEscala) ? [...new Set(o.foraDaEscala.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
  return { unidades, times, foraDaEscala };
}

/**
 * Os times da empresa alimentam a escala do mês: quem está fora da escala sai, e a unidade
 * de cada pessoa vem do time (quem não está em time nenhum mantém a do mês).
 */
export function aplicarTimes(configs: ConfigPessoa[], empresa: Pick<ConfigEmpresa, "times" | "foraDaEscala"> | null | undefined): ConfigPessoa[] {
  if (!empresa) return configs;
  const fora = new Set(empresa.foraDaEscala);
  return configs.filter((c) => !fora.has(c.id)).map((c) => (c.id in empresa.times ? { ...c, unidade: empresa.times[c.id] } : c));
}

/** Lê o JSON salvo sem confiar na forma: o que faltar ou vier torto volta ao padrão. */
export function normalizarConfigEmpresa(raw: unknown): ConfigEmpresa {
  const base = configEmpresaPadrao();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const segmento = typeof o.segmento === "string" && o.segmento in SEGMENTOS ? (o.segmento as Segmento) : base.segmento;
  const bloqueio = typeof o.bloqueio === "string" && o.bloqueio in MODOS_BLOQUEIO ? (o.bloqueio as ModoBloqueio) : base.bloqueio;
  const demanda =
    Array.isArray(o.demanda) && o.demanda.length === 7
      ? (o.demanda.map((n) => Math.max(0, Math.floor(Number(n) || 0))) as Demanda)
      : base.demanda;
  const feriadosLocais = Array.isArray(o.feriadosLocais)
    ? o.feriadosLocais
        .filter((f): f is FeriadoLocal => Boolean(f) && typeof (f as FeriadoLocal).data === "string")
        .filter((f) => /^(\d{4}-)?\d{2}-\d{2}$/.test(f.data))
        .map((f) => ({ data: f.data, nome: String(f.nome || "") }))
    : [];
  const horas = Number(o.horasPorDia);
  const salario = Number(o.salarioMedio);
  return {
    segmento,
    temAcordoColetivo: Boolean(o.temAcordoColetivo),
    bloqueio,
    incluirFacultativos: Boolean(o.incluirFacultativos),
    abreNosFeriados: Boolean(o.abreNosFeriados),
    ...normalizarTimes(o),
    ...normalizarCargos(o),
    ...normalizarEmprestimos(o),
    feriadosLocais,
    demanda,
    horasPorDia: horas > 0 && horas <= 12 ? horas : base.horasPorDia,
    salarioMedio: salario > 0 ? salario : null,
    atividadeDefinida: Boolean(o.atividadeDefinida),
    usa12x36: Boolean(o.usa12x36),
    diasFechados: Array.isArray(o.diasFechados)
      ? [...new Set(o.diasFechados.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort().slice(0, 5)
      : [],
    atividadePeloEscritorio: Boolean(o.atividadePeloEscritorio),
    naoSabe: Array.isArray(o.naoSabe) ? [...new Set(o.naoSabe.filter((x): x is "atividade" | "acordo" => x === "atividade" || x === "acordo"))] : [],
  };
}

/** Pessoa salva em versão anterior (sem os campos de rodízio) ou com valor torto. */
export function normalizarConfigPessoa(raw: ConfigPessoa, padrao: ModeloChave): ConfigPessoa {
  const modelo = raw.modelo in MODELOS ? raw.modelo : padrao;
  const base = configPadrao(raw.id, raw.nome, modelo);
  const dia = (n: unknown, min: number, d: number) => (Number.isInteger(n) && (n as number) >= min && (n as number) <= 6 ? (n as number) : d);
  return {
    ...base,
    ...raw,
    modelo,
    folga6x1: dia(raw.folga6x1, 0, 0),
    folgaFixa: dia(raw.folgaFixa, 1, 1),
    rodizio: Number.isInteger(raw.rodizio) && raw.rodizio >= 0 ? raw.rodizio : 0,
    semanasRodizio:
      modelo === "5x2_fechado"
        ? Number.isInteger(raw.semanasRodizio) && raw.semanasRodizio >= 1 && raw.semanasRodizio <= 7
          ? raw.semanasRodizio
          : 3
        : raw.semanasRodizio === 3
          ? 3
          : 2,
    diaFechado: dia(raw.diaFechado, 0, 0),
    folgas5x2: Array.isArray(raw.folgas5x2) ? raw.folgas5x2 : base.folgas5x2,
    turma: raw.turma === "B" ? "B" : "A",
    seisPorUmAteVirada: raw.seisPorUmAteVirada !== false,
    unidade: nomeDeUnidade(raw.unidade),
    cargo: nomeDeCargo(raw.cargo),
    sexo: raw.sexo === "F" || raw.sexo === "M" ? raw.sexo : undefined,
  };
}

/** Unidade limpa (até 40 letras) ou undefined. */
export function nomeDeUnidade(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  return s || undefined;
}

/** Unidades usadas na equipe, em ordem alfabética. */
export function unidadesDa(configs: ConfigPessoa[]): string[] {
  return [...new Set(configs.map((c) => c.unidade).filter((u): u is string => Boolean(u)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Junta a escala salva com o quadro atual: quem saiu da empresa some, quem entrou ganha
 * o modelo padrão, vagas simuladas ficam.
 */
export function mesclarPlano(
  plano: PlanoMes | null,
  pessoas: Array<{ id: string; name: string; cadastro?: CadastroJornada }>,
  padrao: ModeloChave,
  opcoes: { permite6x1?: boolean; temAcordo?: boolean } = {},
): PlanoMes {
  const salvos = new Map((plano?.configs || []).map((c) => [c.id, c]));
  const configs: ConfigPessoa[] = pessoas.map((p, i) => {
    const s = salvos.get(p.id);
    if (s) return { ...normalizarConfigPessoa(s, padrao), nome: p.name };
    // Quem entra sem mês salvo começa no que o cadastro diz; espalha turmas e folgas.
    const espalha = { turma: i % 2 === 0 ? "A" : "B", folgaFixa: (i % 6) + 1, rodizio: i % 2 } as const;
    const doCadastro = configDoCadastro(p.id, p.name, p.cadastro, padrao, opcoes);
    if (doCadastro) {
      const folga = (p.cadastro?.folga || "").trim().toLowerCase();
      const folgaDoCadastro = doCadastro.modelo === "5x2_rev" && (FOLGA_DIA[folga] ?? 0) > 0;
      return { ...doCadastro, turma: espalha.turma, rodizio: espalha.rodizio, folgaFixa: folgaDoCadastro ? doCadastro.folgaFixa : espalha.folgaFixa };
    }
    return { ...configPadrao(p.id, p.name, padrao), ...espalha };
  });
  for (const c of plano?.configs || []) if (c.id.startsWith("vaga-")) configs.push(normalizarConfigPessoa(c, padrao));
  const ids = new Set(configs.map((c) => c.id));
  const ajustes: Ajustes = {};
  for (const [id, a] of Object.entries(plano?.ajustes || {})) if (ids.has(id)) ajustes[id] = a;
  return { configs, ajustes };
}

/** O que a edição em lote faz em cada dia escolhido: folga, um horário ou voltar ao modelo. */
export type AcaoDia = { tipo: "folga" } | { tipo: "horario"; turno: Turno } | { tipo: "modelo" };

/** Ajustes da pessoa depois de aplicar `acao` nas `datas`. */
export function ajustesEmLote(atuais: Record<string, Turno | null>, datas: string[], acao: AcaoDia): Record<string, Turno | null> {
  const novo = { ...atuais };
  for (const d of datas) {
    if (acao.tipo === "modelo") delete novo[d];
    else novo[d] = acao.tipo === "folga" ? null : acao.turno;
  }
  return novo;
}

export interface ResultadoLote {
  configs: ConfigPessoa[];
  ajustes: Ajustes;
  aceitos: string[];
  /** Quem ficou de fora porque a mudança criaria erro novo, e o primeiro motivo. */
  recusados: Array<{ id: string; nome: string; motivo: string }>;
}

/**
 * Edição em lote com a mesma trava da grade: cada pessoa é conferida sozinha; quem
 * ganharia erro novo fica como estava e entra em `recusados`, as outras recebem a mudança.
 */
export function aplicarLote(
  configs: ConfigPessoa[],
  ajustes: Ajustes,
  ids: string[],
  mudar: (c: ConfigPessoa, aj: Record<string, Turno | null>) => { config: ConfigPessoa; ajustes: Record<string, Turno | null> },
  mes: string,
  empresa: Pick<ConfigEmpresa, "segmento" | "temAcordoColetivo"> & { abreNosFeriados?: boolean },
  feriados: Set<string>,
): ResultadoLote {
  let cs = configs;
  let aj = ajustes;
  const aceitos: string[] = [];
  const recusados: ResultadoLote["recusados"] = [];
  for (const id of ids) {
    const c = cs.find((x) => x.id === id);
    if (!c) continue;
    const m = mudar(c, aj[id] || {});
    const novosAjustes = { ...aj, [id]: m.ajustes };
    const antes = avaliarPessoa(c, mes, aj, empresa, feriados).ocorrencias;
    const depois = avaliarPessoa(m.config, mes, novosAjustes, empresa, feriados).ocorrencias;
    const novos = errosNovos(antes, depois);
    if (novos.length) {
      recusados.push({ id, nome: c.nome, motivo: novos[0].mensagem });
      continue;
    }
    cs = cs.map((x) => (x.id === id ? m.config : x));
    aj = novosAjustes;
    aceitos.push(id);
  }
  return { configs: cs, ajustes: aj, aceitos, recusados };
}
