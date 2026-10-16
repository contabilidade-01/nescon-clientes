/**
 * Estado do planejador: o modelo escolhido para cada pessoa e os ajustes que o usuário
 * fez à mão (arrastar folga, editar horário de um dia). Fica separado da tela para dar
 * para testar sem React.
 */
import { diaDaSemana, diasEntre, inicioDaSemana, somarDias } from "./datas";
import { DiaEscala, ModeloEscala, Turno, escala5x2, escala6x1, gerarDias } from "./modelos";
import { MODOS_BLOQUEIO, type ModoBloqueio } from "./bloqueio";
import { DEMANDA_VAZIA, type Demanda } from "./contingente";
import type { FeriadoLocal } from "./feriados";
import { SEGMENTOS, type Segmento } from "./regras";

export type ModeloChave = "6x1" | "5x2" | "12x36";

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
}

/** Ajustes manuais: pessoa -> data -> turno (null = folga). */
export type Ajustes = Record<string, Record<string, Turno | null>>;

export function configPadrao(id: string, nome: string, modelo: ModeloChave = "6x1"): ConfigPessoa {
  return {
    id,
    nome,
    modelo,
    entrada: modelo === "12x36" ? "07:00" : "08:00",
    saida: modelo === "12x36" ? "19:00" : modelo === "5x2" ? "17:00" : "16:20",
    intervaloMin: 60,
    folga6x1: 0,
    folgas5x2: [6, 0],
    turma: "A",
  };
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
export function diasParaValidar(c: ConfigPessoa, mes: string, ajustes: Ajustes): DiaEscala[] {
  const dias = diasDoMes(mes);
  const de = inicioDaSemana(dias[0]);
  const ultimo = dias[dias.length - 1];
  const ate = somarDias(ultimo, 6 - diaDaSemana(ultimo));
  const meus = ajustes[c.id] || {};
  return gerarDias(modeloDaPessoa(c, mes), de, ate).map((d) =>
    Object.prototype.hasOwnProperty.call(meus, d.data) ? { data: d.data, turno: meus[d.data] } : d,
  );
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
    return s ? { ...s, nome: p.name } : { ...configPadrao(p.id, p.name, padrao), turma: i % 2 === 0 ? "A" : "B" };
  });
  for (const c of plano?.configs || []) if (c.id.startsWith("vaga-")) configs.push(c);
  const ids = new Set(configs.map((c) => c.id));
  const ajustes: Ajustes = {};
  for (const [id, a] of Object.entries(plano?.ajustes || {})) if (ids.has(id)) ajustes[id] = a;
  return { configs, ajustes };
}
