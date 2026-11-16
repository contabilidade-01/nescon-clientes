import { dadosPadrao, type DadosRegime } from "./simular";

/** O que o simulador grava em /api/regime. */
export interface RegimeSalvo {
  versao: 1;
  questionarioConcluido: boolean;
  dados: DadosRegime;
}

/** Junta o salvo com o padrão, para campos novos não quebrarem simulações antigas. */
export function lerSalvo(raw: unknown): RegimeSalvo {
  const base = dadosPadrao();
  const o = raw && typeof raw === "object" ? (raw as Partial<RegimeSalvo>) : {};
  const d = (o.dados && typeof o.dados === "object" ? o.dados : {}) as Partial<DadosRegime>;
  return {
    versao: 1,
    questionarioConcluido: Boolean(o.questionarioConcluido),
    dados: { ...base, ...d, vendas: { ...base.vendas, ...(d.vendas || {}) } },
  };
}
