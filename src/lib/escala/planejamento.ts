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
import { SEGMENTOS, vigenciaEm, type PerfilJornada, type Segmento } from "./regras";
import { validarEscala, type Ocorrencia } from "./validar";

/**
 * - 6x1: só até 15/12/2026.
 * - 5x2: folgas fixas na semana.
 * - 5x2_rev: 5x2 com folgas em rodízio (o domingo de folga gira entre a equipe).
 * - 5x2_fechado: folga fixa no dia em que a casa fecha + 1 folga escalonada; se a casa
 *   abre no domingo, a 2ª folga cai no domingo a cada `semanasRodizio` semanas.
 * - 4x3: 4 dias de 10h, folga no domingo e em mais 2 dias (compensação, exige acordo).
 * - 12x36: plantão dia sim, dia não.
 */
export type ModeloChave = "6x1" | "5x2" | "5x2_rev" | "5x2_fechado" | "4x3" | "12x36";

export const MODELOS: Record<ModeloChave, string> = {
  "6x1": "6x1",
  "5x2": "5x2 fixo",
  "5x2_rev": "5x2 rodízio",
  "5x2_fechado": "5x2 casa fechada",
  "4x3": "4x3 (10h)",
  "12x36": "12x36",
};

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
}

/** Ajustes manuais: pessoa -> data -> turno (null = folga). */
export type Ajustes = Record<string, Record<string, Turno | null>>;

const HORARIOS: Record<ModeloChave, [string, string]> = {
  "6x1": ["08:00", "16:20"], // 7h20 x 6 = 44h
  "5x2": ["08:00", "17:00"], // 8h x 5 = 40h
  "5x2_rev": ["08:00", "17:00"],
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
): DiaEscala[] {
  const dias = diasDoMes(mes);
  const de = inicioDaSemana(dias[0]);
  const ultimo = dias[dias.length - 1];
  const ate = somarDias(ultimo, 6 - diaDaSemana(ultimo));
  const meus = ajustes[c.id] || {};
  // Feriado nasce de folga (fora a 12x36, que já paga o feriado no plantão). Trabalhar
  // nele é escolha do cliente, feita à mão, e a validação cobra a regra do segmento.
  const folgaNoFeriado = c.modelo !== "12x36";
  return gerarDias(modeloDaPessoa(c, mes), de, ate).map((d) => {
    if (Object.prototype.hasOwnProperty.call(meus, d.data)) return { data: d.data, turno: meus[d.data] };
    if (folgaNoFeriado && feriados.has(d.data)) return { data: d.data, turno: null };
    return d;
  });
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
  /** Semana mais carregada que toca o mês, e o limite da regra naquela semana. */
  maiorSemana: number;
  limiteSemana: number;
  /** Como a validação trata a semana acima do limite: erro, aviso (acordo/12x36) ou nada. */
  semanaAcima: "erro" | "atencao" | null;
}

export function perfilDa(c: ConfigPessoa, empresa: Pick<ConfigEmpresa, "segmento" | "temAcordoColetivo">): PerfilJornada {
  return { segmento: empresa.segmento, temAcordoColetivo: empresa.temAcordoColetivo, regime12x36: c.modelo === "12x36" };
}

export function avaliarPessoa(
  c: ConfigPessoa,
  mes: string,
  ajustes: Ajustes,
  empresa: Pick<ConfigEmpresa, "segmento" | "temAcordoColetivo">,
  feriados: Set<string>,
): AvaliacaoPessoa {
  const todos = diasParaValidar(c, mes, ajustes, feriados);
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
  const semanas = resultado.semanas.filter((x) => x.completa);
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
    feriadosLocais: [],
    demanda: [...DEMANDA_VAZIA] as Demanda,
    horasPorDia: 8,
    salarioMedio: null,
    atividadeDefinida: false,
    usa12x36: false,
    diasFechados: [],
  };
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
    feriadosLocais,
    demanda,
    horasPorDia: horas > 0 && horas <= 12 ? horas : base.horasPorDia,
    salarioMedio: salario > 0 ? salario : null,
    atividadeDefinida: Boolean(o.atividadeDefinida),
    usa12x36: Boolean(o.usa12x36),
    diasFechados: Array.isArray(o.diasFechados)
      ? [...new Set(o.diasFechados.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort().slice(0, 5)
      : [],
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
  };
}

/**
 * Junta a escala salva com o quadro atual: quem saiu da empresa some, quem entrou ganha
 * o modelo padrão, vagas simuladas ficam.
 */
export function mesclarPlano(plano: PlanoMes | null, pessoas: Array<{ id: string; name: string }>, padrao: ModeloChave): PlanoMes {
  const salvos = new Map((plano?.configs || []).map((c) => [c.id, c]));
  const configs: ConfigPessoa[] = pessoas.map((p, i) => {
    const s = salvos.get(p.id);
    return s
      ? { ...normalizarConfigPessoa(s, padrao), nome: p.name }
      : { ...configPadrao(p.id, p.name, padrao), turma: i % 2 === 0 ? "A" : "B", folgaFixa: (i % 6) + 1, rodizio: i % 2 };
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
  empresa: Pick<ConfigEmpresa, "segmento" | "temAcordoColetivo">,
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
