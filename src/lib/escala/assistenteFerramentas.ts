/**
 * Ferramentas do assistente de IA, executadas no navegador sobre a escala aberta.
 *
 * O Claude (api/src/escalaAssistente.js) pede a ferramenta; esta função a executa contra
 * o MESMO motor da grade e devolve um texto (JSON) para o modelo ler. Mudanças só passam
 * se não criarem erro novo, como na grade. Função pura sobre um estado: devolve o estado
 * novo e a tela aplica.
 */
import { motivoBloqueio } from "./bloqueio";
import { avaliarEscalaAtual } from "./cenarios";
import type { Demanda } from "./contingente";
import { distribuir, type GrupoDistribuicao, type ResultadoDistribuicao } from "./distribuir";
import { feriadosDaEmpresa } from "./feriados";
import {
  avaliarPessoa,
  errosNovos,
  MODELOS,
  type Ajustes,
  type ConfigEmpresa,
  type ConfigPessoa,
  type ModeloChave,
} from "./planejamento";
import { resumoFolgas } from "./porPessoa";
import { SEGMENTOS, VIGENCIAS, vigenciaEm } from "./regras";

export interface EstadoEscala {
  mes: string;
  cfg: ConfigEmpresa;
  configs: ConfigPessoa[];
  ajustes: Ajustes;
  feriados: Set<string>;
}

export interface ResultadoFerramenta {
  /** Texto (JSON) devolvido ao modelo como tool_result. */
  conteudo: string;
  erro?: boolean;
  /** Estado novo, quando a ferramenta mudou a escala. */
  estado?: EstadoEscala;
  /** Pedido de gravação (a tela grava). */
  salvar?: boolean;
  /** Frase curta para a tela mostrar o que a IA fez. */
  resumo: string;
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MODELOS_VALIDOS = Object.keys(MODELOS) as ModeloChave[];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const um = (n: number) => Math.round(n * 10) / 10;

const json = (o: unknown) => JSON.stringify(o);
const falha = (msg: string, resumo: string): ResultadoFerramenta => ({ conteudo: json({ erro: msg }), erro: true, resumo });

function porDia(media: number[], demanda: number[]) {
  return media.map((m, d) => ({ dia: DIAS[d], media_pessoas: um(m), demanda: demanda[d] || 0 }));
}

function situacao(e: EstadoEscala) {
  const r = avaliarEscalaAtual(e.configs, e.ajustes, e.mes, e.cfg, e.feriados);
  const v = vigenciaEm(`${e.mes}-28`);
  const pessoas = e.configs.map((c) => {
    const a = avaliarPessoa(c, e.mes, e.ajustes, e.cfg, e.feriados);
    const erros = [...new Set(a.ocorrencias.filter((o) => o.gravidade === "erro").map((o) => o.mensagem))];
    return {
      id: c.id,
      nome: c.nome,
      modelo: c.modelo,
      folgas: resumoFolgas(c),
      horario: `${c.entrada}-${c.saida}, intervalo ${c.intervaloMin}min`,
      horas_no_mes: um(a.horas),
      maior_semana_h: um(a.maiorSemana),
      ajustes_manuais: Object.keys(e.ajustes[c.id] || {}).length,
      erros: erros.slice(0, 3),
    };
  });
  return {
    mes: e.mes,
    regra: { nome: v.nome, limite_semanal_h: v.limiteSemanalHoras, folgas_por_semana: v.repousosSemanais },
    empresa: {
      segmento: SEGMENTOS[e.cfg.segmento].nome,
      acordo_coletivo: e.cfg.temAcordoColetivo,
      dias_que_fecha: e.cfg.diasFechados.map((d) => DIAS[d]),
      bloqueio_jornada: e.cfg.bloqueio,
    },
    total_erros: r.erros,
    total_avisos: r.avisos,
    motivos_de_erro: r.motivos,
    dias_sem_cobertura_no_mes: r.diasDescobertos,
    pessoas_por_dia_da_semana: porDia(r.mediaPorDia, e.cfg.demanda),
    pessoas,
  };
}

function projetar(e: EstadoEscala) {
  return VIGENCIAS.slice(1).map((v) => {
    // O mês seguinte ao da virada já é todo na regra nova.
    const [a, m] = v.inicio.slice(0, 7).split("-").map(Number);
    const mes = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
    const ano = Number(mes.slice(0, 4));
    const feriados = new Set(feriadosDaEmpresa([ano - 1, ano], e.cfg.feriadosLocais, e.cfg.incluirFacultativos).keys());
    const r = avaliarEscalaAtual(e.configs, {}, mes, e.cfg, feriados);
    const fora = e.configs.filter((c) =>
      avaliarPessoa(c, mes, {}, e.cfg, feriados).ocorrencias.some((o) => o.gravidade === "erro"),
    );
    return {
      etapa: v.nome,
      a_partir_de: v.inicio,
      mes_medido: mes,
      limite_semanal_h: v.limiteSemanalHoras,
      folgas_por_semana: v.repousosSemanais,
      pessoas_fora_da_regra: fora.map((c) => ({ id: c.id, nome: c.nome, modelo: c.modelo })),
      motivos: r.motivos,
      pessoas_por_dia_da_semana: porDia(r.mediaPorDia, e.cfg.demanda),
      dias_sem_cobertura: r.diasDescobertos,
    };
  });
}

function dia(v: unknown): number | null {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6 ? (v as number) : null;
}

function lerGrupos(raw: unknown): GrupoDistribuicao[] | string {
  if (!Array.isArray(raw) || !raw.length) return "Informe ao menos um grupo.";
  const out: GrupoDistribuicao[] = [];
  for (const [i, g] of raw.entries()) {
    if (!g || typeof g !== "object") return `Grupo ${i + 1} inválido.`;
    const o = g as Record<string, unknown>;
    if (!MODELOS_VALIDOS.includes(o.modelo as ModeloChave)) return `Grupo ${i + 1}: modelo inválido.`;
    const q = o.quantidade === null || o.quantidade === undefined ? null : Number(o.quantidade);
    if (q !== null && (!Number.isInteger(q) || q < 0)) return `Grupo ${i + 1}: quantidade inválida.`;
    if (o.entrada !== undefined && !HHMM.test(String(o.entrada))) return `Grupo ${i + 1}: entrada inválida.`;
    if (o.saida !== undefined && !HHMM.test(String(o.saida))) return `Grupo ${i + 1}: saída inválida.`;
    out.push({
      id: `g${i + 1}`,
      modelo: o.modelo as ModeloChave,
      quantidade: q,
      pessoas: Array.isArray(o.pessoas) ? o.pessoas.map(String) : undefined,
      folgaFixa: o.folga_fixa === null || o.folga_fixa === undefined ? null : dia(o.folga_fixa),
      entrada: o.entrada as string | undefined,
      saida: o.saida as string | undefined,
      intervaloMin: o.intervalo_min === undefined ? undefined : Math.max(0, Number(o.intervalo_min) || 0),
    });
  }
  return out;
}

function resumoDistribuicao(id: string, r: ResultadoDistribuicao, demanda: number[]) {
  return {
    id,
    valida: r.valida,
    sorteios_que_serviram: `${r.validas} de ${r.tentativas}`,
    motivos_se_invalida: r.valida ? [] : r.cenario.motivos,
    pessoas_por_dia_da_semana: porDia(r.cenario.mediaPorDia, demanda),
    dias_sem_cobertura: r.cenario.diasDescobertos,
    pessoas: r.cenario.configs.map((c) => ({
      id: c.id,
      nome: c.nome,
      modelo: c.modelo,
      folgas: resumoFolgas(c),
      horario: `${c.entrada}-${c.saida}`,
    })),
  };
}

export async function executarFerramenta(
  nome: string,
  input: Record<string, unknown>,
  estado: EstadoEscala,
  simulacoes: Map<string, ResultadoDistribuicao>,
): Promise<ResultadoFerramenta> {
  switch (nome) {
    case "ver_situacao":
      return { conteudo: json(situacao(estado)), resumo: "Consultou a escala do mês" };

    case "projetar_etapas":
      return { conteudo: json(projetar(estado)), resumo: "Projetou a escala nas etapas de 42h e 40h" };

    case "simular_distribuicao": {
      const grupos = lerGrupos(input.grupos);
      if (typeof grupos === "string") return falha(grupos, "Simulação recusada");
      const semente = Number.isInteger(input.semente) ? (input.semente as number) : Math.floor(Math.random() * 1_000_000);
      const r = distribuir(
        estado.configs.map((c) => ({ id: c.id, nome: c.nome })),
        grupos,
        estado.mes,
        estado.cfg,
        estado.feriados,
        semente,
      );
      const id = `dist-${simulacoes.size + 1}`;
      simulacoes.set(id, r);
      return {
        conteudo: json(resumoDistribuicao(id, r, estado.cfg.demanda)),
        resumo: r.valida ? "Simulou uma distribuição (dentro da regra)" : "Simulou uma distribuição (fora da regra)",
      };
    }

    case "aplicar_distribuicao": {
      const r = simulacoes.get(String(input.id));
      if (!r) return falha("Distribuição não encontrada. Simule de novo.", "Aplicação recusada");
      if (!r.valida) return falha(`Distribuição com erro: ${r.cenario.motivos.join(" ")}`, "Aplicação recusada");
      return {
        conteudo: json({ ok: true, aplicada: input.id }),
        estado: { ...estado, configs: r.cenario.configs, ajustes: {} },
        resumo: "Aplicou a distribuição na grade",
      };
    }

    case "alterar_pessoa": {
      const id = String(input.pessoa_id || "");
      const atual = estado.configs.find((c) => c.id === id);
      if (!atual) return falha("Pessoa não encontrada. Use os ids de ver_situacao.", "Alteração recusada");
      const novo: ConfigPessoa = { ...atual };
      if (input.modelo !== undefined) {
        if (!MODELOS_VALIDOS.includes(input.modelo as ModeloChave)) return falha("Modelo inválido.", "Alteração recusada");
        novo.modelo = input.modelo as ModeloChave;
      }
      for (const [k, campo] of [
        ["entrada", "entrada"],
        ["saida", "saida"],
      ] as const) {
        if (input[k] !== undefined) {
          if (!HHMM.test(String(input[k]))) return falha(`${k} inválida (HH:MM).`, "Alteração recusada");
          novo[campo] = String(input[k]);
        }
      }
      if (input.intervalo_min !== undefined) novo.intervaloMin = Math.max(0, Number(input.intervalo_min) || 0);
      if (input.folga_6x1 !== undefined) {
        const d = dia(input.folga_6x1);
        if (d === null) return falha("folga_6x1 inválida (0-6).", "Alteração recusada");
        novo.folga6x1 = d;
      }
      if (input.folgas_5x2 !== undefined) {
        const f = Array.isArray(input.folgas_5x2) ? input.folgas_5x2.map(dia) : [];
        if (f.length !== 2 || f.some((x) => x === null) || f[0] === f[1]) return falha("folgas_5x2: dois dias diferentes (0-6).", "Alteração recusada");
        novo.folgas5x2 = f as number[];
      }
      if (input.grupo_corrida !== undefined) {
        const g = Number(input.grupo_corrida);
        if (!Number.isInteger(g) || g < 0 || g > 6) return falha("grupo_corrida inválido (0-6).", "Alteração recusada");
        novo.rodizio = g;
      }
      if (input.grupo_3semanas !== undefined) {
        const g = Number(input.grupo_3semanas);
        if (!Number.isInteger(g) || g < 0 || g > 2) return falha("grupo_3semanas inválido (0-2).", "Alteração recusada");
        novo.rodizio = g;
      }
      if (input.grupo_quinzenal !== undefined) {
        const g = Number(input.grupo_quinzenal);
        if (!Number.isInteger(g) || g < 0 || g > 3) return falha("grupo_quinzenal inválido (0-3).", "Alteração recusada");
        novo.rodizio = g;
      }
      if (input.sexo !== undefined) {
        if (input.sexo !== "F" && input.sexo !== "M" && input.sexo !== "") return falha("sexo inválido ('F', 'M' ou '').", "Alteração recusada");
        novo.sexo = input.sexo === "" ? undefined : (input.sexo as "F" | "M");
      }
      if (input.folga_fixa !== undefined) {
        const d = dia(input.folga_fixa);
        if (d === null) return falha("folga_fixa inválida.", "Alteração recusada");
        novo.folgaFixa = d;
      }
      if (input.dia_fechado !== undefined) {
        const d = dia(input.dia_fechado);
        if (d === null) return falha("dia_fechado inválido.", "Alteração recusada");
        novo.diaFechado = d;
      }
      if (input.semanas_rodizio !== undefined) novo.semanasRodizio = Math.min(7, Math.max(1, Number(input.semanas_rodizio) || 2));
      if (input.turma === "A" || input.turma === "B") novo.turma = input.turma;

      const bloqueio = motivoBloqueio(
        { entrada: novo.entrada, saida: novo.saida, intervaloMin: novo.intervaloMin },
        estado.cfg.bloqueio,
        novo.modelo === "12x36",
      );
      if (bloqueio) return falha(bloqueio, `Alteração de ${atual.nome} recusada`);

      // Trocar de modelo zera os ajustes de dia da pessoa (eram do modelo antigo).
      const ajustes: Ajustes = { ...estado.ajustes };
      if (novo.modelo !== atual.modelo) delete ajustes[id];
      const antes = avaliarPessoa(atual, estado.mes, estado.ajustes, estado.cfg, estado.feriados);
      const depois = avaliarPessoa(novo, estado.mes, ajustes, estado.cfg, estado.feriados);
      const novos = errosNovos(antes.ocorrencias, depois.ocorrencias);
      if (novos.length) {
        return falha(
          `A mudança cria erro: ${[...new Set(novos.map((o) => o.mensagem))].slice(0, 3).join(" ")}`,
          `Alteração de ${atual.nome} recusada pelas regras`,
        );
      }
      return {
        conteudo: json({ ok: true, pessoa: novo.nome, modelo: novo.modelo, folgas: resumoFolgas(novo), horario: `${novo.entrada}-${novo.saida}` }),
        estado: { ...estado, configs: estado.configs.map((c) => (c.id === id ? novo : c)), ajustes },
        resumo: `Alterou a escala de ${novo.nome}`,
      };
    }

    case "definir_demanda": {
      const d = input.demanda;
      if (!Array.isArray(d) || d.length !== 7 || d.some((n) => !Number.isInteger(n) || n < 0 || n > 999)) {
        return falha("Informe 7 números inteiros, de domingo a sábado.", "Demanda recusada");
      }
      return {
        conteudo: json({ ok: true, demanda: d }),
        estado: { ...estado, cfg: { ...estado.cfg, demanda: d as Demanda } },
        resumo: "Definiu a demanda de pessoas por dia",
      };
    }

    case "salvar_escala": {
      const r = avaliarEscalaAtual(estado.configs, estado.ajustes, estado.mes, estado.cfg, estado.feriados);
      if (r.erros > 0) return falha(`A escala tem ${r.erros} erro(s) e não pode ser salva. ${r.motivos.join(" ")}`, "Gravação recusada");
      return { conteudo: json({ ok: true }), salvar: true, resumo: "Salvou a escala" };
    }

    default:
      return falha(`Ferramenta desconhecida: ${nome}`, "Ferramenta desconhecida");
  }
}
