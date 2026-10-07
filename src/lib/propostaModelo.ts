/**
 * Propostas comerciais: catálogo de serviços, pacotes prontos, cálculo e texto.
 *
 * A proposta é uma lista de ITENS tirados de um catálogo configurável (o que o escritório
 * vende: regularização de MEI, parcelamentos, abertura, alteração, mensalidade…). O
 * valor de cada item é calculado aqui, de forma determinística — nem a IA nem a tela
 * "fazem conta" por conta própria. O texto sai como a mesma lista de blocos do contrato
 * (`Bloco`), então a prévia HTML e o PDF reaproveitam o desenho já existente.
 *
 * O assistente (agente) só devolve um PATCH (`PatchProposta`): quais pacotes aplicar,
 * quais itens somar/alterar/tirar e quais dados do cliente preencher. `aplicarPatch`
 * valida tudo contra o catálogo antes de mexer na proposta.
 */
import {
  TABELA_BASE,
  brl,
  dataExtenso,
  fmtData,
  valorSugerido,
  type Bloco,
  type Complexidade,
  type Enquadramento,
  type PadraoHonorario,
  type TipoEmpresa,
} from "@/lib/contratoModelo";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
/**
 * unico: valor × quantidade · mensal: valor × quantidade por mês (recorrente) ·
 * retroativo: valor mensal × meses (quantidade = meses) · percentual: % sobre uma base
 * (ex.: valor do débito parcelado) com mínimo · repasse: custo de terceiros, sem margem ·
 * sob_consulta: sem valor definido.
 */
export type ModoCobranca = "unico" | "mensal" | "retroativo" | "percentual" | "repasse" | "sob_consulta";
export type GrupoServico = "mensal" | "regularizacao" | "parcelamentos" | "societario" | "avulso";

export const MODO_LABEL: Record<ModoCobranca, string> = {
  unico: "Valor fechado (× quantidade)",
  mensal: "Mensal recorrente",
  retroativo: "Retroativo (mensalidade × meses)",
  percentual: "Percentual sobre um valor",
  repasse: "Custo repassado (sem margem)",
  sob_consulta: "Sob consulta",
};

export const GRUPO_LABEL: Record<GrupoServico, string> = {
  mensal: "Contabilidade mensal",
  regularizacao: "Regularização e declarações em atraso",
  parcelamentos: "Parcelamentos e negociação de dívidas",
  societario: "Abertura, alteração e encerramento",
  avulso: "Avulsos e custos de terceiros",
};

export type EscadaValor = { rotulo: string; valor: number };

export type ItemProposta = {
  uid: string;
  codigo: string;
  grupo: GrupoServico;
  titulo: string;
  /** Unidade de cobrança: "declaração", "competência", "parcelamento", "mês", "pessoa"… */
  unidade: string;
  modo: ModoCobranca;
  valorUnit: number;
  quantidade: number;
  /** Só `percentual`: valor sobre o qual incide (ex.: total do débito a parcelar). */
  base: number;
  percentual: number;
  minimo: number;
  /** % cobrado na contratação; o resto vai para `saldoQuando`. 0 = sem entrada. */
  entradaPct: number;
  /** Nº de parcelas dos honorários (sem entrada). 1 = à vista. */
  parcelas: number;
  saldoQuando: string;
  /** Mensalidade que muda ao longo do tempo (ex.: 250 até dez/25, 280 em 2026…). */
  escada: EscadaValor[];
  descricao: string[];
  prazo: string;
  /** Substitui o texto automático da forma de pagamento. */
  pagamento: string;
  obs: string[];
  /** Valor vem da tabela de honorários (tipo × complexidade) enquanto não for editado à mão. */
  tabelaBase?: boolean;
  manual?: boolean;
  /** Criado automaticamente (ex.: funcionário excedente) e removido sozinho quando deixa de valer. */
  auto?: boolean;
  /** Entra na proposta? Desmarcado fica guardado, mas não aparece no documento. */
  ativo: boolean;
};

export type ItemCatalogo = Omit<ItemProposta, "uid" | "ativo" | "manual" | "auto"> & { habilitado: boolean };

export type Pacote = {
  id: string;
  nome: string;
  descricao: string;
  /** Itens que o pacote traz (codigo do catálogo), com ajustes de quantidade. */
  itens: Array<{ codigo: string; quantidade?: number }>;
  /** Roteiro do que perguntar ao cliente — o assistente e a tela usam a mesma lista. */
  perguntas: string[];
  habilitado: boolean;
};

export type Condicoes = {
  vencimentoDia: number;
  formaPagamento: string;
  chavePix: string;
  funcionariosIncluidos: number;
  valorFuncionarioExtra: number;
  guiasAntecedenciaDias: number;
  reajuste: string;
  observacoes: string[];
};

export type PropostaDados = {
  cliente: {
    nome: string;
    cnpj: string;
    /** "Sr.", "Sra." ou vazio (usa só o nome). */
    tratamento: string;
    contato: string;
    email: string;
    telefone: string;
    enquadramento: Enquadramento;
    tipoEmpresa: TipoEmpresa;
    complexidade: Complexidade;
    funcionarios: number;
    /** Situação em uma frase ("MEI com DASN de 2022 a 2024 em atraso e R$ 8 mil em DAS"). */
    situacao: string;
  };
  cabecalho: {
    assunto: string;
    cidade: string;
    data: string;
    validadeDias: number;
    /** Opcional: texto de abertura. Vazio usa o padrão. */
    introducao: string;
  };
  condicoes: Condicoes;
  assinatura: { nome: string; cargo: string };
  pacotes: string[];
  itens: ItemProposta[];
};

export type PadroesProposta = {
  contratada: { razao: string; cnpj: string; endereco: string; email: string; telefone: string };
  cabecalho: { cidade: string; validadeDias: number };
  condicoes: Condicoes;
  assinatura: { nome: string; cargo: string };
};

export type CatalogoProposta = {
  itens: ItemCatalogo[];
  pacotes: Pacote[];
  padroes: PadroesProposta;
};

export type PropostaStatus = "rascunho" | "salva" | "enviada" | "aceita" | "recusada";

export const STATUS_PROPOSTA_LABEL: Record<PropostaStatus, string> = {
  rascunho: "Rascunho",
  salva: "PDF no portal",
  enviada: "Enviada ao cliente",
  aceita: "Aceita",
  recusada: "Recusada",
};

export type PropostaResumo = {
  id: string;
  company_id: string | null;
  company_name: string | null;
  titulo: string;
  cliente_nome: string;
  status: PropostaStatus;
  tem_pdf: boolean;
  total_unico: number;
  total_mensal: number;
  validade_ate: string | null;
  enviada_em: string | null;
  decidida_em: string | null;
  created_at: string;
  updated_at: string;
};

export type PropostaDetalhe = PropostaResumo & { dados: PropostaDados; deliverable_id: string | null };

// ---------------------------------------------------------------------------
// Padrões e catálogo inicial
// ---------------------------------------------------------------------------
export const PADROES_PROPOSTA: PadroesProposta = {
  contratada: {
    razao: "Nescon Contabilidade",
    cnpj: "35.736.034/0001-23",
    endereco: "",
    email: "",
    telefone: "",
  },
  cabecalho: { cidade: "São Paulo", validadeDias: 30 },
  condicoes: {
    vencimentoDia: 15,
    formaPagamento: "boleto bancário",
    chavePix: "35.736.034/0001-23 (CNPJ)",
    funcionariosIncluidos: 3,
    valorFuncionarioExtra: 70,
    guiasAntecedenciaDias: 5,
    reajuste: "",
    observacoes: [],
  },
  assinatura: { nome: "Jeandson", cargo: "Diretor Comercial" },
};

function item(p: Partial<ItemCatalogo> & Pick<ItemCatalogo, "codigo" | "grupo" | "titulo" | "unidade" | "modo" | "valorUnit">): ItemCatalogo {
  return {
    quantidade: 1,
    base: 0,
    percentual: 0,
    minimo: 0,
    entradaPct: 0,
    parcelas: 1,
    saldoQuando: "ao final do processo",
    escada: [],
    descricao: [],
    prazo: "",
    pagamento: "",
    obs: [],
    habilitado: true,
    ...p,
  };
}

/**
 * Valores iniciais: o que já é praticado (mensalidade 350/500, funcionário extra R$ 70,
 * abertura R$ 1.200, certificados R$ 150/180) e estimativas para o restante. TODOS são
 * editáveis em Propostas › Catálogo e pacotes.
 */
export const CATALOGO_PADRAO: CatalogoProposta = {
  padroes: PADROES_PROPOSTA,
  itens: [
    // ---- mensal
    item({
      codigo: "mensal_mei",
      grupo: "mensal",
      titulo: "Contabilidade mensal — MEI",
      unidade: "mês",
      modo: "mensal",
      valorUnit: 100,
      descricao: ["Emissão mensal do DAS-MEI e acompanhamento do limite de faturamento.", "Declaração anual (DASN-SIMEI) e orientação de notas fiscais."],
    }),
    item({
      codigo: "mensal_me_epp",
      grupo: "mensal",
      titulo: "Contabilidade mensal — Departamento Pessoal, Fiscal e Contábil",
      unidade: "mês",
      modo: "mensal",
      valorUnit: 350,
      tabelaBase: true,
      descricao: [
        "Departamento Pessoal: folha, eSocial, FGTS, INSS, admissões, rescisões, férias e 13º.",
        "Fiscal: apuração dos tributos e obrigações acessórias.",
        "Contábil: escrituração completa, balancetes, balanço e DRE.",
      ],
    }),
    item({
      codigo: "folha_extra",
      grupo: "mensal",
      titulo: "Funcionário / pró-labore adicional",
      unidade: "pessoa",
      modo: "mensal",
      valorUnit: 70,
      descricao: ["Cada pessoa além das incluídas na mensalidade."],
    }),
    // ---- regularização
    item({
      codigo: "dasn_atraso",
      grupo: "regularizacao",
      titulo: "Declaração anual do MEI (DASN-SIMEI) em atraso",
      unidade: "ano",
      modo: "unico",
      valorUnit: 150,
      descricao: ["Apuração do faturamento e entrega da declaração de cada ano em atraso.", "Emissão do recibo de entrega."],
      prazo: "Até 5 dias úteis após o recebimento dos dados do faturamento.",
    }),
    item({
      codigo: "recalculo_das_mei",
      grupo: "regularizacao",
      titulo: "Recálculo e emissão de guias DAS-MEI em atraso",
      unidade: "competência",
      modo: "unico",
      valorUnit: 20,
      descricao: ["Atualização de multa e juros e emissão da guia de cada competência."],
    }),
    item({
      codigo: "defis_atraso",
      grupo: "regularizacao",
      titulo: "DEFIS (Simples Nacional) em atraso",
      unidade: "ano",
      modo: "unico",
      valorUnit: 250,
      descricao: ["Apuração e entrega da declaração de cada ano em atraso."],
    }),
    item({
      codigo: "pgdas_atraso",
      grupo: "regularizacao",
      titulo: "Apuração e transmissão do PGDAS-D em atraso",
      unidade: "competência",
      modo: "unico",
      valorUnit: 100,
      descricao: ["Apuração do Simples Nacional e transmissão de cada competência em atraso, com a guia atualizada."],
    }),
    item({
      codigo: "recalculo_competencias",
      grupo: "regularizacao",
      titulo: "Recálculo de competências passadas (fora da mensalidade)",
      unidade: "competência",
      modo: "unico",
      valorUnit: 80,
      descricao: ["Refazer a apuração de competências já encerradas, com retificação das declarações quando necessário."],
    }),
    item({
      codigo: "contab_retroativa",
      grupo: "regularizacao",
      titulo: "Contabilidade retroativa",
      unidade: "mês",
      modo: "retroativo",
      valorUnit: 280,
      pagamento: "No aceite da proposta.",
      descricao: ["Escrituração e demonstrações dos meses em atraso, com mensalidade devida desde o início da competência regularizada."],
    }),
    // ---- parcelamentos
    item({
      codigo: "parc_mei",
      grupo: "parcelamentos",
      titulo: "Parcelamento de débitos do MEI (DAS)",
      unidade: "parcelamento",
      modo: "unico",
      valorUnit: 150,
      descricao: ["Levantamento dos débitos, simulação e pedido de parcelamento.", "Emissão da 1ª guia e orientação sobre as seguintes."],
      obs: ["O valor das parcelas (impostos, multa e juros) é pago pelo cliente diretamente ao órgão e não faz parte dos honorários."],
    }),
    item({
      codigo: "parc_receita",
      grupo: "parcelamentos",
      titulo: "Parcelamento de débitos — Receita Federal",
      unidade: "parcelamento",
      modo: "unico",
      valorUnit: 300,
      descricao: ["Levantamento dos débitos no e-CAC, escolha da melhor modalidade, simulação e pedido de parcelamento."],
      obs: ["O valor das parcelas (impostos, multa e juros) é pago pelo cliente diretamente ao órgão e não faz parte dos honorários."],
    }),
    item({
      codigo: "parc_pgfn",
      grupo: "parcelamentos",
      titulo: "Negociação de dívida ativa — PGFN",
      unidade: "negociação",
      modo: "unico",
      valorUnit: 400,
      descricao: ["Análise das inscrições, escolha da modalidade de transação e adesão no Regularize."],
      obs: ["O valor das parcelas é pago pelo cliente diretamente ao órgão e não faz parte dos honorários."],
    }),
    item({
      codigo: "parc_municipal",
      grupo: "parcelamentos",
      titulo: "Parcelamento de débitos — Prefeitura (ISS e taxas)",
      unidade: "parcelamento",
      modo: "unico",
      valorUnit: 250,
      descricao: ["Levantamento dos débitos municipais, simulação e pedido de parcelamento no portal da prefeitura."],
      obs: ["O valor das parcelas é pago pelo cliente diretamente ao órgão e não faz parte dos honorários."],
    }),
    item({
      codigo: "parc_previdenciario",
      grupo: "parcelamentos",
      titulo: "Parcelamento previdenciário (INSS)",
      unidade: "parcelamento",
      modo: "unico",
      valorUnit: 350,
      descricao: ["Levantamento dos débitos previdenciários, retificação de GFIP/eSocial quando preciso e pedido de parcelamento."],
      obs: ["O valor das parcelas é pago pelo cliente diretamente ao órgão e não faz parte dos honorários."],
    }),
    item({
      codigo: "acompanhamento_parcelamento",
      grupo: "parcelamentos",
      titulo: "Acompanhamento do parcelamento",
      unidade: "mês",
      modo: "mensal",
      valorUnit: 40,
      descricao: ["Emissão e envio mensal da guia do parcelamento e vigilância contra rescisão por atraso."],
    }),
    // ---- societário
    item({
      codigo: "abertura_mei",
      grupo: "societario",
      titulo: "Abertura de MEI",
      unidade: "abertura",
      modo: "unico",
      valorUnit: 0,
      descricao: ["Inscrição no Portal do Empreendedor e emissão do CCMEI."],
    }),
    item({
      codigo: "abertura_empresa",
      grupo: "societario",
      titulo: "Abertura de empresa",
      unidade: "abertura",
      modo: "unico",
      valorUnit: 1200,
      entradaPct: 60,
      saldoQuando: "ao final do processo",
      prazo: "20 a 30 dias para começar a emitir notas fiscais.",
      descricao: [
        "Pedido de viabilidade de nome e endereço.",
        "DBE na Receita Federal e fichas cadastrais.",
        "Contrato social, registro na Junta Comercial e NIRE.",
        "Emissão do CNPJ e das inscrições Municipal e Estadual.",
      ],
      obs: ["Não inclui: taxa de alvará, Corpo de Bombeiros e certificado digital."],
    }),
    item({
      codigo: "alteracao_contratual",
      grupo: "societario",
      titulo: "Alteração contratual",
      unidade: "alteração",
      modo: "unico",
      valorUnit: 600,
      descricao: ["Elaboração da alteração, registro na Junta Comercial e atualização do CNPJ e das inscrições."],
      obs: ["Taxas de registro cobradas pelos órgãos ficam por conta do cliente."],
    }),
    item({
      codigo: "migracao_mei_me",
      grupo: "societario",
      titulo: "Migração de MEI para Microempresa (ME)",
      unidade: "migração",
      modo: "unico",
      valorUnit: 500,
      descricao: ["Desenquadramento do MEI, transformação em empresário individual/ME e novo enquadramento."],
    }),
    item({
      codigo: "baixa_mei",
      grupo: "societario",
      titulo: "Baixa de MEI",
      unidade: "baixa",
      modo: "unico",
      valorUnit: 100,
      descricao: ["Pedido de baixa e entrega da declaração final."],
    }),
    item({
      codigo: "encerramento",
      grupo: "societario",
      titulo: "Encerramento de empresa (baixa)",
      unidade: "encerramento",
      modo: "unico",
      valorUnit: 800,
      descricao: ["Distrato, baixa na Junta, Receita Federal, Estado e Prefeitura, e declarações finais."],
      obs: ["Débitos existentes precisam ser quitados ou parcelados antes da baixa."],
    }),
    // ---- avulsos / repasses
    item({
      codigo: "certificado_ecpf",
      grupo: "avulso",
      titulo: "Certificado digital e-CPF",
      unidade: "certificado",
      modo: "repasse",
      valorUnit: 150,
    }),
    item({
      codigo: "certificado_ecnpj",
      grupo: "avulso",
      titulo: "Certificado digital e-CNPJ",
      unidade: "certificado",
      modo: "repasse",
      valorUnit: 180,
    }),
    item({
      codigo: "taxas_oficiais",
      grupo: "avulso",
      titulo: "Taxas oficiais (Junta, prefeitura, bombeiros)",
      unidade: "taxa",
      modo: "sob_consulta",
      valorUnit: 0,
      obs: ["Cobradas pelos órgãos, pelos valores oficiais vigentes, sem acréscimo."],
    }),
  ],
  pacotes: [
    {
      id: "mei_regularizacao",
      nome: "Regularização de MEI",
      descricao: "Declarações em atraso, guias recalculadas, parcelamento de débitos e (opcional) mensalidade.",
      habilitado: true,
      itens: [{ codigo: "dasn_atraso" }, { codigo: "recalculo_das_mei" }, { codigo: "parc_mei" }, { codigo: "mensal_mei" }],
      perguntas: [
        "Quais anos de DASN-SIMEI estão em atraso?",
        "Quantas competências do DAS estão em atraso (para recalcular as guias)?",
        "Há débito do MEI para parcelar? Qual o valor aproximado?",
        "Depois de regularizar, o cliente quer a contabilidade mensal conosco?",
      ],
    },
    {
      id: "mensal_me_epp",
      nome: "Contabilidade mensal — ME/EPP",
      descricao: "Pacote único de DP, fiscal e contábil, com valor pela tabela (tipo × complexidade) e funcionários excedentes.",
      habilitado: true,
      itens: [{ codigo: "mensal_me_epp" }],
      perguntas: [
        "Regime (Simples, Presumido, Real) e atividade (serviço, comércio, indústria)?",
        "Complexidade (baixa, média, alta) e faturamento mensal médio?",
        "Quantos funcionários e sócios com pró-labore?",
        "O cliente vem de outro contador? Há meses atrasados a regularizar?",
      ],
    },
    {
      id: "abertura_empresa",
      nome: "Abertura de empresa + mensalidade",
      descricao: "Constituição completa, certificado e honorário mensal depois da abertura.",
      habilitado: true,
      itens: [{ codigo: "abertura_empresa" }, { codigo: "certificado_ecpf" }, { codigo: "taxas_oficiais" }, { codigo: "mensal_me_epp" }],
      perguntas: [
        "Qual o ramo/atividade e quantos sócios?",
        "Capital social e cidade do endereço?",
        "Já têm certificado digital (e-CPF) dos sócios?",
        "Faturamento esperado e funcionários previstos?",
      ],
    },
    {
      id: "alteracao",
      nome: "Alteração contratual",
      descricao: "Mudança de endereço, atividade, sócios, capital ou nome.",
      habilitado: true,
      itens: [{ codigo: "alteracao_contratual" }, { codigo: "taxas_oficiais" }],
      perguntas: ["O que vai mudar (endereço, atividade, sócios, capital, nome)?", "Quantas alterações no mesmo ato?", "Mudança de cidade/estado?"],
    },
    {
      id: "encerramento",
      nome: "Encerramento de empresa",
      descricao: "Distrato e baixas, com regularização prévia dos débitos se houver.",
      habilitado: true,
      itens: [{ codigo: "encerramento" }],
      perguntas: ["MEI ou empresa (ME/EPP/Ltda)?", "Há débitos ou obrigações em atraso que impedem a baixa?", "Há funcionários a rescindir?"],
    },
    {
      id: "parcelamentos",
      nome: "Parcelamentos e dívidas",
      descricao: "Receita Federal, PGFN, prefeitura e INSS — escolha quais órgãos.",
      habilitado: true,
      itens: [{ codigo: "parc_receita" }],
      perguntas: [
        "Quais órgãos têm débito: Receita Federal, PGFN, prefeitura, INSS?",
        "Valor aproximado de cada dívida?",
        "Já há parcelamento em andamento (rescindido ou em dia)?",
        "Cobrar valor fechado ou percentual sobre a dívida?",
      ],
    },
    {
      id: "retroativo",
      nome: "Recálculos e meses em atraso",
      descricao: "Competências passadas fora do escopo da mensalidade: PGDAS, DEFIS, recálculos e contabilidade retroativa.",
      habilitado: true,
      itens: [{ codigo: "pgdas_atraso" }, { codigo: "defis_atraso" }, { codigo: "recalculo_competencias" }, { codigo: "contab_retroativa" }],
      perguntas: [
        "Desde que mês/ano estão em atraso?",
        "Quais declarações (PGDAS-D, DEFIS, EFD, ECD) faltam entregar?",
        "Quantas competências precisam ser recalculadas?",
        "A contabilidade retroativa será cobrada desde quando?",
      ],
    },
    {
      id: "regularizacao_me_epp",
      nome: "Regularização de ME/EPP + mensalidade",
      descricao: "Entrega do que está atrasado, parcelamento e mensalidade dali em diante.",
      habilitado: true,
      itens: [{ codigo: "pgdas_atraso" }, { codigo: "defis_atraso" }, { codigo: "parc_receita" }, { codigo: "mensal_me_epp" }],
      perguntas: [
        "Quais competências do PGDAS-D e quais anos da DEFIS estão em atraso?",
        "Há débito para parcelar? Em qual órgão e de quanto?",
        "Regime, atividade, complexidade, funcionários?",
      ],
    },
  ],
};

/** Salvo sobre o padrão: o que o escritório mexeu vale; itens/pacotes novos do padrão aparecem. */
export function mesclarCatalogo(salvo: Partial<CatalogoProposta> | null | undefined): CatalogoProposta {
  const base = CATALOGO_PADRAO;
  const s = salvo || {};
  const porCodigo = new Map((Array.isArray(s.itens) ? s.itens : []).map((i) => [i.codigo, i]));
  const itens = base.itens.map((i) => ({ ...i, ...(porCodigo.get(i.codigo) || {}) }));
  for (const i of porCodigo.values()) if (!base.itens.some((b) => b.codigo === i.codigo)) itens.push({ ...item(i), ...i });
  const pacs = new Map((Array.isArray(s.pacotes) ? s.pacotes : []).map((p) => [p.id, p]));
  const pacotes = base.pacotes.map((p) => ({ ...p, ...(pacs.get(p.id) || {}) }));
  for (const p of pacs.values()) if (!base.pacotes.some((b) => b.id === p.id)) pacotes.push(p);
  const pd = s.padroes || ({} as Partial<PadroesProposta>);
  return {
    itens,
    pacotes,
    padroes: {
      contratada: { ...base.padroes.contratada, ...(pd.contratada || {}) },
      cabecalho: { ...base.padroes.cabecalho, ...(pd.cabecalho || {}) },
      condicoes: { ...base.padroes.condicoes, ...(pd.condicoes || {}) },
      assinatura: { ...base.padroes.assinatura, ...(pd.assinatura || {}) },
    },
  };
}

// ---------------------------------------------------------------------------
// Proposta nova e itens
// ---------------------------------------------------------------------------
export function hojeIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let seq = 0;
function novoUid(): string {
  seq += 1;
  const c = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${seq}-${Math.random()}`;
  return c;
}

export function propostaNova(cat: CatalogoProposta = CATALOGO_PADRAO): PropostaDados {
  const p = cat.padroes;
  return {
    cliente: {
      nome: "",
      cnpj: "",
      tratamento: "",
      contato: "",
      email: "",
      telefone: "",
      enquadramento: "simples",
      tipoEmpresa: "servico",
      complexidade: "media",
      funcionarios: 0,
      situacao: "",
    },
    cabecalho: { assunto: "", cidade: p.cabecalho.cidade, data: hojeIso(), validadeDias: p.cabecalho.validadeDias, introducao: "" },
    condicoes: { ...p.condicoes, observacoes: [...p.condicoes.observacoes] },
    assinatura: { ...p.assinatura },
    pacotes: [],
    itens: [],
  };
}

/** Mescla o que veio salvo (pode estar velho ou incompleto) sobre uma proposta nova. */
export function normalizarProposta(raw: unknown, cat: CatalogoProposta = CATALOGO_PADRAO): PropostaDados {
  const base = propostaNova(cat);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<PropostaDados>;
  return {
    cliente: { ...base.cliente, ...(r.cliente || {}) },
    cabecalho: { ...base.cabecalho, ...(r.cabecalho || {}) },
    condicoes: { ...base.condicoes, ...(r.condicoes || {}), observacoes: Array.isArray(r.condicoes?.observacoes) ? r.condicoes!.observacoes : base.condicoes.observacoes },
    assinatura: { ...base.assinatura, ...(r.assinatura || {}) },
    pacotes: Array.isArray(r.pacotes) ? r.pacotes : [],
    itens: Array.isArray(r.itens) ? r.itens.map((i) => ({ ...itemVazio(), ...i, uid: i.uid || novoUid() })) : [],
  };
}

function itemVazio(): ItemProposta {
  return { ...item({ codigo: "", grupo: "avulso", titulo: "", unidade: "", modo: "unico", valorUnit: 0 }), uid: "", ativo: true };
}

export function itemDoCatalogo(c: ItemCatalogo, cliente: PropostaDados["cliente"], tabela?: PadraoHonorario[] | null, extra?: { quantidade?: number }): ItemProposta {
  const { habilitado: _h, ...resto } = c;
  void _h;
  const i: ItemProposta = {
    ...resto,
    descricao: [...c.descricao],
    obs: [...c.obs],
    escada: c.escada.map((e) => ({ ...e })),
    uid: novoUid(),
    ativo: true,
  };
  if (extra?.quantidade != null) i.quantidade = extra.quantidade;
  if (c.tabelaBase) i.valorUnit = valorDaTabela(cliente, tabela, c.valorUnit);
  return i;
}

export function valorDaTabela(cliente: PropostaDados["cliente"], tabela: PadraoHonorario[] | null | undefined, fallback: number): number {
  if (cliente.enquadramento === "mei") return fallback;
  const v = valorSugerido(cliente.enquadramento, cliente.tipoEmpresa, cliente.complexidade, tabela);
  return v.valor > 0 ? v.valor : TABELA_BASE[cliente.tipoEmpresa]?.[cliente.complexidade] ?? fallback;
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------
function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type CalculoItem = {
  /** Valor pontual (pagamento único). Null se não há (mensal / sob consulta). */
  total: number | null;
  /** Valor recorrente por mês. */
  mensal: number | null;
  /** Se é custo de terceiros. */
  repasse: boolean;
  /** Parte paga na contratação / saldo, quando há entrada. */
  entrada: number;
  saldo: number;
  /** Texto do "Custo". */
  custo: string;
  /** Texto da "Forma de pagamento". */
  pagamento: string;
};

export function calcularItem(i: ItemProposta, cond: Condicoes): CalculoItem {
  const q = Math.max(0, i.quantidade || 0);
  let total: number | null = null;
  let mensal: number | null = null;
  let custo = "";
  const un = i.unidade || "unidade";
  const pluralUn = q === 1 ? un : pluralizar(un);

  switch (i.modo) {
    case "unico":
    case "repasse": {
      total = r2(i.valorUnit * q);
      if (i.valorUnit === 0) custo = "**Sem custo** (incluído)";
      else custo = q === 1 ? `**${brl(total)}** por ${un}` : `${brl(i.valorUnit)} por ${un} × ${q} ${pluralUn} = **${brl(total)}**`;
      if (i.modo === "repasse" && i.valorUnit > 0) custo += " (custo repassado, sem margem)";
      break;
    }
    case "retroativo": {
      total = r2(i.valorUnit * q);
      custo = `${brl(i.valorUnit)} por mês × ${q} ${q === 1 ? "mês" : "meses"} = **${brl(total)}**`;
      break;
    }
    case "percentual": {
      const bruto = (i.base * i.percentual) / 100;
      total = r2(Math.max(bruto, i.minimo || 0));
      custo =
        i.base > 0
          ? `${num2(i.percentual)}% sobre ${brl(i.base)}${i.minimo ? ` (mínimo ${brl(i.minimo)})` : ""} = **${brl(total)}**`
          : `${num2(i.percentual)}% sobre o valor do débito${i.minimo ? ` (mínimo ${brl(i.minimo)})` : ""}`;
      if (i.base <= 0) total = i.minimo > 0 ? r2(i.minimo) : null;
      break;
    }
    case "mensal": {
      mensal = r2(i.valorUnit * (q || 0));
      if (i.escada.length) {
        custo = `**${brl(i.valorUnit)} por ${un}/mês**, conforme o período:`;
      } else {
        custo = q === 1 ? `**${brl(i.valorUnit)} por mês**` : `${brl(i.valorUnit)} por ${un} × ${q} = **${brl(mensal)} por mês**`;
      }
      break;
    }
    case "sob_consulta":
      custo = "Valor conforme tabela oficial do órgão, informado antes do pedido";
      break;
  }

  let entrada = 0;
  let saldo = 0;
  let pagamento = i.pagamento.trim();
  if (!pagamento) {
    if (i.modo === "mensal") {
      pagamento = `Todo dia ${cond.vencimentoDia}, via ${cond.formaPagamento}.`;
    } else if (i.modo === "sob_consulta") {
      pagamento = "Pago pelo cliente diretamente ao órgão.";
    } else if (i.modo === "repasse") {
      pagamento = "Na contratação, via PIX.";
    } else if (total != null && total > 0) {
      if (i.entradaPct > 0 && i.entradaPct < 100) {
        entrada = r2((total * i.entradaPct) / 100);
        saldo = r2(total - entrada);
        pagamento = `${i.entradaPct}% (${brl(entrada)}) na contratação e ${100 - i.entradaPct}% (${brl(saldo)}) ${i.saldoQuando || "ao final do processo"}.`;
      } else if (i.parcelas > 1) {
        const p = r2(total / i.parcelas);
        pagamento = `Em ${i.parcelas} parcelas de ${brl(p)}.`;
      } else {
        pagamento = "À vista, na contratação.";
      }
    }
  }
  if (total != null && !entrada && !saldo) entrada = total;
  return { total, mensal, repasse: i.modo === "repasse", entrada, saldo, custo, pagamento };
}

function num2(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

function pluralizar(un: string): string {
  const u = un.trim();
  if (!u) return "unidades";
  if (/ão$/i.test(u)) return u.replace(/ão$/i, "ões");
  if (/(r|z|s)$/i.test(u)) return `${u}es`;
  return `${u}s`;
}

export type TotaisProposta = {
  /** Serviços de pagamento único (sem repasses). */
  unico: number;
  repasses: number;
  mensal: number;
  /** O que sai na contratação: entradas + à vista + repasses. */
  naContratacao: number;
  /** Saldos a pagar depois (itens com entrada). */
  saldos: number;
  semValor: number;
};

export function totais(d: PropostaDados): TotaisProposta {
  const t: TotaisProposta = { unico: 0, repasses: 0, mensal: 0, naContratacao: 0, saldos: 0, semValor: 0 };
  for (const i of d.itens) {
    if (!i.ativo) continue;
    const c = calcularItem(i, d.condicoes);
    if (c.mensal != null) t.mensal += c.mensal;
    if (c.total != null) {
      if (c.repasse) t.repasses += c.total;
      else t.unico += c.total;
      t.naContratacao += c.entrada;
      t.saldos += c.saldo;
    } else if (c.mensal == null) t.semValor += 1;
  }
  t.unico = r2(t.unico);
  t.repasses = r2(t.repasses);
  t.mensal = r2(t.mensal);
  t.naContratacao = r2(t.naContratacao);
  t.saldos = r2(t.saldos);
  return t;
}

// ---------------------------------------------------------------------------
// Automatismos: pacotes, tabela, funcionários
// ---------------------------------------------------------------------------
export function aplicarPacote(d: PropostaDados, cat: CatalogoProposta, pacoteId: string, tabela?: PadraoHonorario[] | null): PropostaDados {
  const pac = cat.pacotes.find((p) => p.id === pacoteId);
  if (!pac) return d;
  const itens = [...d.itens];
  for (const ref of pac.itens) {
    if (itens.some((i) => i.codigo === ref.codigo)) continue;
    const c = cat.itens.find((x) => x.codigo === ref.codigo);
    if (c) itens.push(itemDoCatalogo(c, d.cliente, tabela, { quantidade: ref.quantidade }));
  }
  const pacotes = d.pacotes.includes(pacoteId) ? d.pacotes : [...d.pacotes, pacoteId];
  return reconciliar({ ...d, itens, pacotes }, cat, tabela);
}

export function adicionarItem(d: PropostaDados, cat: CatalogoProposta, codigo: string, tabela?: PadraoHonorario[] | null): PropostaDados {
  const c = cat.itens.find((x) => x.codigo === codigo);
  if (!c) return d;
  return reconciliar({ ...d, itens: [...d.itens, itemDoCatalogo(c, d.cliente, tabela)] }, cat, tabela);
}

/**
 * Mantém a proposta coerente depois de qualquer mudança:
 *  1. itens "da tabela" acompanham tipo/complexidade, a não ser que o valor tenha sido editado;
 *  2. funcionários acima do incluído na mensalidade geram o item "funcionário adicional".
 */
export function reconciliar(d: PropostaDados, cat: CatalogoProposta, tabela?: PadraoHonorario[] | null): PropostaDados {
  let itens = d.itens.map((i) => {
    if (!i.tabelaBase || i.manual) return i;
    const v = valorDaTabela(d.cliente, tabela, i.valorUnit);
    return v === i.valorUnit ? i : { ...i, valorUnit: v };
  });
  const temMensalCompleta = itens.some((i) => i.codigo === "mensal_me_epp" && i.ativo);
  const excedente = Math.max(0, Math.floor(d.cliente.funcionarios || 0) - Math.max(0, d.condicoes.funcionariosIncluidos));
  const idx = itens.findIndex((i) => i.codigo === "folha_extra" && i.auto);
  if (temMensalCompleta && excedente > 0) {
    if (idx >= 0) {
      itens = itens.map((i, k) => (k === idx ? { ...i, quantidade: excedente, valorUnit: i.manual ? i.valorUnit : d.condicoes.valorFuncionarioExtra } : i));
    } else if (!itens.some((i) => i.codigo === "folha_extra")) {
      const c = cat.itens.find((x) => x.codigo === "folha_extra");
      if (c) itens = [...itens, { ...itemDoCatalogo(c, d.cliente, tabela, { quantidade: excedente }), valorUnit: d.condicoes.valorFuncionarioExtra, auto: true }];
    }
  } else if (idx >= 0) {
    itens = itens.filter((_, k) => k !== idx);
  }
  return { ...d, itens };
}

// ---------------------------------------------------------------------------
// Patch do assistente
// ---------------------------------------------------------------------------
export type PatchItem = {
  codigo: string;
  uid?: string;
  titulo?: string;
  quantidade?: number;
  valorUnit?: number;
  base?: number;
  percentual?: number;
  minimo?: number;
  entradaPct?: number;
  parcelas?: number;
  modo?: ModoCobranca;
  prazo?: string;
  pagamento?: string;
  obs?: string[];
  ativo?: boolean;
};

export type PatchProposta = {
  cliente?: Partial<PropostaDados["cliente"]>;
  cabecalho?: Partial<PropostaDados["cabecalho"]>;
  condicoes?: Partial<Omit<Condicoes, "observacoes">> & { observacoes?: string[] };
  pacotes?: string[];
  adicionar?: PatchItem[];
  alterar?: PatchItem[];
  remover?: string[];
};

const ENQ: Enquadramento[] = ["mei", "simples", "presumido", "real"];
const TIPOS: TipoEmpresa[] = ["servico", "comercio", "industria"];
const COMPS: Complexidade[] = ["baixa", "media", "alta"];
const MODOS: ModoCobranca[] = ["unico", "mensal", "retroativo", "percentual", "repasse", "sob_consulta"];

function n(v: unknown, min = 0, max = 10_000_000): number | undefined {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : undefined;
}
function s(v: unknown, max = 300): string | undefined {
  return typeof v === "string" ? v.trim().slice(0, max) : undefined;
}
function dropUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Aplica o patch com validação; devolve a proposta nova e o que foi ignorado (para o assistente corrigir). */
export function aplicarPatch(
  d: PropostaDados,
  patch: PatchProposta | null | undefined,
  cat: CatalogoProposta,
  tabela?: PadraoHonorario[] | null
): { dados: PropostaDados; avisos: string[] } {
  const avisos: string[] = [];
  if (!patch || typeof patch !== "object") return { dados: d, avisos };
  let out: PropostaDados = { ...d, cliente: { ...d.cliente }, cabecalho: { ...d.cabecalho }, condicoes: { ...d.condicoes } };

  const c = patch.cliente;
  if (c && typeof c === "object") {
    out.cliente = {
      ...out.cliente,
      ...dropUndef({
        nome: s(c.nome, 160),
        cnpj: s(c.cnpj, 20),
        tratamento: s(c.tratamento, 10),
        contato: s(c.contato, 120),
        email: s(c.email, 120),
        telefone: s(c.telefone, 30),
        situacao: s(c.situacao, 400),
        funcionarios: n(c.funcionarios, 0, 1000),
        enquadramento: ENQ.includes(c.enquadramento as Enquadramento) ? c.enquadramento : undefined,
        tipoEmpresa: TIPOS.includes(c.tipoEmpresa as TipoEmpresa) ? c.tipoEmpresa : undefined,
        complexidade: COMPS.includes(c.complexidade as Complexidade) ? c.complexidade : undefined,
      }),
    };
  }
  const h = patch.cabecalho;
  if (h && typeof h === "object") {
    out.cabecalho = {
      ...out.cabecalho,
      ...dropUndef({
        assunto: s(h.assunto, 160),
        cidade: s(h.cidade, 60),
        introducao: s(h.introducao, 800),
        validadeDias: n(h.validadeDias, 1, 365),
        data: typeof h.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.data) ? h.data : undefined,
      }),
    };
  }
  const cd = patch.condicoes;
  if (cd && typeof cd === "object") {
    out.condicoes = {
      ...out.condicoes,
      ...dropUndef({
        vencimentoDia: n(cd.vencimentoDia, 1, 31),
        formaPagamento: s(cd.formaPagamento, 80),
        chavePix: s(cd.chavePix, 120),
        funcionariosIncluidos: n(cd.funcionariosIncluidos, 0, 1000),
        valorFuncionarioExtra: n(cd.valorFuncionarioExtra),
        guiasAntecedenciaDias: n(cd.guiasAntecedenciaDias, 0, 30),
        reajuste: s(cd.reajuste, 300),
        observacoes: Array.isArray(cd.observacoes) ? cd.observacoes.map((x) => s(x, 300) || "").filter(Boolean).slice(0, 12) : undefined,
      }),
    };
  }

  for (const id of Array.isArray(patch.pacotes) ? patch.pacotes : []) {
    if (cat.pacotes.some((p) => p.id === id)) out = aplicarPacote(out, cat, id, tabela);
    else avisos.push(`Pacote desconhecido: ${String(id).slice(0, 40)}`);
  }

  for (const a of Array.isArray(patch.adicionar) ? patch.adicionar : []) {
    const cat1 = cat.itens.find((x) => x.codigo === a?.codigo);
    if (!cat1) {
      avisos.push(`Serviço fora do catálogo: ${String(a?.codigo).slice(0, 40)}`);
      continue;
    }
    const novo = itemDoCatalogo(cat1, out.cliente, tabela);
    out = { ...out, itens: [...out.itens, mesclarItem(novo, a)] };
  }

  for (const a of Array.isArray(patch.alterar) ? patch.alterar : []) {
    const k = out.itens.findIndex((i) => (a?.uid && i.uid === a.uid) || (!a?.uid && i.codigo === a?.codigo));
    if (k < 0) {
      avisos.push(`Item não encontrado para alterar: ${String(a?.codigo).slice(0, 40)}`);
      continue;
    }
    out = { ...out, itens: out.itens.map((i, j) => (j === k ? mesclarItem(i, a) : i)) };
  }

  for (const ref of Array.isArray(patch.remover) ? patch.remover : []) {
    const antes = out.itens.length;
    out = { ...out, itens: out.itens.filter((i) => i.uid !== ref && i.codigo !== ref) };
    if (out.itens.length === antes) avisos.push(`Nada a remover: ${String(ref).slice(0, 40)}`);
  }

  return { dados: reconciliar(out, cat, tabela), avisos };
}

function mesclarItem(i: ItemProposta, p: PatchItem): ItemProposta {
  const editouValor = p.valorUnit !== undefined;
  const modo = MODOS.includes(p.modo as ModoCobranca) ? (p.modo as ModoCobranca) : undefined;
  return {
    ...i,
    ...dropUndef({
      titulo: s(p.titulo, 160),
      quantidade: n(p.quantidade, 0, 1000),
      valorUnit: n(p.valorUnit),
      base: n(p.base),
      percentual: n(p.percentual, 0, 100),
      minimo: n(p.minimo),
      entradaPct: n(p.entradaPct, 0, 100),
      parcelas: n(p.parcelas, 1, 60),
      prazo: s(p.prazo, 200),
      pagamento: s(p.pagamento, 300),
      obs: Array.isArray(p.obs) ? p.obs.map((x) => s(x, 300) || "").filter(Boolean).slice(0, 8) : undefined,
      ativo: typeof p.ativo === "boolean" ? p.ativo : undefined,
      modo,
    }),
    ...(editouValor ? { manual: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Pendências
// ---------------------------------------------------------------------------
export function camposPendentesProposta(d: PropostaDados): string[] {
  const p: string[] = [];
  if (!d.cliente.nome.trim()) p.push("Nome do cliente");
  if (!d.itens.some((i) => i.ativo)) p.push("Nenhum serviço na proposta");
  for (const i of d.itens.filter((x) => x.ativo)) {
    if (i.modo === "percentual" && i.base <= 0 && !i.minimo) p.push(`Valor do débito para "${i.titulo}"`);
    if ((i.modo === "unico" || i.modo === "retroativo") && i.quantidade <= 0) p.push(`Quantidade de "${i.titulo}"`);
    if (i.modo === "mensal" && i.quantidade <= 0) p.push(`Quantidade de "${i.titulo}"`);
  }
  return p;
}

export function tituloProposta(d: PropostaDados): string {
  const nome = d.cliente.nome.trim() || "[CLIENTE]";
  const assunto = d.cabecalho.assunto.trim();
  return assunto ? `Proposta — ${nome} — ${assunto}` : `Proposta — ${nome}`;
}

/** Assunto sugerido a partir dos grupos dos itens (quando o usuário não escreveu um). */
export function assuntoSugerido(d: PropostaDados): string {
  const g = new Set(d.itens.filter((i) => i.ativo).map((i) => i.grupo));
  const partes: string[] = [];
  if (g.has("regularizacao")) partes.push(d.cliente.enquadramento === "mei" ? "regularização de MEI" : "regularização fiscal");
  if (g.has("parcelamentos")) partes.push("parcelamento de débitos");
  if (g.has("societario")) partes.push(d.itens.some((i) => i.ativo && /abertura/.test(i.codigo)) ? "abertura de empresa" : "serviços societários");
  if (g.has("mensal")) partes.push("assessoria contábil mensal");
  return partes.length ? partes.join(", ").replace(/, ([^,]*)$/, " e $1") : "serviços contábeis";
}

export function validadeAte(d: PropostaDados): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.cabecalho.data || "");
  if (!m) return "";
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  dt.setDate(dt.getDate() + Math.max(1, d.cabecalho.validadeDias || 30));
  const p = (x: number) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------
function ph(v: string, rotulo: string): string {
  const t = (v || "").trim();
  return t ? t : `[${rotulo.toUpperCase()}]`;
}

export function montarProposta(d: PropostaDados, padroes: PadroesProposta = PADROES_PROPOSTA): Bloco[] {
  const B: Bloco[] = [];
  const ativos = d.itens.filter((i) => i.ativo);
  const t = totais(d);
  const assunto = d.cabecalho.assunto.trim() || assuntoSugerido(d);

  const cidade = d.cabecalho.cidade.trim();
  B.push({ t: "data", texto: `${cidade ? `${cidade}, ` : ""}${dataExtenso(d.cabecalho.data) || "[DATA]"}.` });

  const trat = d.cliente.tratamento.trim();
  const dest = d.cliente.contato.trim() || d.cliente.nome.trim();
  const vocativo = /^sra/i.test(trat) ? "Prezada" : /^sr/i.test(trat) ? "Prezado" : "Prezado(a)";
  const contato = d.cliente.contato.trim();
  const nomeEmpresa = d.cliente.nome.trim();
  const empresaEntre = contato && nomeEmpresa && !nomeEmpresa.toLowerCase().includes(contato.toLowerCase()) ? ` (${nomeEmpresa})` : "";
  B.push({ t: "par", texto: `${vocativo} ${trat ? `${trat} ` : ""}**${ph(dest, "destinatário")}**${empresaEntre},` });

  const intro =
    d.cabecalho.introducao.trim() ||
    `É com satisfação que a **${padroes.contratada.razao}** apresenta esta proposta para **${assunto}**. Abaixo estão os serviços, os valores e as condições, item a item.`;
  B.push({ t: "par", texto: intro });
  if (d.cliente.situacao.trim()) {
    B.push({ t: "barra", rotulo: "Situação identificada.", texto: d.cliente.situacao.trim() });
  }

  // Resumo do investimento
  if (ativos.length) {
    const linhas: string[] = [];
    let valor = "";
    const partes: string[] = [];
    if (t.unico > 0) partes.push(`${brl(t.unico)} em serviços`);
    if (t.mensal > 0) partes.push(`${brl(t.mensal)} por mês`);
    valor = partes.length ? partes.join("  +  ") : "Conforme itens abaixo";
    if (t.naContratacao > 0 && t.saldos > 0) linhas.push(`Na contratação: **${brl(t.naContratacao)}** · Saldo: **${brl(t.saldos)}**`);
    if (t.repasses > 0) linhas.push(`Custos repassados (certificados e outros, sem margem): **${brl(t.repasses)}**`);
    if (t.mensal > 0) linhas.push(`Honorário mensal a partir do início dos serviços mensais, com vencimento todo dia ${d.condicoes.vencimentoDia}.`);
    B.push({ t: "destaque", titulo: "INVESTIMENTO", valor, linhas });
  }

  // Serviços
  B.push({ t: "secao", titulo: "Serviços e valores" });
  if (!ativos.length) {
    B.push({ t: "alerta", texto: "[ADICIONE OS SERVIÇOS DA PROPOSTA]" });
  } else {
    let grupoAtual: GrupoServico | null = null;
    let nSeq = 0;
    const porGrupo = ordenarPorGrupo(ativos);
    for (const i of porGrupo) {
      if (i.grupo !== grupoAtual) {
        grupoAtual = i.grupo;
        const qtd = porGrupo.filter((x) => x.grupo === i.grupo).length;
        B.push({ t: "subtitulo", titulo: GRUPO_LABEL[i.grupo], sub: `${qtd} ${qtd === 1 ? "serviço" : "serviços"}` });
      }
      nSeq += 1;
      const c = calcularItem(i, d.condicoes);
      const linhas: string[] = [];
      for (const x of i.descricao) linhas.push(`• ${x}`);
      linhas.push(`**Custo:** ${c.custo}`);
      for (const e of i.escada) linhas.push(`   ${e.rotulo}: **${brl(e.valor)}**`);
      if (c.pagamento) linhas.push(`**Forma de pagamento:** ${c.pagamento}`);
      if (i.prazo.trim()) linhas.push(`**Prazo:** ${i.prazo.trim()}`);
      for (const o of i.obs) linhas.push(o);
      B.push({ t: "kv", itens: [{ rotulo: `${nSeq}. ${i.titulo}`, linhas }] });
    }
  }

  // Condições
  const cond: string[] = [];
  const temMensal = ativos.some((i) => i.modo === "mensal");
  const temMensalCompleta = ativos.some((i) => i.codigo === "mensal_me_epp");
  const temPagamentoUnico = ativos.some((i) => i.modo === "unico" || i.modo === "percentual" || i.modo === "retroativo");
  if (temMensal) cond.push(`**Honorários mensais:** vencimento todo dia ${d.condicoes.vencimentoDia}, via ${d.condicoes.formaPagamento}.`);
  if (temMensalCompleta) {
    cond.push(
      `**Base de funcionários:** a mensalidade contempla até ${d.condicoes.funcionariosIncluidos} funcionários; a partir do ${d.condicoes.funcionariosIncluidos + 1}º, acréscimo de ${brl(d.condicoes.valorFuncionarioExtra)} por funcionário adicional.`
    );
    cond.push("**Enquadramento:** o honorário acompanha a faixa de faturamento e a complexidade da empresa, conforme a tabela vigente.");
  }
  if (temMensal && d.condicoes.guiasAntecedenciaDias > 0) {
    cond.push(`**Guias de pagamento:** enviadas por e-mail com até ${d.condicoes.guiasAntecedenciaDias} dias de antecedência ao vencimento.`);
  }
  if (temMensal && d.condicoes.reajuste.trim()) cond.push(`**Reajuste:** ${d.condicoes.reajuste.trim()}`);
  if (temPagamentoUnico && d.condicoes.chavePix.trim()) cond.push(`**Pagamentos pontuais via PIX:** chave ${d.condicoes.chavePix.trim()}.`);
  if (ativos.some((i) => i.grupo === "parcelamentos" || i.grupo === "regularizacao")) {
    cond.push(
      "**Autorizações e documentos:** para atuar junto aos órgãos precisaremos de procuração eletrônica (e-CAC) ou do certificado digital, e dos documentos e informações solicitados, em até 5 dias úteis após o aceite."
    );
    cond.push("**Valores devidos aos órgãos:** tributos, multas, juros e parcelas são pagos pelo cliente diretamente ao órgão e não integram os honorários desta proposta.");
  }
  if (ativos.some((i) => i.modo === "repasse" || i.modo === "sob_consulta")) {
    cond.push("**Custos de terceiros:** certificados digitais e taxas oficiais são repassados pelo valor cobrado, sem acréscimo.");
  }
  for (const o of d.condicoes.observacoes) cond.push(o);
  if (cond.length) {
    B.push({ t: "secao", titulo: "Condições" });
    B.push({ t: "lista", itens: cond });
  }

  // Aceite
  const ate = validadeAte(d);
  B.push({ t: "secao", titulo: "Aceite da proposta" });
  B.push({
    t: "alerta",
    rotulo: "Validade.",
    texto: `Esta proposta é válida por **${d.cabecalho.validadeDias} dias**${ate ? `, até **${fmtData(ate)}**` : ""}. Para aceitar, basta responder confirmando ou assinar abaixo; iniciamos assim que recebermos o aceite${temPagamentoUnico ? " e o pagamento da primeira etapa" : ""}.`,
  });
  B.push({ t: "par", texto: "Estamos à disposição para qualquer dúvida e será um prazer trabalhar com você e sua empresa." });
  B.push({
    t: "assinaturas",
    itens: [
      { rotulo: "CONTRATADA", nome: `**${padroes.contratada.razao}**`, linhas: [d.assinatura.nome.trim() ? `${d.assinatura.nome}${d.assinatura.cargo ? ` — ${d.assinatura.cargo}` : ""}` : "", padroes.contratada.cnpj ? `CNPJ ${padroes.contratada.cnpj}` : ""].filter(Boolean) },
      { rotulo: "DE ACORDO", nome: `**${ph(d.cliente.nome, "cliente")}**`, linhas: [d.cliente.cnpj.trim() ? `CNPJ/CPF ${d.cliente.cnpj.trim()}` : "", "Data: ____/____/______"].filter(Boolean) },
    ],
  });
  return B;
}

function ordenarPorGrupo(its: ItemProposta[]): ItemProposta[] {
  const ordem: GrupoServico[] = ["regularizacao", "parcelamentos", "societario", "mensal", "avulso"];
  return [...its].sort((a, b) => ordem.indexOf(a.grupo) - ordem.indexOf(b.grupo));
}

export function metaPropostaPdf(d: PropostaDados, padroes: PadroesProposta = PADROES_PROPOSTA) {
  return {
    titulo: tituloProposta(d),
    faixa: { titulo: "PROPOSTA", subtitulo: "SERVIÇOS CONTÁBEIS E REGULARIZAÇÃO", assunto: "Proposta comercial de serviços contábeis" },
    rodapeEsquerda: [padroes.contratada.razao, `CNPJ ${padroes.contratada.cnpj}`, padroes.contratada.endereco].filter(Boolean),
    rodapeDireita: [d.assinatura.nome, d.assinatura.cargo].filter(Boolean),
  };
}

/** Texto plano da proposta, para colar em e-mail ou WhatsApp. */
export function resumoWhatsapp(d: PropostaDados): string {
  const t = totais(d);
  const linhas = [`*Proposta Nescon Contabilidade*`, `Para: ${d.cliente.nome || "—"}`, ""];
  for (const i of d.itens.filter((x) => x.ativo)) {
    const c = calcularItem(i, d.condicoes);
    const v = c.mensal != null ? `${brl(c.mensal)}/mês` : c.total != null ? brl(c.total) : "sob consulta";
    linhas.push(`• ${i.titulo}: ${v}`);
  }
  linhas.push("");
  if (t.unico > 0) linhas.push(`Serviços: ${brl(t.unico)}`);
  if (t.repasses > 0) linhas.push(`Custos repassados: ${brl(t.repasses)}`);
  if (t.mensal > 0) linhas.push(`Mensalidade: ${brl(t.mensal)}`);
  const ate = validadeAte(d);
  if (ate) linhas.push(`Válida até ${fmtData(ate)}.`);
  return linhas.join("\n");
}

/** Versão enxuta do catálogo que vai ao assistente (só o que ele precisa para escolher). */
export function catalogoParaAssistente(cat: CatalogoProposta) {
  return {
    itens: cat.itens
      .filter((i) => i.habilitado)
      .map((i) => ({ codigo: i.codigo, titulo: i.titulo, grupo: i.grupo, unidade: i.unidade, modo: i.modo, valorUnit: i.valorUnit })),
    pacotes: cat.pacotes
      .filter((p) => p.habilitado)
      .map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, itens: p.itens.map((x) => x.codigo), perguntas: p.perguntas })),
  };
}

/** Estado atual, enxuto, para o assistente saber o que já foi preenchido. */
export function estadoParaAssistente(d: PropostaDados) {
  return {
    cliente: d.cliente,
    cabecalho: { assunto: d.cabecalho.assunto, validadeDias: d.cabecalho.validadeDias },
    condicoes: { vencimentoDia: d.condicoes.vencimentoDia, funcionariosIncluidos: d.condicoes.funcionariosIncluidos, valorFuncionarioExtra: d.condicoes.valorFuncionarioExtra },
    pacotes: d.pacotes,
    itens: d.itens.map((i) => ({
      uid: i.uid,
      codigo: i.codigo,
      titulo: i.titulo,
      modo: i.modo,
      quantidade: i.quantidade,
      valorUnit: i.valorUnit,
      base: i.base,
      percentual: i.percentual,
      entradaPct: i.entradaPct,
      ativo: i.ativo,
    })),
    pendencias: camposPendentesProposta(d),
  };
}
