/**
 * Catálogo dos campos editáveis do contrato e o que se constrói em cima dele:
 *  - validação/aplicação de alterações (usada pelo agente de IA: ele devolve um mapa
 *    plano "secao.campo" → valor e o navegador só aplica o que passa aqui);
 *  - perfis de honorário (predefinições por situação);
 *  - aditivos (alteração de contrato assinado, com texto "de → para" gerado do diff).
 *
 * O texto jurídico continua vivendo só em `contratoModelo.ts` (e, para o aditivo, em
 * `montarAditivo` abaixo). A IA nunca escreve cláusula: ela só preenche campos daqui.
 */
import {
  COMPLEXIDADE_LABEL,
  ENQUADRAMENTO_LABEL,
  TIPO_LABEL,
  brl,
  dataExtenso,
  fmtData,
  mesclarDados,
  moedaExtenso,
  normalizarDados,
  type Bloco,
  type Complexidade,
  type ContratoDados,
  type ContratoParcial,
  type Enquadramento,
  type TipoEmpresa,
} from "@/lib/contratoModelo";

// ---------------------------------------------------------------------------
// Catálogo de campos
// ---------------------------------------------------------------------------
export type CampoFmt = "moeda" | "pct" | "dia" | "dias" | "diasUteis" | "mensalidades";

export type CampoDef = {
  /** "secao.campo", igual ao caminho dentro de ContratoDados. */
  chave: string;
  rotulo: string;
  tipo: "texto" | "numero" | "bool" | "enum" | "data";
  fmt?: CampoFmt;
  min?: number;
  max?: number;
  inteiro?: boolean;
  opcoes?: Array<{ valor: string; rotulo: string }>;
  /** Regex (texto) que o valor precisa cumprir, ex.: dd/mm. */
  padrao?: string;
  /** Texto de "sim/não" para campos booleanos no aditivo. */
  boolTxt?: [string, string];
  /** A IA pode preencher? Dados identificadores (CPF, endereço…) ficam de fora, por privacidade. */
  ia: boolean;
  /** Pode ser alterado por aditivo? */
  aditivavel: boolean;
  dica?: string;
};

type Extra = Partial<Omit<CampoDef, "chave" | "rotulo" | "tipo">>;
const c = (chave: string, rotulo: string, tipo: CampoDef["tipo"], extra: Extra = {}): CampoDef => ({
  chave,
  rotulo,
  tipo,
  ia: true,
  aditivavel: true,
  ...extra,
});
const num = (chave: string, rotulo: string, min: number, max: number, extra: Extra = {}) =>
  c(chave, rotulo, "numero", { min, max, ...extra });
const op = (pares: Array<[string, string]>) => pares.map(([valor, rotulo]) => ({ valor, rotulo }));

export const CAMPOS: CampoDef[] = [
  // Contratante
  c("contratante.razao", "Razão social da contratante", "texto"),
  c("contratante.tipoSocietario", "Tipo societário / porte", "texto", { aditivavel: false }),
  c("contratante.endereco", "Endereço da contratante", "texto", { ia: false }),
  c("contratante.email", "E-mail da contratante", "texto", { ia: false }),
  c("contratante.telefone", "Telefone da contratante", "texto", { ia: false }),
  c("contratante.repNome", "Representante da contratante", "texto", { ia: false }),
  c("contratante.repCpf", "CPF do representante", "texto", { ia: false }),
  c("contratante.repQualificacao", "Qualificação do representante", "texto", { ia: false }),
  // Objeto
  c("objeto.modelo", "Modelo de contrato", "enum", { opcoes: op([["completo", "Completo"], ["mei", "Simplificado MEI"]]), aditivavel: false }),
  c("objeto.enquadramento", "Enquadramento", "enum", {
    opcoes: (Object.keys(ENQUADRAMENTO_LABEL) as Enquadramento[]).map((k) => ({ valor: k, rotulo: ENQUADRAMENTO_LABEL[k] })),
  }),
  c("objeto.tipoEmpresa", "Tipo de empresa", "enum", {
    opcoes: (Object.keys(TIPO_LABEL) as TipoEmpresa[]).map((k) => ({ valor: k, rotulo: TIPO_LABEL[k] })),
    aditivavel: false,
  }),
  c("objeto.complexidade", "Complexidade", "enum", {
    opcoes: (Object.keys(COMPLEXIDADE_LABEL) as Complexidade[]).map((k) => ({ valor: k, rotulo: COMPLEXIDADE_LABEL[k] })),
    aditivavel: false,
  }),
  c("objeto.regimeTributario", "Regime tributário", "texto"),
  num("objeto.funcionariosIncluidos", "Empregados incluídos na mensalidade", 0, 500, { inteiro: true }),
  c("objeto.balancetes", "Periodicidade dos balancetes", "enum", {
    opcoes: op([["mensal", "Mensais"], ["trimestral", "Trimestrais"], ["semestral", "Semestrais"]]),
  }),
  // Prazos
  c("prazos.diaVariaveisFolha", "Dia-limite das variáveis da folha", "texto"),
  c("prazos.horarioAtendimento", "Horário de atendimento", "texto"),
  num("prazos.diasGuias", "Antecedência das guias", 1, 30, { inteiro: true, fmt: "dias" }),
  num("prazos.diaDocsFinanceiros", "Documentos financeiros: prazo após o mês", 1, 30, { inteiro: true, fmt: "dias" }),
  num("prazos.prazoRespostaDiasUteis", "Prazo de resposta ao cliente", 1, 10, { inteiro: true, fmt: "diasUteis" }),
  num("prazos.transicaoDiasUteis", "Entrega no encerramento", 1, 60, { inteiro: true, fmt: "diasUteis" }),
  num("prazos.balancoDias", "Balanço anual: prazo", 1, 120, { inteiro: true, fmt: "dias" }),
  // Honorários
  num("honorarios.valorMensal", "Honorário mensal", 0, 100000, { fmt: "moeda" }),
  num("honorarios.vencimentoDia", "Dia de vencimento da mensalidade", 1, 31, { inteiro: true, fmt: "dia" }),
  num("honorarios.faturamentoLimite", "Limite de faturamento mensal", 0, 1_000_000_000, { fmt: "moeda" }),
  num("honorarios.valorFuncAdicional", "Valor por empregado adicional", 0, 5000, { fmt: "moeda" }),
  c("honorarios.decimoTerceiro", "13º honorário", "bool", { boolTxt: ["cobrado", "não cobrado"] }),
  c("honorarios.decimoParcela1", "13º honorário: 1ª parcela", "texto", { padrao: "^\\d{1,2}/\\d{1,2}$", dica: "dd/mm" }),
  c("honorarios.decimoParcela2", "13º honorário: 2ª parcela", "texto", { padrao: "^\\d{1,2}/\\d{1,2}$", dica: "dd/mm" }),
  c("honorarios.competenciaReferencia", "Competência cobrada", "enum", {
    opcoes: op([["corrente", "Mês corrente"], ["seguinte", "Mês vencido"]]),
  }),
  c("honorarios.primeiraCobranca", "Data da 1ª cobrança", "data"),
  c("honorarios.meioPagamento", "Meio de pagamento", "texto"),
  num("honorarios.multaPct", "Multa por atraso", 0, 10, { fmt: "pct" }),
  num("honorarios.jurosPct", "Juros ao mês", 0, 5, { fmt: "pct" }),
  num("honorarios.retroativoPct", "Retroativo: % da mensalidade", 0, 300, { fmt: "pct" }),
  num("honorarios.retroativoDias", "Retroativo: a partir de (dias de atraso)", 1, 365, { inteiro: true, fmt: "dias" }),
  num("honorarios.inadimplenciaDias", "Inadimplência: dias para regularizar", 1, 90, { inteiro: true, fmt: "dias" }),
  num("honorarios.recalculoGuiaValor", "2º recálculo de guia (por guia)", 0, 1000, { fmt: "moeda" }),
  num("honorarios.faixaAdicionalValor", "Acréscimo por faixa de faturamento excedente", 0, 100000, { fmt: "moeda" }),
  num("honorarios.faixaPasso", "Faixa de faturamento excedente (passo)", 0, 1_000_000_000, { fmt: "moeda" }),
  c("honorarios.reajusteIndice", "Índice do reajuste anual", "texto"),
  // Vigência
  c("vigencia.dataInicio", "Data de início dos serviços", "data", { aditivavel: false }),
  num("vigencia.avisoPrevioDias", "Aviso prévio", 0, 180, { inteiro: true, fmt: "dias" }),
  c("vigencia.foro", "Foro", "texto", { aditivavel: false }),
  num("vigencia.correcaoDias", "Justa causa: dias para corrigir", 1, 60, { inteiro: true, fmt: "dias" }),
  num("vigencia.multaAvisoMensalidades", "Multa por dispensar o aviso (limite)", 0, 12, { fmt: "mensalidades" }),
  num("vigencia.multaInfracaoMensalidades", "Multa por infração (limite)", 0, 12, { fmt: "mensalidades" }),
  // Assinatura
  c("assinatura.cidade", "Cidade da assinatura", "texto", { aditivavel: false }),
  c("assinatura.data", "Data da assinatura", "data", { aditivavel: false }),
];

const POR_CHAVE = new Map(CAMPOS.map((x) => [x.chave, x]));

export function campoDef(chave: string): CampoDef | undefined {
  return POR_CHAVE.get(chave);
}

export function lerCampo(d: ContratoDados, chave: string): string | number | boolean {
  const [sec, campo] = chave.split(".");
  return ((d as unknown as Record<string, Record<string, unknown>>)[sec]?.[campo] ?? "") as string | number | boolean;
}

export function definirCampo(d: ContratoDados, chave: string, valor: unknown): ContratoDados {
  const [sec, campo] = chave.split(".");
  const s = (d as unknown as Record<string, Record<string, unknown>>)[sec] || {};
  return { ...d, [sec]: { ...s, [campo]: valor } } as ContratoDados;
}

// ---------------------------------------------------------------------------
// Validação e aplicação de alterações (agente de IA)
// ---------------------------------------------------------------------------
export type ModoAssistente = "contrato" | "aditivo";

/** Campos que o agente pode ver/preencher, no formato enxuto enviado à API. */
export function camposParaIa(modo: ModoAssistente) {
  return CAMPOS.filter((x) => x.ia && (modo === "contrato" || x.aditivavel)).map((x) => ({
    chave: x.chave,
    rotulo: x.rotulo,
    tipo: x.tipo,
    ...(x.min != null ? { min: x.min } : {}),
    ...(x.max != null ? { max: x.max } : {}),
    ...(x.opcoes ? { opcoes: x.opcoes.map((o) => o.valor) } : {}),
    ...(x.dica ? { dica: x.dica } : {}),
  }));
}

/** Estado atual só com o que o agente pode ver (nada de CPF, endereço, e-mail…). */
export function estadoParaIa(d: ContratoDados, modo: ModoAssistente): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const x of CAMPOS) {
    if (!x.ia || (modo === "aditivo" && !x.aditivavel)) continue;
    out[x.chave] = lerCampo(d, x.chave);
  }
  return out;
}

type Validacao = { ok: boolean; valor?: string | number | boolean; motivo?: string };

export function validarValor(def: CampoDef, bruto: unknown): Validacao {
  switch (def.tipo) {
    case "numero": {
      const txt = String(bruto ?? "").trim();
      // "1.250,50" (pt-BR) → 1250.5; "450.5" (ponto decimal) fica como está.
      const n = typeof bruto === "number" ? bruto : Number(txt.includes(",") ? txt.replace(/\./g, "").replace(",", ".") : txt);
      if (typeof bruto === "string" && bruto.trim() === "") return { ok: false, motivo: "valor vazio" };
      if (!Number.isFinite(n)) return { ok: false, motivo: "não é número" };
      if (def.min != null && n < def.min) return { ok: false, motivo: `abaixo do mínimo (${def.min})` };
      if (def.max != null && n > def.max) return { ok: false, motivo: `acima do máximo (${def.max})` };
      if (def.inteiro && !Number.isInteger(n)) return { ok: false, motivo: "precisa ser inteiro" };
      return { ok: true, valor: Math.round(n * 100) / 100 };
    }
    case "bool": {
      if (typeof bruto === "boolean") return { ok: true, valor: bruto };
      const s = String(bruto ?? "").trim().toLowerCase();
      if (["sim", "true", "1"].includes(s)) return { ok: true, valor: true };
      if (["não", "nao", "false", "0"].includes(s)) return { ok: true, valor: false };
      return { ok: false, motivo: "não é sim/não" };
    }
    case "enum": {
      const s = String(bruto ?? "").trim().toLowerCase();
      const o = def.opcoes?.find((x) => x.valor.toLowerCase() === s || x.rotulo.toLowerCase() === s);
      return o ? { ok: true, valor: o.valor } : { ok: false, motivo: "opção inexistente" };
    }
    case "data": {
      const s = String(bruto ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T12:00:00`).getTime())) return { ok: false, motivo: "data inválida (use AAAA-MM-DD)" };
      return { ok: true, valor: s };
    }
    default: {
      if (typeof bruto !== "string" && typeof bruto !== "number") return { ok: false, motivo: "não é texto" };
      const s = String(bruto).trim();
      if (s.length > 200) return { ok: false, motivo: "texto longo demais" };
      if (def.padrao && s && !new RegExp(def.padrao).test(s)) return { ok: false, motivo: `formato inválido${def.dica ? ` (${def.dica})` : ""}` };
      return { ok: true, valor: s };
    }
  }
}

export type AlteracaoAplicada = { chave: string; rotulo: string; antes: string | number | boolean; depois: string | number | boolean };

/**
 * Aplica o mapa plano devolvido pela IA. Só entra o que está no catálogo, é permitido à
 * IA no modo atual e passa na validação; o resto vira aviso (nunca é aplicado em silêncio).
 */
export function aplicarAtualizacoes(
  d: ContratoDados,
  flat: unknown,
  modo: ModoAssistente
): { dados: ContratoDados; aplicadas: AlteracaoAplicada[]; avisos: string[] } {
  const avisos: string[] = [];
  const aplicadas: AlteracaoAplicada[] = [];
  let atual = d;
  if (!flat || typeof flat !== "object" || Array.isArray(flat)) return { dados: d, aplicadas, avisos };
  for (const [chave, bruto] of Object.entries(flat as Record<string, unknown>)) {
    const def = campoDef(chave);
    if (!def || !def.ia || (modo === "aditivo" && !def.aditivavel)) {
      avisos.push(`Campo "${chave}" não pode ser preenchido pelo assistente; ignorado.`);
      continue;
    }
    const v = validarValor(def, bruto);
    if (!v.ok) {
      avisos.push(`${def.rotulo}: ${v.motivo}; ignorado.`);
      continue;
    }
    const antes = lerCampo(atual, chave);
    const depois = v.valor as string | number | boolean;
    if (antes === depois) continue;
    atual = definirCampo(atual, chave, depois);
    aplicadas.push({ chave, rotulo: def.rotulo, antes, depois });
  }
  return { dados: atual, aplicadas, avisos };
}

// ---------------------------------------------------------------------------
// Diferença entre dois conjuntos de dados (perfis e aditivos)
// ---------------------------------------------------------------------------
/** Só o que mudou de `base` para `atual` (inclui texto esvaziado, ao contrário de mesclarDados). */
export function diffParcial(base: ContratoDados, atual: ContratoDados, secoes?: Array<keyof ContratoDados>): ContratoParcial {
  const out: Record<string, Record<string, unknown>> = {};
  const lista = secoes || (Object.keys(base) as Array<keyof ContratoDados>);
  for (const s of lista) {
    const b = base[s] as unknown as Record<string, unknown>;
    const a = atual[s] as unknown as Record<string, unknown>;
    for (const k of Object.keys(a)) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b?.[k])) (out[s] ||= {})[k] = a[k];
    }
  }
  return out as ContratoParcial;
}

/** Aplica um parcial sem descartar texto vazio (o aditivo pode esvaziar um campo). */
export function aplicarParcial(base: ContratoDados, extra: ContratoParcial | null | undefined): ContratoDados {
  const out = { ...base };
  if (!extra || typeof extra !== "object") return out;
  for (const k of Object.keys(base) as Array<keyof ContratoDados>) {
    const p = extra[k];
    if (p && typeof p === "object") out[k] = { ...base[k], ...p } as never;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Perfis de honorário (predefinições por situação)
// ---------------------------------------------------------------------------
export type PresetCriterios = { enquadramento?: Enquadramento | ""; tipoEmpresa?: TipoEmpresa | ""; complexidade?: Complexidade | "" };

export type ContratoPreset = {
  id: string;
  nome: string;
  descricao: string;
  criterios: PresetCriterios;
  dados: ContratoParcial;
  ordem: number;
  ativo: boolean;
};

/** Seções que um perfil pode definir (nada de dados do cliente nem da contratada). */
export const SECOES_PRESET: Array<keyof ContratoDados> = ["objeto", "honorarios", "prazos", "vigencia"];

/** Perfil mais específico cujos critérios batem todos com a empresa; sem critério = nunca sugerido. */
export function sugerirPreset(presets: ContratoPreset[] | null | undefined, objeto: ContratoDados["objeto"]): ContratoPreset | null {
  let melhor: { p: ContratoPreset; score: number } | null = null;
  for (const p of presets || []) {
    if (!p.ativo) continue;
    const cr = p.criterios || {};
    const regras: Array<[string | undefined, string]> = [
      [cr.enquadramento, objeto.enquadramento],
      [cr.tipoEmpresa, objeto.tipoEmpresa],
      [cr.complexidade, objeto.complexidade],
    ];
    const definidas = regras.filter(([v]) => v);
    if (!definidas.length || definidas.some(([v, atual]) => v !== atual)) continue;
    if (!melhor || definidas.length > melhor.score || (definidas.length === melhor.score && p.ordem < melhor.p.ordem)) {
      melhor = { p, score: definidas.length };
    }
  }
  return melhor ? melhor.p : null;
}

/** Valores que, em zero, significam "ainda não definido" (aparecem em amarelo no contrato). */
const NUMEROS_VAZIOS_SE_ZERO = ["valorMensal", "faturamentoLimite", "valorFuncAdicional"];
const CLASSIFICACAO: Array<keyof ContratoDados["objeto"]> = ["modelo", "enquadramento", "tipoEmpresa", "complexidade"];

function semZerosVazios(p: ContratoParcial | null | undefined): ContratoParcial {
  const h = p?.honorarios;
  if (!h) return p || {};
  const limpo = { ...h } as Record<string, unknown>;
  for (const k of NUMEROS_VAZIOS_SE_ZERO) if (limpo[k] === 0) delete limpo[k];
  return { ...p, honorarios: limpo as ContratoParcial["honorarios"] };
}

/**
 * Empilha as fontes de um contrato novo, da mais geral para a mais específica:
 * padrões do escritório → perfil → dados básicos da empresa → cadastro prévio.
 * O cadastro vale mais que o perfil (valor negociado), exceto na classificação (modelo,
 * enquadramento, tipo, complexidade) quando um perfil foi escolhido: ali o perfil manda.
 */
export function camadasDados(
  base: ContratoDados,
  fontes: { padroes?: ContratoParcial | null; preset?: ContratoPreset | null; basico?: ContratoParcial | null; cadastro?: ContratoParcial | null }
): ContratoDados {
  let d = mesclarDados(base, fontes.padroes);
  if (fontes.preset) d = mesclarDados(d, fontes.preset.dados);
  d = mesclarDados(d, fontes.basico);
  let cad = semZerosVazios(fontes.cadastro);
  if (fontes.preset && cad.objeto) {
    const objeto = { ...cad.objeto } as Record<string, unknown>;
    for (const k of CLASSIFICACAO) delete objeto[k];
    cad = { ...cad, objeto: objeto as ContratoParcial["objeto"] };
  }
  return mesclarDados(d, cad);
}

// ---------------------------------------------------------------------------
// Aditivos
// ---------------------------------------------------------------------------
export type AditivoDados = {
  versao: 1;
  numero: number;
  paiId: string;
  paiTitulo: string;
  /** Quando o contrato original foi assinado (ISO). */
  paiAssinadoEm: string;
  /** Condições vigentes antes deste aditivo (contrato + aditivos anteriores). */
  base: ContratoDados;
  /** Só o que muda (mais cidade/data/testemunhas da assinatura). */
  novo: ContratoParcial;
  /** Data a partir da qual a alteração vale (ISO). */
  efeito: string;
  /** Motivo livre, ex.: "reajuste anual de 2026". */
  motivo: string;
};

export function normalizarAditivo(raw: unknown): AditivoDados {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<AditivoDados>;
  return {
    versao: 1,
    numero: Number(o.numero) || 1,
    paiId: String(o.paiId || ""),
    paiTitulo: String(o.paiTitulo || ""),
    paiAssinadoEm: String(o.paiAssinadoEm || ""),
    base: normalizarDados(o.base),
    novo: o.novo && typeof o.novo === "object" ? o.novo : {},
    efeito: String(o.efeito || ""),
    motivo: String(o.motivo || ""),
  };
}

/** Condições resultantes do aditivo = base + alterações. */
export function dadosDoAditivo(ad: AditivoDados): ContratoDados {
  return aplicarParcial(ad.base, ad.novo);
}

function plural(n: number, s: string, p: string): string {
  return n === 1 ? s : p;
}

export function fmtValor(def: CampoDef, v: string | number | boolean): string {
  if (def.tipo === "bool") return (def.boolTxt || ["sim", "não"])[v ? 0 : 1];
  if (def.tipo === "enum") return def.opcoes?.find((o) => o.valor === v)?.rotulo || String(v);
  if (def.tipo === "data") return fmtData(String(v)) || "não informada";
  if (def.tipo === "texto") return String(v).trim() || "não informado";
  const n = Number(v);
  switch (def.fmt) {
    case "moeda":
      return n > 0 ? moedaExtenso(n) : brl(n);
    case "pct":
      return `${String(n).replace(".", ",")}%`;
    case "dia":
      return `dia ${n}`;
    case "dias":
      return `${n} ${plural(n, "dia", "dias")}`;
    case "diasUteis":
      return `${n} ${plural(n, "dia útil", "dias úteis")}`;
    case "mensalidades":
      return `${String(n).replace(".", ",")} ${plural(n, "mensalidade", "mensalidades")}`;
    default:
      return String(n);
  }
}

export type AlteracaoCampo = { def: CampoDef; de: string | number | boolean; para: string | number | boolean };

/** Campos aditiváveis que diferem entre as condições anteriores e as novas. */
export function alteracoesEntre(base: ContratoDados, novo: ContratoDados): AlteracaoCampo[] {
  const lista: AlteracaoCampo[] = [];
  for (const def of CAMPOS) {
    if (!def.aditivavel) continue;
    const de = lerCampo(base, def.chave);
    const para = lerCampo(novo, def.chave);
    if (JSON.stringify(de) !== JSON.stringify(para)) lista.push({ def, de, para });
  }
  return lista;
}

export function tituloAditivo(ad: AditivoDados): string {
  const nome = dadosDoAditivo(ad).contratante.razao.trim() || "[CONTRATANTE]";
  return `Aditivo nº ${ad.numero} ao contrato de prestação de serviços contábeis — ${nome}`;
}

/** Reajuste percentual da mensalidade (e, se pedido, do valor por empregado adicional). */
export function reajustar(d: ContratoDados, pct: number, opts: { extras?: boolean } = {}): ContratoDados {
  const f = 1 + pct / 100;
  const r2 = (n: number) => Math.round(n * f * 100) / 100;
  let out = definirCampo(d, "honorarios.valorMensal", r2(d.honorarios.valorMensal));
  if (opts.extras && d.honorarios.valorFuncAdicional) out = definirCampo(out, "honorarios.valorFuncAdicional", r2(d.honorarios.valorFuncAdicional));
  return out;
}

function ph(v: string | null | undefined, rotulo: string): string {
  const s = (v || "").trim();
  return s ? s : `[${rotulo.toUpperCase()}]`;
}

/**
 * Texto do aditivo. Mesmo formato de blocos do contrato: prévia, impressão e PDF não mudam.
 * As cláusulas de alteração saem do diff (de → para), então nunca divergem do que foi editado.
 */
export function montarAditivo(ad: AditivoDados): Bloco[] {
  const B: Bloco[] = [];
  const novo = dadosDoAditivo(ad);
  const ct = novo.contratante;
  const cd = novo.contratada;
  const alts = alteracoesEntre(ad.base, novo);
  const original = ad.paiAssinadoEm ? `assinado em ${dataExtenso(ad.paiAssinadoEm.slice(0, 10))}` : "firmado entre as partes";
  const efeito = ad.efeito ? dataExtenso(ad.efeito) : "[DATA DE INÍCIO DA ALTERAÇÃO]";

  B.push({
    t: "resumo",
    itens: [
      { titulo: "Contrato original", texto: `Prestação de serviços contábeis, ${original}.` },
      { titulo: "O que muda", texto: alts.length ? `${alts.length} ${plural(alts.length, "condição", "condições")} (Cláusula 2).` : "[NENHUMA ALTERAÇÃO INFORMADA]" },
      { titulo: "Vale a partir de", texto: `${efeito} (Cláusula 3).` },
      { titulo: "O resto", texto: "Todas as demais cláusulas continuam como estão (Cláusula 4)." },
    ],
  });

  B.push({ t: "secao", titulo: "DAS PARTES" });
  B.push({
    t: "parte",
    rotulo: "CONTRATANTE",
    texto:
      `**${ph(ct.razao, "razão social da contratante")}**, CNPJ nº ${ph(ct.cnpj, "cnpj")}, com sede na ${ph(ct.endereco, "endereço da contratante")}` +
      `, representada por **${ph(ct.repNome, "representante")}**, CPF nº ${ph(ct.repCpf, "cpf do representante")}, doravante **CONTRATANTE**.`,
  });
  B.push({
    t: "parte",
    rotulo: "CONTRATADA",
    texto:
      `**${ph(cd.razao, "razão social da contratada")}**, CNPJ nº ${ph(cd.cnpj, "cnpj da contratada")}` +
      (cd.endereco.trim() ? `, com sede na ${cd.endereco.trim()}` : "") +
      `, representada por seu responsável técnico, o contador **${ph(cd.respTecnico, "responsável técnico")}**, ${ph(cd.crcRt, "crc")}, doravante **CONTRATADA**.`,
  });
  B.push({
    t: "par",
    texto: `As partes firmaram contrato de prestação de serviços contábeis, ${original}, e resolvem alterá-lo por este **Aditivo nº ${ad.numero}**, nos termos abaixo.`,
  });

  B.push({ t: "secao", titulo: "CLÁUSULA 1  ·  OBJETO DO ADITIVO" });
  B.push({
    t: "clausula",
    num: "1.",
    texto: ad.motivo.trim()
      ? `Este aditivo altera as condições do contrato original em razão de: ${ad.motivo.trim()}.`
      : "Este aditivo altera as condições do contrato original nos pontos indicados na Cláusula 2.",
  });

  B.push({ t: "secao", titulo: "CLÁUSULA 2  ·  ALTERAÇÕES" });
  if (!alts.length) {
    B.push({ t: "clausula", num: "2.1.", texto: "[DESCREVA AS ALTERAÇÕES]" });
  } else {
    alts.forEach((a, i) => {
      B.push({
        t: "clausula",
        num: `2.${i + 1}.`,
        texto: `**${a.def.rotulo}:** passa de ${fmtValor(a.def, a.de)} para **${fmtValor(a.def, a.para)}**.`,
      });
    });
  }

  B.push({ t: "secao", titulo: "CLÁUSULA 3  ·  VIGÊNCIA DA ALTERAÇÃO" });
  B.push({ t: "clausula", num: "3.", texto: `As alterações desta cláusula 2 valem a partir de **${efeito}**, sem efeito retroativo.` });

  B.push({ t: "secao", titulo: "CLÁUSULA 4  ·  RATIFICAÇÃO" });
  B.push({
    t: "clausula",
    num: "4.",
    texto: "Permanecem inalteradas e ratificadas todas as demais cláusulas e condições do contrato original e dos aditivos anteriores, que continuam em pleno vigor. Em caso de divergência, prevalece este aditivo apenas quanto aos pontos expressamente alterados.",
  });

  B.push({ t: "secao", titulo: "ASSIM," });
  B.push({
    t: "par",
    texto: "para firmeza e como prova de haverem ajustado, firmam este aditivo em duas vias de igual teor ou por assinatura eletrônica válida (art. 784, § 4º, do Código de Processo Civil).",
  });
  // Foro não é aditivável: a cidade-padrão vem do contrato original, não de uma edição solta.
  const cidade = (novo.assinatura.cidade || "").trim() || (ad.base.vigencia.foro || "").trim() || "[CIDADE/UF]";
  B.push({ t: "data", texto: `${cidade}, ${novo.assinatura.data ? dataExtenso(novo.assinatura.data) : "_____ de ______________ de ______"}.` });
  B.push({
    t: "assinaturas",
    itens: [
      { rotulo: "CONTRATANTE", nome: ph(ct.razao, "razão social da contratante"), linhas: [ph(ct.repNome, "representante"), "Representante legal"] },
      {
        rotulo: "CONTRATADA",
        nome: ph(cd.razao, "razão social da contratada"),
        linhas: cd.repNome.trim()
          ? [cd.repNome.trim(), `Resp. técnico: ${ph(cd.respTecnico, "responsável técnico")} · ${ph(cd.crcRt, "crc")}`]
          : [`${ph(cd.respTecnico, "responsável técnico")} · ${ph(cd.crcRt, "crc")}`, "Responsável técnico e representante"],
      },
    ],
  });
  return B;
}

/** Pendências do aditivo (para o aviso amarelo do editor). */
export function pendentesAditivo(ad: AditivoDados): string[] {
  const novo = dadosDoAditivo(ad);
  const lista: Array<[boolean, string]> = [
    [!alteracoesEntre(ad.base, novo).length, "Nenhuma alteração feita"],
    [!ad.efeito, "Data de início da alteração"],
    [!novo.contratante.razao.trim(), "Razão social da contratante"],
    [!novo.contratante.repNome.trim(), "Representante da contratante"],
  ];
  return lista.filter(([v]) => v).map(([, r]) => r);
}
