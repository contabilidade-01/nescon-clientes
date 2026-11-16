/**
 * Link avulso de advertência/suspensão (sem login): o cliente informa o CNPJ, a tela
 * acha a empresa no cadastro e os formulários do portal rodam em "modo avulso" —
 * funcionário, datas, dias e retorno digitados à mão, sem lista de funcionários nem
 * histórico da empresa.
 */
export type EmpresaAvulsa = {
  nome: string;
  cnpj: string;
  escala12x36: boolean;
};

export type ModoAvulso = {
  empresa: EmpresaAvulsa;
  /** Registra a emissão no servidor (histórico + aviso ao escritório). Lança erro se falhar. */
  emitir: (dados: Record<string, unknown>, blob: Blob, fileName: string) => Promise<unknown>;
};

/** Sem CPF informado, o termo sai com a linha para preencher à mão na assinatura. */
export const CPF_EM_BRANCO = "____.____.____-___";

export function cpfParaDocumento(cpfDigitado: string): string {
  const d = String(cpfDigitado || "").replace(/\D/g, "");
  if (d.length !== 11) return CPF_EM_BRANCO;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Nome digitado é suficiente para emitir? (mínimo de 3 letras, como no servidor) */
export function nomeFuncionarioOk(nome: string): boolean {
  return String(nome || "").trim().length >= 3;
}
