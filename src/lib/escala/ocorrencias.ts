import { REGRAS_DO_DIA } from "./planejamento";
import type { Ocorrencia } from "./validar";

function ddmm(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/**
 * A mesma falha semanal se repete em todas as semanas do mês (um 6x1 de 44h estoura o
 * limite em cada uma). Agrupa por mensagem para a lista dizer uma vez, com as semanas.
 */
export function agruparOcorrencias(ocorrencias: Ocorrencia[]) {
  const grupos = new Map<string, { gravidade: Ocorrencia["gravidade"]; mensagem: string; datas: string[]; semanal: boolean }>();
  for (const o of ocorrencias) {
    const k = `${o.gravidade}|${o.mensagem}`;
    if (!grupos.has(k)) grupos.set(k, { gravidade: o.gravidade, mensagem: o.mensagem, datas: [], semanal: !REGRAS_DO_DIA.has(o.regra) });
    grupos.get(k)!.datas.push(o.data);
  }
  return [...grupos.values()].map((g) => ({
    ...g,
    quando: `${g.semanal ? (g.datas.length > 1 ? "semanas de " : "semana de ") : ""}${g.datas.map(ddmm).join(", ")}`,
  }));
}
