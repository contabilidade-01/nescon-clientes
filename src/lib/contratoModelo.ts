/**
 * Modelo do contrato de prestação de serviços contábeis.
 *
 * O formulário da tela preenche `ContratoDados`; `montarContrato` transforma isso numa
 * lista de blocos (resumo, cláusulas, caixas de destaque, assinaturas…). A prévia HTML
 * (ContratoPreview) e o PDF (generateContratoPdf) desenham a MESMA lista — o texto do
 * contrato vive só aqui.
 *
 * Marcação dentro dos textos: `**negrito**` e `[CAMPO A PREENCHER]` (fica destacado em
 * amarelo na prévia e no PDF, para o campo vazio nunca passar despercebido).
 */

export type ContratoDados = {
  contratante: {
    razao: string;
    tipoSocietario: string;
    cnpj: string;
    nire: string;
    endereco: string;
    email: string;
    telefone: string;
    repNome: string;
    repQualificacao: string;
    repCpf: string;
    repEndereco: string;
    repPoderes: string;
  };
  contratada: {
    razao: string;
    cnpj: string;
    endereco: string;
    crcOrg: string;
    email: string;
    telefone: string;
    repNome: string;
    repCargo: string;
    respTecnico: string;
    crcRt: string;
  };
  objeto: {
    /** Qual texto de contrato usar: completo (ME/EPP) ou simplificado para MEI. */
    modelo: ModeloContrato;
    enquadramento: Enquadramento;
    tipoEmpresa: TipoEmpresa;
    complexidade: Complexidade;
    regimeTributario: string;
    funcionariosIncluidos: number;
    /** Áreas contratadas. O cliente pode fechar só uma parte (ex.: só fiscal). */
    areaContabil: boolean;
    areaFiscal: boolean;
    areaPessoal: boolean;
    balancetes: "mensal" | "trimestral" | "semestral";
  };
  prazos: {
    diaVariaveisFolha: string;
    horarioAtendimento: string;
    diasGuias: number;
    /** Documentos financeiros do mês: até N dias corridos após o fim do mês. */
    diaDocsFinanceiros: number;
    /** Resposta às solicitações do cliente: até N dias úteis. */
    prazoRespostaDiasUteis: number;
    /** Entrega de livros/arquivos no encerramento: até N dias úteis. */
    transicaoDiasUteis: number;
    /** Balanço e demonstrações anuais: até N dias após receber os dados. */
    balancoDias: number;
  };
  honorarios: {
    valorMensal: number;
    vencimentoDia: number;
    faturamentoLimite: number;
    valorFuncAdicional: number;
    decimoTerceiro: boolean;
    /** Vencimentos das duas parcelas do 13º honorário (dia/mês). */
    decimoParcela1: string;
    decimoParcela2: string;
    competenciaReferencia: "corrente" | "seguinte";
    primeiraCobranca: string;
    meioPagamento: string;
    multaPct: number;
    jurosPct: number;
    /** Cobrança extra por competência escriturada em atraso (% da mensalidade). 0 = por orçamento. */
    retroativoPct: number;
    /** Atraso (dias) a partir do qual a competência vira retroativo. */
    retroativoDias: number;
    /** Inadimplência: prazo (dias) da notificação para regularizar antes de suspender. */
    inadimplenciaDias: number;
    /** A partir do 2º recálculo da mesma guia, valor cobrado por guia. */
    recalculoGuiaValor: number;
    /** Faturamento acima do limite: acréscimo (R$) a cada `faixaPasso` (R$) excedentes. */
    faixaAdicionalValor: number;
    faixaPasso: number;
    /** Índice do reajuste anual automático (ex.: "IPCA (IBGE)"). */
    reajusteIndice: string;
  };
  vigencia: {
    dataInicio: string;
    avisoPrevioDias: number;
    foro: string;
    /** Justa causa: prazo (dias corridos) para corrigir a falha notificada. */
    correcaoDias: number;
    /** Multa por dispensar o aviso prévio: limite em mensalidades. */
    multaAvisoMensalidades: number;
    /** Multa por infração que cause a rescisão, em mensalidades. */
    multaInfracaoMensalidades: number;
  };
  assinatura: {
    cidade: string;
    data: string;
    testemunha1Nome: string;
    testemunha1Cpf: string;
    testemunha2Nome: string;
    testemunha2Cpf: string;
  };
};

export type Bloco =
  | { t: "resumo"; itens: Array<{ titulo: string; texto: string }> }
  | { t: "secao"; titulo: string }
  | { t: "subtitulo"; titulo: string; sub: string }
  | { t: "parte"; rotulo: string; texto: string }
  | { t: "clausula"; num: string; texto: string }
  | { t: "par"; texto: string }
  | { t: "barra"; rotulo: string; texto: string }
  | { t: "cartoes"; colunas: Array<{ titulo: string; itens: string[] }> }
  | { t: "lista"; rotulos?: string[]; itens: string[] }
  | { t: "alerta"; rotulo?: string; texto: string }
  | { t: "destaque"; titulo: string; valor: string; linhas: string[] }
  | { t: "passos"; itens: Array<{ titulo: string; texto: string }> }
  | { t: "legenda"; texto: string }
  | { t: "escudo"; blocos: Array<{ titulo: string; texto: string }> }
  | { t: "data"; texto: string }
  | { t: "assinaturas"; itens: Array<{ rotulo: string; nome: string; linhas: string[] }> }
  | { t: "quebra" }
  | { t: "kv"; itens: Array<{ rotulo: string; linhas: string[] }> };

/** Subconjunto de dados (padrões do escritório, cadastro prévio da empresa). */
export type ContratoParcial = { [K in keyof ContratoDados]?: Partial<ContratoDados[K]> };

export type ContratoCadastroResumo = {
  company_id: string;
  company_name: string;
  cnpj: string;
  tem_cadastro: boolean;
  completo: boolean;
  updated_at: string | null;
};

export type ContratoStatus = "rascunho" | "salvo" | "enviado" | "assinado";

export type ContratoSigner = {
  token?: string;
  nome: string;
  email?: string;
  telefone?: string;
  qualificacao?: string;
  status?: string;
  sign_url?: string;
  signed_at?: string | null;
};

export type ContratoResumo = {
  id: string;
  company_id: string | null;
  company_name: string | null;
  titulo: string;
  /** 'aditivo' = alteração de um contrato já assinado (`contrato_pai_id`). */
  tipo: "contrato" | "aditivo";
  contrato_pai_id: string | null;
  aditivo_numero: number | null;
  status: ContratoStatus;
  tem_pdf: boolean;
  tem_pdf_assinado: boolean;
  zapsign_token: string | null;
  zapsign_enviado_em: string | null;
  assinado_em: string | null;
  created_at: string;
  updated_at: string;
};

export type ContratoDetalhe = ContratoResumo & {
  /** ContratoDados (contrato) ou AditivoDados (aditivo): quem lê normaliza conforme `tipo`. */
  dados: unknown;
  deliverable_id: string | null;
  signed_deliverable_id: string | null;
  zapsign_signers: ContratoSigner[] | null;
  zapsign_status?: string;
};

export const CONTRATADA_PADRAO: ContratoDados["contratada"] = {
  razao: "NESCON SERVICOS EMPRESARIAIS LTDA",
  cnpj: "35.736.034/0001-23",
  endereco: "",
  crcOrg: "",
  email: "",
  telefone: "",
  repNome: "",
  repCargo: "",
  respTecnico: "JEANDSON NASCIMENTO SANTOS",
  crcRt: "CRC 1SP322779",
};

/**
 * Contrato novo nasce em branco: só as regras-padrão do escritório (dia 15, aviso de 60
 * dias, multa 2% + juros 1%, guias 5 dias antes) e a identificação da própria NESCON.
 * Valor, faturamento, datas e dados do cliente ficam vazios e aparecem em amarelo.
 */
export function dadosPadrao(): ContratoDados {
  return {
    contratante: {
      razao: "",
      tipoSocietario: "",
      cnpj: "",
      nire: "",
      endereco: "",
      email: "",
      telefone: "",
      repNome: "",
      repQualificacao: "",
      repCpf: "",
      repEndereco: "",
      repPoderes: "",
    },
    contratada: { ...CONTRATADA_PADRAO },
    objeto: {
      modelo: "completo",
      enquadramento: "simples",
      tipoEmpresa: "servico",
      complexidade: "baixa",
      regimeTributario: "",
      funcionariosIncluidos: 3,
      areaContabil: true,
      areaFiscal: true,
      areaPessoal: true,
      balancetes: "semestral",
    },
    prazos: {
      diaVariaveisFolha: "",
      horarioAtendimento: "",
      diasGuias: 5,
      diaDocsFinanceiros: 5,
      prazoRespostaDiasUteis: 1,
      transicaoDiasUteis: 10,
      balancoDias: 30,
    },
    honorarios: {
      valorMensal: 0,
      vencimentoDia: 15,
      faturamentoLimite: 0,
      valorFuncAdicional: 0,
      decimoTerceiro: true,
      decimoParcela1: "25/11",
      decimoParcela2: "18/12",
      competenciaReferencia: "corrente",
      primeiraCobranca: "",
      meioPagamento: "",
      multaPct: 2,
      jurosPct: 1,
      retroativoPct: 50,
      retroativoDias: 90,
      inadimplenciaDias: 10,
      recalculoGuiaValor: 15,
      faixaAdicionalValor: 100,
      faixaPasso: 50000,
      reajusteIndice: "IPCA (IBGE)",
    },
    vigencia: { dataInicio: "", avisoPrevioDias: 60, foro: "", correcaoDias: 10, multaAvisoMensalidades: 2, multaInfracaoMensalidades: 1 },
    assinatura: {
      cidade: "",
      data: "",
      testemunha1Nome: "",
      testemunha1Cpf: "",
      testemunha2Nome: "",
      testemunha2Cpf: "",
    },
  };
}

/**
 * Mescla seção a seção: `extra` sobrescreve só as chaves que trouxer. Usado para
 * aplicar os padrões do escritório e o cadastro prévio da empresa a um contrato novo.
 * Texto vazio e número inválido em `extra` não apagam o que já havia.
 */
export function mesclarDados(base: ContratoDados, extra?: ContratoParcial | null): ContratoDados {
  if (!extra || typeof extra !== "object") return base;
  const out = { ...base };
  for (const k of Object.keys(base) as Array<keyof ContratoDados>) {
    const patch = extra[k];
    if (!patch || typeof patch !== "object") continue;
    const limpo: Record<string, unknown> = {};
    for (const [campo, valor] of Object.entries(patch)) {
      if (valor === undefined || valor === null) continue;
      if (typeof valor === "string" && valor.trim() === "") continue;
      if (typeof valor === "number" && !Number.isFinite(valor)) continue;
      limpo[campo] = valor;
    }
    out[k] = { ...base[k], ...limpo } as never;
  }
  return out;
}

/** Cadastro prévio completo = dá para gerar o contrato sem campo em amarelo nas partes. */
export function cadastroCompleto(c: ContratoParcial | null | undefined): boolean {
  const ct = c?.contratante;
  return Boolean(ct?.razao?.trim() && ct?.cnpj?.trim() && ct?.endereco?.trim() && ct?.repNome?.trim() && ct?.repCpf?.trim());
}

/** Garante todas as chaves (dados antigos gravados antes de um campo novo existir). */
export function normalizarDados(raw: unknown): ContratoDados {
  const base = dadosPadrao();
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown>>;
  const secoes = Object.keys(base) as Array<keyof ContratoDados>;
  const out = { ...base };
  for (const s of secoes) {
    out[s] = { ...base[s], ...(o[s] && typeof o[s] === "object" ? o[s] : {}) } as never;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

export function brl(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  // Espaço comum (não o U+00A0 do toLocaleString): comparável em testes e igual no PDF.
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
}

const UN = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CEN = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CEN[c]);
  if (r < 20) {
    if (r) partes.push(UN[r]);
  } else {
    const d = Math.floor(r / 10);
    const u = r % 10;
    partes.push(u ? `${DEZ[d]} e ${UN[u]}` : DEZ[d]);
  }
  return partes.join(" e ");
}

/** "R$ 1.450,00" → "mil, quatrocentos e cinquenta reais". Até 999 milhões. */
export function valorExtenso(valor: number): string {
  const total = Math.round((Number.isFinite(valor) ? valor : 0) * 100);
  const inteiro = Math.floor(total / 100);
  const cent = total % 100;
  const milhoes = Math.floor(inteiro / 1_000_000);
  const milhares = Math.floor((inteiro % 1_000_000) / 1000);
  const resto = inteiro % 1000;
  const grupos: string[] = [];
  if (milhoes) grupos.push(milhoes === 1 ? "um milhão" : `${ate999(milhoes)} milhões`);
  if (milhares) grupos.push(milhares === 1 ? "mil" : `${ate999(milhares)} mil`);
  let texto = "";
  if (grupos.length) {
    texto = grupos.join(" e ");
    if (resto) texto += resto < 100 || resto % 100 === 0 ? ` e ${ate999(resto)}` : `, ${ate999(resto)}`;
  } else {
    texto = ate999(resto);
  }
  let reais = "";
  if (inteiro === 0) reais = "";
  else if (inteiro === 1) reais = "um real";
  else reais = `${texto} reais`;
  if (!cent) return reais || "zero reais";
  const centavos = cent === 1 ? "um centavo" : `${ate999(cent)} centavos`;
  return reais ? `${reais} e ${centavos}` : centavos;
}

export function moedaExtenso(n: number): string {
  return `${brl(n)} (${valorExtenso(n)})`;
}

/** Valor ainda não definido (0) vira [CAMPO] destacado em vez de "R$ 0,00". */
function moedaPh(n: number, rotulo: string, extenso = false): string {
  if (!n) return `[${rotulo.toUpperCase()}]`;
  return extenso ? moedaExtenso(n) : brl(n);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function fmtData(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export function mesAno(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso || "");
  return m ? `${MESES[Number(m[2]) - 1]} de ${m[1]}` : "";
}

export function dataExtenso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : "";
}

function ph(v: string | number | null | undefined, rotulo: string): string {
  const s = v == null ? "" : String(v).trim();
  return s ? s : `[${rotulo.toUpperCase()}]`;
}

/** Trecho opcional: entra só se houver valor (nada de colchete no texto corrido). */
function opc(v: string | null | undefined, antes: string, depois = ""): string {
  const t = (v || "").trim();
  return t ? `${antes}${t}${depois}` : "";
}

function ou(v: string | null | undefined, generico: string): string {
  const t = (v || "").trim();
  return t ? t : generico;
}

function vazio(v: string | number | null | undefined): boolean {
  return v == null || String(v).trim() === "";
}

function plural(n: number, s: string, p: string): string {
  return n === 1 ? s : p;
}

function diaOrd(n: number): string {
  return `${n}º`;
}

// ---------------------------------------------------------------------------
// Montagem do contrato
// ---------------------------------------------------------------------------

export function tituloContrato(d: ContratoDados): string {
  const nome = d.contratante.razao.trim() || "[CONTRATANTE]";
  return `Contrato de prestação de serviços contábeis${d.objeto.modelo === "mei" ? " (MEI)" : ""} — ${nome}`;
}

/** Campos vazios que vão aparecer como [CAMPO] no contrato. */
export function camposPendentes(d: ContratoDados): string[] {
  const lista: Array<[boolean, string]> = [
    [vazio(d.contratante.razao), "Razão social da contratante"],
    [vazio(d.contratante.cnpj), "CNPJ da contratante"],
    [vazio(d.contratante.endereco), "Endereço da contratante"],
    [vazio(d.contratante.repNome), "Representante da contratante"],
    [vazio(d.contratante.repCpf), "CPF do representante"],
    [vazio(d.contratada.endereco), "Endereço da contratada"],
    [!d.honorarios.valorMensal, "Honorário mensal"],
    [!d.honorarios.faturamentoLimite, "Limite de faturamento"],
    [!d.honorarios.valorFuncAdicional, "Valor por empregado adicional"],
    [vazio(d.vigencia.dataInicio), "Data de início"],
    [vazio(d.vigencia.foro), "Foro"],
  ];
  return lista.filter(([v]) => v).map(([, r]) => r);
}

/** Nomes das áreas contratadas / não contratadas, para o texto corrido. */
export function areasContratadas(o: ContratoDados["objeto"]): { dentro: string[]; fora: string[] } {
  const todas: Array<[boolean, string]> = [
    [o.areaContabil, "contábil"],
    [o.areaFiscal, "fiscal"],
    [o.areaPessoal, "de departamento pessoal"],
  ];
  return { dentro: todas.filter(([v]) => v).map(([, n]) => n), fora: todas.filter(([v]) => !v).map(([, n]) => n) };
}

function listaE(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

export function montarContrato(d: ContratoDados): Bloco[] {
  if (d.objeto.modelo === "mei") return montarContratoMei(d);
  const B: Bloco[] = [];
  const h = d.honorarios;
  const o = d.objeto;
  const v = d.vigencia;
  const p = d.prazos;
  const ct = d.contratante;
  const cd = d.contratada;
  const funcs = Math.max(0, Math.floor(o.funcionariosIncluidos || 0));
  const areas = areasContratadas(o);
  const inicio = fmtData(v.dataInicio) || "[DATA DE INÍCIO]";
  const foro = ph(v.foro, "comarca do foro");
  const balancetesTxt =
    o.balancetes === "mensal"
      ? "Balancetes **mensais**, até o dia 20 do mês seguinte"
      : o.balancetes === "trimestral"
        ? "Balancetes **trimestrais**, até o dia 20 do mês seguinte ao trimestre"
        : "Balancetes **semestrais**, até o dia 20 do segundo mês seguinte ao semestre";

  // ---- Resumo ----
  B.push({
    t: "resumo",
    itens: [
      {
        titulo: "Serviços",
        texto: areas.fora.length ? `Serviços da área ${listaE(areas.dentro)} (Cláusula 1); as demais áreas ficam fora do contrato.` : "Contabilidade, fiscal e departamento pessoal em pacote único (Cláusula 1).",
      },
      {
        titulo: "Honorários",
        texto: `${moedaPh(h.valorMensal, "valor mensal")} por mês, vencimento dia ${h.vencimentoDia}, em pacote único (Cláusula 5).`,
      },
      {
        titulo: "Vigência",
        texto: `Início em ${inicio}, por prazo indeterminado. Qualquer parte encerra com aviso prévio escrito de ${v.avisoPrevioDias} dias (Cláusula 6).`,
      },
      {
        titulo: "Segurança",
        texto: "Contabilidade especializada, com responsável técnico registrado no CRC, prazos legais garantidos, sigilo e proteção de dados (Cláusulas 3 e 7).",
      },
    ],
  });

  // ---- Partes ----
  B.push({ t: "secao", titulo: "DAS PARTES" });
  B.push({ t: "subtitulo", titulo: "CONTRATANTE", sub: "empresa cliente" });
  B.push({
    t: "parte",
    rotulo: "EMPRESA",
    texto:
      `**${ph(ct.razao, "razão social da contratante")}**${opc(ct.tipoSocietario, ", ")}, CNPJ nº ${ph(ct.cnpj, "cnpj")}` +
      opc(ct.nire, ", NIRE ") +
      `, com sede na ${ph(ct.endereco, "endereço completo da contratante")}` +
      opc(ct.email, ", e-mail ") +
      opc(ct.telefone, ", telefone ") +
      `, representada por **${ph(ct.repNome, "nome do representante")}**${opc(ct.repQualificacao, ", ")}, CPF nº ${ph(ct.repCpf, "cpf do representante")}` +
      opc(ct.repEndereco, ", residente na ") +
      `, ${ou(ct.repPoderes, "com poderes de representação na forma de seus atos constitutivos")}, doravante **CONTRATANTE**.`,
  });
  B.push({ t: "subtitulo", titulo: "CONTRATADA", sub: "contabilidade" });
  B.push({
    t: "parte",
    rotulo: "CONTÁBIL",
    texto:
      `**${ph(cd.razao, "razão social da contratada")}**, CNPJ nº ${ph(cd.cnpj, "cnpj da contratada")}, com sede na ${ph(cd.endereco, "endereço completo da contratada")}` +
      opc(cd.crcOrg, ", organização contábil registrada no CRC sob nº ") +
      opc(cd.email, ", e-mail ") +
      opc(cd.telefone, ", telefone ") +
      (cd.repNome.trim()
        ? `, representada por **${cd.repNome.trim()}**${opc(cd.repCargo, ", ")}, tendo como responsável técnico o contador **${ph(cd.respTecnico, "responsável técnico")}**, ${ph(cd.crcRt, "crc do responsável técnico")}`
        : `, representada por seu responsável técnico, o contador **${ph(cd.respTecnico, "responsável técnico")}**, ${ph(cd.crcRt, "crc do responsável técnico")}`) +
      `, doravante **CONTRATADA**.`,
  });
  B.push({
    t: "par",
    texto:
      "As partes celebram este contrato de prestação de serviços contábeis, regido pelo Código Civil e pelas normas do Conselho Federal de Contabilidade. Ele organiza a parceria com regras claras para os dois lados: o que a **CONTRATADA** garante e o que a **CONTRATANTE** precisa fazer para que tudo funcione em dia.",
  });

  // ---- Cláusula 1 ----
  B.push({ t: "secao", titulo: "CLÁUSULA 1  ·  OBJETO" });
  B.push({
    t: "clausula",
    num: "1.",
    texto: `A **CONTRATADA** prestará à **CONTRATANTE**, de forma continuada, os serviços ${areas.fora.length ? `da área ${listaE(areas.dentro)}` : "contábeis, fiscais e de departamento pessoal"} abaixo, conforme ${o.regimeTributario.trim() ? `o regime tributário vigente (${o.regimeTributario.trim()})` : "o regime tributário em que a **CONTRATANTE** estiver enquadrada"}, as operações efetivamente realizadas e as obrigações legais aplicáveis a cada competência.`,
  });
  const cartoesAreas: Array<{ titulo: string; itens: string[] }> = [
      {
        titulo: "CONTÁBIL",
        itens: [
          "**Escrituração** contábil conforme as Normas Brasileiras de Contabilidade, com conciliações a partir dos documentos recebidos.",
          "**Balancetes**, Balanço Patrimonial, DRE e demais demonstrações obrigatórias.",
          "**ECD e ECF**, quando exigíveis.",
        ],
      },
      {
        titulo: "FISCAL",
        itens: [
          "**Apuração** dos tributos, emissão das guias e orientação sobre a legislação federal, estadual e municipal.",
          "**Escrituração** fiscal e entrega das declarações aplicáveis (PGDAS-D, DEFIS, EFD, EFD-Reinf, DCTFWeb e obrigações estaduais e municipais).",
          "**Atendimento** a intimações e fiscalizações de rotina das competências contratadas.",
        ],
      },
      {
        titulo: "DEPARTAMENTO PESSOAL",
        itens: [
          "**Admissões**, alterações e desligamentos; folha de salários e pró-labore; férias, 13º salário e rescisões.",
          "**Guias** de FGTS e INSS e obrigações do eSocial, FGTS Digital, EFD-Reinf e DCTFWeb.",
          `**Orientação** sobre CLT, previdência e convenção coletiva. Até ${funcs} ${plural(funcs, "empregado incluído", "empregados incluídos")} (Cláusula 5.2).`,
        ],
      },
  ];
  B.push({
    t: "cartoes",
    colunas: cartoesAreas.filter((c) => (c.titulo === "CONTÁBIL" ? o.areaContabil : c.titulo === "FISCAL" ? o.areaFiscal : o.areaPessoal)),
  });
  if (areas.fora.length) {
    B.push({
      t: "alerta",
      rotulo: "ÁREAS NÃO CONTRATADAS.",
      texto: `Este contrato abrange apenas a área ${listaE(areas.dentro)}. As obrigações da área ${listaE(areas.fora)} e as demais obrigações legais a ela ligadas ficam **fora do objeto e da responsabilidade da CONTRATADA**, permanecendo a cargo da **CONTRATANTE**. Para incluí-las no pacote de serviços, basta entrar em contato com a **CONTRATADA**, que apresenta a proposta e formaliza por aditivo.`,
    });
  }
  B.push({
    t: "barra",
    rotulo: "1.1. NÃO INCLUÍDOS.",
    texto:
      "Custos e honorários de abertura, alteração ou encerramento de empresas, certidões, autenticação de livros, imposto de renda dos sócios, regularização de períodos anteriores, defesas administrativas complexas, perícias e demandas judiciais, laudos e programas de saúde e segurança do trabalho (a cargo de profissional habilitado contratado pela **CONTRATANTE**), controle de jornada, recrutamento, auditoria e gestão financeira. Quando solicitados, serão orçados e cobrados à parte (Cláusula 5.5).",
  });
  B.push({
    t: "barra",
    rotulo: "1.2. NATUREZA DOS SERVIÇOS.",
    texto:
      "A **CONTRATADA** atua com diligência técnica e cumpre as obrigações legais, sem garantir resultado de fiscalização, deferimento de pedidos ou economia tributária. A escrituração não é auditoria de todos os documentos, mas a **CONTRATADA** examinará inconsistências perceptíveis, pedirá esclarecimentos e recusará atos ilícitos. Não lhe cabe pagar tributos, salários ou encargos com recursos próprios.",
  });

  // ---- Cláusula 2 ----
  B.push({ t: "secao", titulo: "CLÁUSULA 2  ·  ROTINA DE DOCUMENTOS E PRAZOS" });
  B.push({
    t: "clausula",
    num: "2.",
    texto:
      "A rotina abaixo existe para que a **CONTRATANTE** nunca pague multa por atraso: recebendo a documentação nestes prazos, a **CONTRATADA** garante a entrega de todas as obrigações no prazo legal. A **CONTRATANTE** envia documentos completos, legíveis e organizados, de preferência pelo Portal do Cliente ou por meio digital, guardando os originais.",
  });
  B.push({
    t: "lista",
    rotulos: ["FINANCEIRO", "NOTAS FISCAIS", "FOLHA", "GUIAS", "RELATÓRIOS"],
    itens: [
      `Fluxo de caixa, extratos de todas as contas e aplicações, movimento de cartões, comprovantes de pagamentos e recebimentos e contratos de crédito: **até ${p.diaDocsFinanceiros} dias corridos após o fim do mês**.`,
      "Notas fiscais de entrada e saída, com XML, cancelamentos e devoluções: **semanalmente**; as da última semana, até o **3º dia útil do mês seguinte**.",
      `Jornada, faltas, comissões, afastamentos e demais variáveis da folha: **até o dia ${ou(p.diaVariaveisFolha, "2")} de cada mês**, porque a folha é paga até o 5º dia útil. Admissões: comunicadas antes de o empregado começar a trabalhar, para o registro no prazo legal. Férias e desligamentos: assim que decididos, com antecedência para os prazos legais.`,
      `Recebidos os dados no prazo, a **CONTRATADA** envia as guias **prioritariamente por e-mail**, ao endereço cadastrado, **${p.diasGuias} dias corridos antes do vencimento**, com cópia no Portal do Cliente. A **CONTRATANTE** mantém esse e-mail ativo e o acompanha, inclusive a pasta de spam: o envio ao e-mail cadastrado vale como entrega. Se a informação ou a liberação oficial ocorrer depois, a **CONTRATADA** avisa e envia a guia assim que possível.`,
      `${balancetesTxt}; balanço e demonstrações anuais em **até ${p.balancoDias} dias** após o recebimento de todos os dados, em especial o inventário anual e a Carta de Responsabilidade da Administração.`,
    ],
  });
  B.push({
    t: "alerta",
    texto:
      "Os prazos legais não dependem das partes. Por isso, se a documentação chegar atrasada ou incompleta, a **CONTRATADA** avisa a pendência e o risco por escrito, e a responsabilidade por eventual atraso fica com quem lhe deu causa. Retrabalho por informações alteradas depois de processadas é orçado antes de ser feito, salvo erro da **CONTRATADA**.",
  });
  B.push({
    t: "barra",
    rotulo: "2.1. RETROATIVO.",
    texto:
      `A mensalidade remunera a escrituração feita mês a mês. Se a documentação de uma competência não for enviada nos prazos acima, a **CONTRATADA** avisará a pendência e, enquanto ela durar, não responderá pelas obrigações daquela competência. Documentação entregue **com mais de ${h.retroativoDias} dias de atraso** será escriturada como serviço retroativo, cobrado à parte: ${h.retroativoPct > 0 ? `**${h.retroativoPct}% da mensalidade vigente por competência** escriturada em atraso` : "**conforme orçamento prévio** por competência escriturada em atraso"}, além da mensalidade normal, ficando multas e juros do período por conta da **CONTRATANTE**.`,
  });
  B.push({
    t: "alerta",
    rotulo: "2.2. RECÁLCULO DE GUIAS.",
    texto: `Cada guia é enviada uma vez, no prazo, e, se vencer sem pagamento, **um recálculo** é feito como cortesia. A partir do **segundo recálculo da mesma guia**, cobra-se **${brl(h.recalculoGuiaValor)} por guia** recalculada, lançado na mensalidade seguinte. Multa e juros do atraso são da **CONTRATANTE**.`,
  });
  B.push({
    t: "barra",
    rotulo: "2.3. ACESSOS.",
    texto:
      "Procurações, certificados digitais e acessos a sistemas públicos serão válidos e limitados ao necessário, preferencialmente por delegação, sem compartilhamento de senhas pessoais. A **CONTRATANTE** manterá os acessos ativos e informará de imediato intimações, revogações, alterações cadastrais e mensagens de órgãos públicos.",
  });

  // ---- Cláusula 3 ----
  B.push({ t: "secao", titulo: "CLÁUSULA 3  ·  COMPROMISSOS DA CONTRATADA" });
  B.push({ t: "legenda", texto: "O QUE A CONTRATADA GARANTE" });
  B.push({
    t: "cartoes",
    colunas: [
      { titulo: "CONTABILIDADE ESPECIALIZADA", itens: ["**Equipe especializada** no porte e no regime da empresa, sob responsável técnico registrado no CRC.", "**Legislação acompanhada** todos os dias: mudanças tributárias, trabalhistas e previdenciárias aplicadas na rotina sem custo extra.", "**Orientação preventiva** para a empresa pagar só o que é devido e evitar autuações."] },
      { titulo: "PRAZOS EM DIA", itens: [`**Guias por e-mail** ${p.diasGuias} dias antes do vencimento e obrigações transmitidas no prazo legal, com comprovante guardado.`, `**Resposta** às solicitações em até ${p.prazoRespostaDiasUteis} ${plural(p.prazoRespostaDiasUteis, "dia útil", "dias úteis")}, por e-mail, telefone ou WhatsApp.`, "**Portal do Cliente** com cópia de guias, folha e documentos 24 horas e aviso a cada novo documento."] },
      { titulo: "SIGILO E CONTINUIDADE", itens: ["**Documentos e dados** guardados com controle de acesso, backup e sigilo, inclusive após o término.", `**Sem fidelidade**: encerramento com aviso de ${v.avisoPrevioDias} dias e entrega organizada de tudo ao novo contador em até ${p.transicaoDiasUteis} dias úteis.`, `**Preço previsível**: reajuste uma vez por ano, pelo ${ou(h.reajusteIndice, "IPCA (IBGE)")}, sem surpresas.`] },
    ],
  });
  B.push({ t: "clausula", num: "3.", texto: "Para cumprir essas garantias, a **CONTRATADA** se compromete a:" });
  B.push({
    t: "lista",
    itens: [
      "Executar os serviços com zelo, diligência e independência, observando a legislação e o Código de Ética Profissional do Contador (NBC PG 01), por profissionais habilitados sob a supervisão do responsável técnico.",
      "Transmitir todas as obrigações contratadas no prazo legal sempre que receber a documentação nos prazos da Cláusula 2, guardando os comprovantes de entrega e mantendo-os acessíveis à **CONTRATANTE**.",
      `Atender a **CONTRATANTE** por e-mail, telefone ou WhatsApp, em dias úteis, ${ou(p.horarioAtendimento, "em horário comercial")}, respondendo em até ${p.prazoRespostaDiasUteis} ${plural(p.prazoRespostaDiasUteis, "dia útil", "dias úteis")}, registrando por escrito as orientações relevantes e avisando de imediato riscos, pendências e inconsistências.`,
      "Guardar os documentos e arquivos sob sua responsabilidade com controle de acesso e backup, respondendo por perda, extravio ou mau uso que lhe sejam imputáveis.",
      "Arcar com suas despesas operacionais e com os encargos de seus empregados e prepostos, sem qualquer vínculo empregatício com a **CONTRATANTE**.",
      "Não cobrar nada além do previsto neste contrato sem aprovação prévia e escrita da **CONTRATANTE**, exceto o acréscimo por empregado adicional da Cláusula 5.2.",
    ],
  });
  B.push({
    t: "barra",
    rotulo: "3.1. RESPONSABILIDADE.",
    texto:
      "A **CONTRATADA** assume as multas e acréscimos causados por erro técnico, imperfeição ou atraso que lhe sejam imputáveis, apurados conforme os documentos recebidos, e faz sem custo a defesa administrativa cabível. Ficam fora dessa garantia o principal dos tributos e encargos devidos pela **CONTRATANTE**, os juros e a correção que seriam devidos de qualquer forma e as consequências de documentos falsos ou incompletos ou de conduta da **CONTRATANTE** contrária à lei ou à orientação técnica escrita. Caso fortuito e força maior excluem a responsabilidade apenas na extensão de seus efeitos comprovados.",
  });

  // ---- Cláusula 4 ----
  B.push({ t: "secao", titulo: "CLÁUSULA 4  ·  COMPROMISSOS DA CONTRATANTE" });
  B.push({ t: "clausula", num: "4.", texto: "Para que as garantias da Cláusula 3 funcionem, a **CONTRATANTE** se compromete a:" });
  B.push({
    t: "lista",
    itens: [
      "Enviar documentos e informações nos prazos da Cláusula 2 e informar o faturamento real de cada competência.",
      "Manter controles internos adequados; emitir e corrigir suas notas fiscais; controlar caixa, bancos, estoque e jornada; realizar o inventário físico anual.",
      "Acompanhar o e-mail cadastrado, por onde chegam as guias, pagar tributos, salários e encargos nos vencimentos e avisar de imediato se alguma guia não chegar.",
      "Seguir as orientações técnicas escritas da **CONTRATADA**, que existem para evitar multas e autuações; o que for feito contra orientação escrita fica por conta da **CONTRATANTE**.",
      "Entregar, antes do fechamento de cada exercício, a Carta de Responsabilidade da Administração assinada por representante habilitado.",
      "Manter atualizados contrato social, dados dos administradores e beneficiários finais, procurações e acessos.",
    ],
  });
  B.push({
    t: "barra",
    rotulo: "4.1. DECLARAÇÕES.",
    texto:
      "A **CONTRATANTE** declara que não realizará operações ilegais; que os documentos enviados são idôneos; que responde integralmente pelo conteúdo dos dados e arquivos encaminhados; e que não tem conhecimento de fatos que afetem as demonstrações contábeis ou a continuidade da empresa, obrigando-se a informá-los de imediato.",
  });

  // ---- Cláusula 5 ----
  B.push({ t: "secao", titulo: "CLÁUSULA 5  ·  HONORÁRIOS E PAGAMENTO" });
  B.push({ t: "clausula", num: "5.", texto: "Pelos serviços da Cláusula 1, a **CONTRATANTE** pagará à **CONTRATADA**:" });
  B.push({
    t: "destaque",
    titulo: "HONORÁRIOS MENSAIS",
    valor: moedaPh(h.valorMensal, "valor mensal", true),
    linhas: [
      `Vencimento todo dia ${h.vencimentoDia}. ${areas.fora.length ? `Abrange a área ${listaE(areas.dentro)}` : "Pacote único (contábil, fiscal e pessoal)"} para faturamento mensal de até ${moedaPh(h.faturamentoLimite, "limite de faturamento")}${o.areaPessoal ? ` e até ${funcs} ${plural(funcs, "empregado registrado", "empregados registrados")}` : ""}.`,
    ],
  });
  B.push({
    t: "barra",
    rotulo: "5.1. COBRANÇA.",
    texto: `A mensalidade vencida no dia ${h.vencimentoDia} refere-se à competência do ${h.competenciaReferencia === "seguinte" ? "mês anterior (mês vencido)" : "próprio mês"}, com primeira competência em ${mesAno(v.dataInicio) || "[MÊS/ANO]"}${h.primeiraCobranca ? ` e primeira cobrança em ${fmtData(h.primeiraCobranca)}` : ""}.`,
  });
  if (o.areaPessoal) B.push({
    t: "barra",
    rotulo: "5.2. EMPREGADOS ADICIONAIS.",
    texto: `A partir do ${diaOrd(funcs + 1)} empregado registrado, acrescem-se **${moedaPh(h.valorFuncAdicional, "valor por empregado adicional", true)}** por empregado por mês, conforme os vínculos ativos na competência, demonstrados na cobrança. Substituição no mesmo posto não gera cobrança dupla, e pró-labore não conta como empregado.`,
  });
  let n = o.areaPessoal ? 3 : 2;
  if (h.decimoTerceiro) {
    B.push({
      t: "barra",
      rotulo: `5.${n}. 13º HONORÁRIO.`,
      texto: `Os honorários mensais remuneram toda a rotina das Cláusulas 1 e 3 ao longo do ano: 12 folhas de pagamento, ${o.enquadramento === "simples" || o.enquadramento === "mei" ? "12 apurações e declarações mensais do Simples Nacional (PGDAS-D)" : "12 apurações e declarações mensais dos tributos"}, de janeiro a dezembro, e a escrituração contábil e fiscal de cada competência. No fim de cada ano e no início do seguinte, porém, o governo impõe declarações e obrigações anuais que fogem da rotina mensal: balanço e demonstrações do exercício, ${o.enquadramento === "simples" || o.enquadramento === "mei" ? "DEFIS (declaração anual do Simples)" : "ECD e ECF"}, informes de rendimentos e demais obrigações de fechamento e abertura do ano. Daí surge a remuneração por esses serviços, o **13º honorário**, fixo e igual ao valor-base da mensalidade (${moedaPh(h.valorMensal, "valor mensal")}, atualizado pelos reajustes), com ou sem empregados, pago em **duas parcelas iguais, com vencimentos em ${ph(h.decimoParcela1, "dia/mês")} e ${ph(h.decimoParcela2, "dia/mês")}**.`,
    });
    n++;
  }
  B.push({
    t: "barra",
    rotulo: `5.${n}. FATURAMENTO ACIMA DA FAIXA.`,
    texto: h.faixaAdicionalValor > 0 && h.faixaPasso > 0
      ? `Na competência em que o faturamento mensal ultrapassar ${moedaPh(h.faturamentoLimite, "limite de faturamento")}, acrescem-se **${brl(h.faixaAdicionalValor)} à mensalidade a cada ${brl(h.faixaPasso)}, ou fração, de faturamento excedente**, apurado pelo faturamento escriturado da própria competência e demonstrado na cobrança. Mudança relevante de porte, de atividade ou de escopo poderá ser objeto de aditivo.`
      : `Ultrapassado o faturamento mensal de ${moedaPh(h.faturamentoLimite, "limite de faturamento")}, as partes negociarão por escrito novo preço e eventual ajuste de escopo. Não há aumento automático.`,
  });
  n++;
  B.push({
    t: "barra",
    rotulo: `5.${n}. SERVIÇOS EXTRAS E REEMBOLSOS.`,
    texto:
      "Serviços não incluídos (Cláusula 1.1), a escrituração retroativa (Cláusula 2.1) e os recálculos de guias (Cláusula 2.2) serão cobrados conforme este contrato ou orçamento aprovado por escrito. Custas, taxas públicas, emolumentos, registros, livros e certificados serão reembolsados mediante autorização prévia e comprovante. As despesas operacionais ordinárias da **CONTRATADA** já integram os honorários.",
  });
  n++;
  B.push({
    t: "barra",
    rotulo: `5.${n}. REAJUSTE.`,
    texto:
      `Os honorários são reajustados automaticamente a cada 12 meses, contados do início da vigência, pela variação acumulada do **${ou(h.reajusteIndice, "IPCA (IBGE)")}** no período ou, na sua extinção, pelo índice oficial que o substituir, sem necessidade de aviso ou aditivo. Aumento material de volume ou complexidade dos serviços poderá justificar aditivo; simples alteração legislativa não gera acréscimo.`,
  });
  n++;
  B.push({
    t: "alerta",
    rotulo: `5.${n}. ATRASO.`,
    texto: `Honorários pagos após o vencimento sofrem **multa de ${h.multaPct}%** e **juros simples de ${h.jurosPct}% ao mês**, proporcionais aos dias de atraso. Nenhuma medida é tomada sem aviso: persistindo a inadimplência, a **CONTRATADA** notifica a **CONTRATANTE** para regularizar em ${h.inadimplenciaDias} dias e só depois pode suspender os serviços ou rescindir o contrato, indicando data, pendências e consequências. Livros, documentos e arquivos da **CONTRATANTE** nunca são retidos para forçar o pagamento.`,
  });

  // ---- Cláusula 6 ----
  B.push({ t: "secao", titulo: "CLÁUSULA 6  ·  VIGÊNCIA E ENCERRAMENTO" });
  B.push({
    t: "clausula",
    num: "6.",
    texto: "Este contrato vigora por prazo indeterminado, com início dos serviços e da responsabilidade técnica em:",
  });
  B.push({
    t: "destaque",
    titulo: "DATA DE INÍCIO",
    valor: inicio,
    linhas: [
      `Primeira competência: ${mesAno(v.dataInicio) || "[MÊS/ANO]"}. A assinatura ocorre na data efetiva, sem antedatação, e ratifica as rotinas já executadas desde o início.`,
    ],
  });
  B.push({
    t: "barra",
    rotulo: "6.1. AVISO PRÉVIO.",
    texto: `Não há fidelidade mínima: qualquer parte pode encerrar o contrato, sem justificativa, por aviso escrito com **${v.avisoPrevioDias} dias** de antecedência, contados do recebimento comprovado. Durante o aviso, serviços e honorários continuam normalmente, para que a transição seja organizada.`,
  });
  B.push({ t: "legenda", texto: "COMO FUNCIONA O ENCERRAMENTO" });
  B.push({
    t: "passos",
    itens: [
      { titulo: "AVISO PRÉVIO", texto: `Comunicação por escrito, com ${v.avisoPrevioDias} dias de antecedência.` },
      { titulo: "DISTRATO E ACERTO FINAL", texto: "Competências, pendências, valores e obrigações remanescentes." },
      { titulo: "ENTREGA DOS DOCUMENTOS", texto: `Livros, arquivos e declarações ao cliente ou ao novo contador, em até ${p.transicaoDiasUteis} dias úteis.` },
    ],
  });
  B.push({
    t: "barra",
    rotulo: "6.2. DISPENSA DO AVISO.",
    texto: `Quem dispensar o aviso, total ou parcialmente, sem acordo ou justa causa, pagará multa compensatória proporcional aos dias suprimidos, limitada a ${v.multaAvisoMensalidades} ${plural(v.multaAvisoMensalidades, "mensalidade", "mensalidades")} (mensalidade vigente × ${v.multaAvisoMensalidades} × dias não cumpridos ÷ ${v.avisoPrevioDias}). A multa substitui os honorários do período sem serviços. A **CONTRATANTE** pode pedir encerramento imediato pagando a mensalidade integral do mês em curso, além da multa deste item.`,
  });
  B.push({
    t: "barra",
    rotulo: "6.3. JUSTA CAUSA.",
    texto:
      `Descumprimento relevante permite notificação com prazo de ${v.correcaoDias} dias corridos para correção (ou menor, se necessário para evitar perda de prazo legal); persistindo a falha, cabe rescisão por justa causa. Fraude, ilicitude ou quebra grave de sigilo autorizam a resolução imediata e motivada. A infração que causar a rescisão sujeita a parte culpada à multa de ${v.multaInfracaoMensalidades} ${plural(v.multaInfracaoMensalidades, "mensalidade vigente", "mensalidades vigentes")}, não cumulativa com a multa do item 6.2 pelo mesmo fato, sem prejuízo de indenização por prejuízo comprovado.`,
  });
  B.push({
    t: "barra",
    rotulo: "6.4. TRANSIÇÃO.",
    texto:
      `A **CONTRATANTE** nunca fica desassistida: encerrado o contrato, a **CONTRATADA** conclui as demonstrações e obrigações acessórias das competências sob sua responsabilidade, ainda que vençam depois do término, salvo divisão expressa no distrato, e entrega, mediante protocolo, livros, documentos, arquivos eletrônicos e declarações em até ${p.transicaoDiasUteis} dias úteis do término ou da indicação do novo contador. A entrega não depende de quitação nem da assinatura do distrato. Sistemas, licenças e métodos próprios da **CONTRATADA** não são transferidos; procurações e acessos são revogados após as obrigações remanescentes.`,
  });
  B.push({
    t: "barra",
    rotulo: "6.5. INSOLVÊNCIA.",
    texto:
      "Falência, recuperação judicial ou extrajudicial, dissolução ou insolvência de qualquer das partes serão tratadas conforme a lei, sem rescisão automática; trabalhos especiais desses procedimentos exigem orçamento próprio.",
  });

  // ---- Cláusula 7 ----
  B.push({ t: "secao", titulo: "CLÁUSULA 7  ·  SIGILO, PROTEÇÃO DE DADOS E PREVENÇÃO À LAVAGEM DE DINHEIRO" });
  B.push({
    t: "escudo",
    blocos: [
      {
        titulo: "7.1. SIGILO",
        texto:
          "Tudo o que a **CONTRATADA** recebe da **CONTRATANTE** é tratado como confidencial, inclusive após o término do contrato: documentos, números, dados de empregados e informações do negócio. O acesso é limitado à equipe que precisa dele, com registro de quem acessa. A divulgação só ocorre por dever legal, ordem de autoridade, exercício regular de direito ou autorização escrita.",
      },
      {
        titulo: "7.2. PROTEÇÃO DE DADOS (LGPD)",
        texto:
          "O tratamento de dados pessoais segue a **Lei nº 13.709/2018**. Ao tratar dados em nome da **CONTRATANTE**, a **CONTRATADA** atua como operadora, segundo instruções documentadas; nos deveres legais próprios, como controladora. A **CONTRATADA** mantém controles de acesso, backup e medidas técnicas e administrativas de segurança, comunica incidentes sem demora e, ao término, devolve ou elimina os dados, ressalvada a guarda exigida por lei.",
      },
      {
        titulo: "7.3. PREVENÇÃO À LAVAGEM DE DINHEIRO",
        texto:
          "A **CONTRATANTE** declara ciência da **Lei nº 9.613/1998** e da **Resolução CFC nº 1.721/2024** e fornecerá dados de identificação, beneficiários finais e origem das operações. A **CONTRATADA** cumprirá os deveres de prevenção e de comunicação ao Coaf quando aplicáveis, independentemente de autorização ou aviso.",
      },
    ],
  });

  // ---- Cláusula 8 ----
  B.push({ t: "secao", titulo: "CLÁUSULA 8  ·  DISPOSIÇÕES GERAIS E FORO" });
  B.push({
    t: "barra",
    rotulo: "8.1. ALTERAÇÕES.",
    texto:
      "Mudanças de preço, escopo ou condições só valem por aditivo escrito, inclusive por assinatura eletrônica. Comunicações operacionais podem ocorrer pelos canais de contato indicados na identificação das partes. Silêncio não é aprovação, e acordo verbal não altera este contrato.",
  });
  let g = 2;
  B.push({
    t: "barra",
    rotulo: `8.${g}. TOLERÂNCIA E CESSÃO.`,
    texto:
      "Tolerância ou atraso em exigir uma obrigação não implica renúncia. Cláusula inválida não prejudica as demais. A cessão do contrato exige consentimento escrito da outra parte; a **CONTRATADA** pode contar com apoio técnico de terceiros, sob sua responsabilidade e sigilo.",
  });
  g++;
  B.push({
    t: "barra",
    rotulo: `8.${g}. PODERES.`,
    texto:
      "Os signatários declaram ter poderes para este contrato. O representante da **CONTRATANTE** assina exclusivamente em nome dela, sem garantia pessoal. Alterações posteriores de poderes serão comunicadas por escrito.",
  });
  g++;
  B.push({
    t: "barra",
    rotulo: `8.${g}. FORÇA MAIOR.`,
    texto:
      "Caso fortuito, força maior e indisponibilidade de sistemas públicos serão comunicados e documentados, sem afastar os deveres que possam ser cumpridos por meio alternativo razoável.",
  });
  g++;
  B.push({
    t: "barra",
    rotulo: `8.${g}. FORO.`,
    texto: `As partes buscarão solução amigável. Para as questões decorrentes deste contrato, fica eleito o **foro da Comarca de ${foro}**.`,
  });

  // ---- Assinaturas ----
  B.push({ t: "secao", titulo: "ASSIM," });
  B.push({
    t: "par",
    texto:
      "para firmeza e como prova de haverem contratado, firmam este documento em duas vias de igual teor ou por assinatura eletrônica válida (art. 784, § 4º, do Código de Processo Civil), na presença das testemunhas abaixo.",
  });
  B.push({
    t: "data",
    texto: `${ou(d.assinatura.cidade, ou(v.foro, "[CIDADE/UF]"))}, ${d.assinatura.data ? dataExtenso(d.assinatura.data) : "_____ de ______________ de ______"}.`,
  });
  B.push({
    t: "assinaturas",
    itens: [
      {
        rotulo: "CONTRATANTE",
        nome: ph(ct.razao, "razão social da contratante"),
        linhas: [ph(ct.repNome, "representante"), ct.repPoderes.toLowerCase().includes("administr") ? "Administrador(a)" : "Representante legal"],
      },
      {
        rotulo: "CONTRATADA",
        nome: ph(cd.razao, "razão social da contratada"),
        linhas: cd.repNome.trim()
          ? [cd.repNome.trim(), `Resp. técnico: ${ph(cd.respTecnico, "responsável técnico")} · ${ph(cd.crcRt, "crc")}`]
          : [`${ph(cd.respTecnico, "responsável técnico")} · ${ph(cd.crcRt, "crc")}`, "Responsável técnico e representante"],
      },
      { rotulo: "TESTEMUNHA 1", nome: ou(d.assinatura.testemunha1Nome, "Nome: ______________________________"), linhas: [`CPF: ${ou(d.assinatura.testemunha1Cpf, "_____________________")}`] },
      { rotulo: "TESTEMUNHA 2", nome: ou(d.assinatura.testemunha2Nome, "Nome: ______________________________"), linhas: [`CPF: ${ou(d.assinatura.testemunha2Cpf, "_____________________")}`] },
    ],
  });

  return B;
}


// ---------------------------------------------------------------------------
// Tabela de referência de honorários (sugestão; o valor do contrato é sempre editável)
// ---------------------------------------------------------------------------
export type Enquadramento = "mei" | "simples" | "presumido" | "real";
export type TipoEmpresa = "servico" | "comercio" | "industria";
export type Complexidade = "baixa" | "media" | "alta";
export type ModeloContrato = "completo" | "mei";

export const ENQUADRAMENTO_LABEL: Record<Enquadramento, string> = {
  mei: "MEI",
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
};
export const TIPO_LABEL: Record<TipoEmpresa, string> = { servico: "Serviços", comercio: "Comércio", industria: "Indústria" };
export const COMPLEXIDADE_LABEL: Record<Complexidade, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };
export const MODELO_LABEL: Record<ModeloContrato, string> = {
  completo: "Completo (ME/EPP e demais)",
  mei: "Simplificado para MEI",
};

/**
 * Faixas do escritório: serviços de R$ 280 (simples) a R$ 350 (complexa); comércio de
 * R$ 350 a R$ 550. Indústria segue a faixa do comércio até existir tabela própria. MEI
 * sem faixa fixa: o valor é definido no contrato.
 */
export const TABELA_BASE: Record<TipoEmpresa, Record<Complexidade, number>> = {
  servico: { baixa: 280, media: 315, alta: 350 },
  comercio: { baixa: 350, media: 450, alta: 550 },
  industria: { baixa: 350, media: 450, alta: 550 },
};

export type PadraoHonorario = {
  enquadramento: string;
  tipo_empresa: string;
  complexidade: string;
  valor_a_partir_centavos: number | null;
};

/** Valor sugerido: primeiro a tabela cadastrada no portal (Atualização de Honorários), senão a faixa fixa. */
export function valorSugerido(
  enq: Enquadramento,
  tipo: TipoEmpresa,
  comp: Complexidade,
  padroes?: PadraoHonorario[] | null
): { valor: number; origem: "tabela" | "faixa" | "nenhum" } {
  const p = (padroes || []).find(
    (x) => x.enquadramento === enq && x.tipo_empresa === tipo && x.complexidade === comp && x.valor_a_partir_centavos
  );
  if (p && p.valor_a_partir_centavos) return { valor: p.valor_a_partir_centavos / 100, origem: "tabela" };
  if (enq === "mei") return { valor: 0, origem: "nenhum" };
  return { valor: TABELA_BASE[tipo][comp], origem: "faixa" };
}

export function faixaTexto(tipo: TipoEmpresa): string {
  const f = TABELA_BASE[tipo];
  return `${brl(f.baixa)} a ${brl(f.alta)}`;
}

// ---------------------------------------------------------------------------
// Modelo simplificado para MEI
// ---------------------------------------------------------------------------
function montarContratoMei(d: ContratoDados): Bloco[] {
  const B: Bloco[] = [];
  const h = d.honorarios;
  const v = d.vigencia;
  const p = d.prazos;
  const ct = d.contratante;
  const cd = d.contratada;
  const inicio = fmtData(v.dataInicio) || "[DATA DE INÍCIO]";
  const foro = ph(v.foro, "comarca do foro");
  const funcs = Math.max(0, Math.floor(d.objeto.funcionariosIncluidos || 0));

  B.push({
    t: "resumo",
    itens: [
      { titulo: "Serviços", texto: "Rotina do MEI: DAS mensal, declaração anual, orientação e apoio na emissão de notas (Cláusula 1)." },
      { titulo: "Honorários", texto: `${moedaPh(h.valorMensal, "valor mensal")} por mês, vencimento dia ${h.vencimentoDia} (Cláusula 4).` },
      { titulo: "Vigência", texto: `Início em ${inicio}, por prazo indeterminado. Encerramento com aviso prévio de ${v.avisoPrevioDias} dias (Cláusula 5).` },
      { titulo: "Segurança", texto: "Contabilidade especializada em MEI, com responsável técnico registrado no CRC, prazos garantidos e sigilo (Cláusulas 3 e 6)." },
    ],
  });

  B.push({ t: "secao", titulo: "DAS PARTES" });
  B.push({ t: "subtitulo", titulo: "CONTRATANTE", sub: "microempreendedor(a) individual" });
  B.push({
    t: "parte",
    rotulo: "MEI",
    texto:
      `**${ph(ct.razao, "nome empresarial do mei")}**, microempreendedor(a) individual, CNPJ nº ${ph(ct.cnpj, "cnpj")}` +
      `, com sede na ${ph(ct.endereco, "endereço completo")}` +
      opc(ct.email, ", e-mail ") +
      opc(ct.telefone, ", telefone ") +
      `, representado(a) por seu(sua) titular **${ph(ct.repNome, "nome do titular")}**${opc(ct.repQualificacao, ", ")}, CPF nº ${ph(ct.repCpf, "cpf do titular")}` +
      opc(ct.repEndereco, ", residente na ") +
      `, doravante **CONTRATANTE**.`,
  });
  B.push({ t: "subtitulo", titulo: "CONTRATADA", sub: "contabilidade" });
  B.push({
    t: "parte",
    rotulo: "CONTÁBIL",
    texto:
      `**${ph(cd.razao, "razão social da contratada")}**, CNPJ nº ${ph(cd.cnpj, "cnpj da contratada")}, com sede na ${ph(cd.endereco, "endereço completo da contratada")}` +
      opc(cd.crcOrg, ", organização contábil registrada no CRC sob nº ") +
      opc(cd.email, ", e-mail ") +
      (cd.repNome.trim()
        ? `, representada por **${cd.repNome.trim()}**${opc(cd.repCargo, ", ")}, responsável técnico o contador **${ph(cd.respTecnico, "responsável técnico")}**, ${ph(cd.crcRt, "crc")}`
        : `, representada por seu responsável técnico, o contador **${ph(cd.respTecnico, "responsável técnico")}**, ${ph(cd.crcRt, "crc")}`) +
      `, doravante **CONTRATADA**.`,
  });
  B.push({ t: "par", texto: "As partes celebram este contrato de prestação de serviços contábeis para microempreendedor individual, regido pelo Código Civil, pelas normas do Conselho Federal de Contabilidade e pelas cláusulas a seguir." });

  B.push({ t: "secao", titulo: "CLÁUSULA 1  ·  SERVIÇOS" });
  B.push({ t: "clausula", num: "1.", texto: "A **CONTRATADA** prestará à **CONTRATANTE**, de forma continuada, a rotina contábil e fiscal do MEI:" });
  B.push({
    t: "cartoes",
    colunas: [
      { titulo: "FISCAL", itens: ["**DAS** mensal: emissão e envio da guia por e-mail ou WhatsApp.", "**Receitas**: relatório mensal de receitas brutas e controle do limite anual do MEI.", "**Orientação** sobre emissão de notas fiscais e sobre as obrigações do enquadramento."] },
      { titulo: "DECLARAÇÕES", itens: ["**DASN-SIMEI**: declaração anual do MEI dentro do prazo.", "**Cadastro**: atualizações simples no Portal do Empreendedor (endereço, atividade, contato).", "**Avisos** de prazos e de mudanças de regras que afetem o MEI."] },
      { titulo: "PESSOAL", itens: [`**Empregado** do MEI (até ${Math.max(1, funcs)}): admissão, folha, férias, 13º, rescisão e eSocial.`, "**Guias** de FGTS e INSS do empregado, quando houver.", "**Orientação** trabalhista básica."] },
    ],
  });
  B.push({
    t: "barra",
    rotulo: "1.1. NÃO INCLUÍDOS.",
    texto: "Desenquadramento ou migração para ME, alteração de atividade ou de endereço que exija processo na Junta, certidões, parcelamentos, defesas e regularização de períodos anteriores ao contrato, declaração de imposto de renda da pessoa física do titular e escrituração contábil completa (balanço). Quando solicitados, serão orçados e cobrados à parte.",
  });

  B.push({ t: "secao", titulo: "CLÁUSULA 2  ·  DOCUMENTOS E PRAZOS" });
  B.push({
    t: "lista",
    rotulos: ["RECEITAS", "GUIAS", "EMPREGADO", "RETROATIVO"],
    itens: [
      `Notas fiscais emitidas e recebidas, vendas sem nota e extratos do mês: **até ${p.diaDocsFinanceiros} dias após o fim do mês**, por e-mail, WhatsApp ou pelo Portal do Cliente.`,
      `O DAS e as demais guias são enviados **prioritariamente por e-mail**, ao endereço cadastrado, **${p.diasGuias} dias antes do vencimento**, com cópia no Portal do Cliente. A **CONTRATANTE** acompanha esse e-mail (inclusive a pasta de spam), paga no prazo e avisa se alguma guia não chegar.`,
      `Variáveis do empregado (faltas, horas, afastamentos): até o dia ${ou(p.diaVariaveisFolha, "2")} de cada mês. Admissão: comunicada antes de o empregado começar a trabalhar.`,
      `Documentação com mais de ${h.retroativoDias} dias de atraso será escriturada como retroativo, cobrado à parte ${h.retroativoPct > 0 ? `(${h.retroativoPct}% da mensalidade por competência em atraso)` : "conforme orçamento"}, sem prejuízo das multas e juros por conta da **CONTRATANTE**.`,
    ],
  });
  B.push({
    t: "alerta",
    rotulo: "2.1. RECÁLCULO DE GUIAS.",
    texto: `A guia do mês e **um recálculo** por guia vencida são enviados sem custo. A partir do **segundo recálculo da mesma guia**, cobra-se **${brl(h.recalculoGuiaValor)} por guia**, junto com a mensalidade seguinte. Multa e juros do atraso são sempre da **CONTRATANTE**.`,
  });

  B.push({ t: "secao", titulo: "CLÁUSULA 3  ·  COMPROMISSOS DAS PARTES" });
  B.push({ t: "clausula", num: "3.", texto: "A **CONTRATADA** garante à **CONTRATANTE**:" });
  B.push({
    t: "lista",
    itens: [
      "**Prazos em dia**: DAS, declaração anual e obrigações do empregado transmitidos no prazo legal sempre que as informações cheguem nos prazos da Cláusula 2, com comprovante guardado e acessível no Portal do Cliente.",
      `**Atendimento próximo**: resposta em até ${p.prazoRespostaDiasUteis} ${plural(p.prazoRespostaDiasUteis, "dia útil", "dias úteis")}, por e-mail, telefone ou WhatsApp, em dias úteis, ${ou(p.horarioAtendimento, "em horário comercial")}, com aviso imediato de riscos, pendências e mudanças de regra.`,
      "**Contabilidade especializada** em MEI: equipe que acompanha a legislação do enquadramento todos os dias, sob responsável técnico registrado no CRC, com orientação preventiva para evitar desenquadramento e autuações.",
      "**Responsabilidade**: as multas causadas por erro ou atraso da **CONTRATADA** são assumidas por ela. Ficam fora o principal dos tributos e as consequências de informações incompletas ou falsas.",
      "**Sigilo e cuidado**: serviços executados por profissionais habilitados, com observância do Código de Ética Profissional do Contador, e documentos guardados com controle de acesso e backup.",
    ],
  });
  B.push({ t: "clausula", num: "3.1.", texto: "Para que essas garantias funcionem, a **CONTRATANTE** se compromete a:" });
  B.push({
    t: "lista",
    itens: [
      "Informar todas as receitas do mês, com ou sem nota, e guardar os documentos por 5 anos.",
      "Pagar o DAS e as demais guias no vencimento e comunicar de imediato qualquer intimação ou mensagem de órgão público.",
      "Avisar antes de contratar empregado, mudar de atividade ou de endereço, ou se o faturamento se aproximar do limite anual do MEI.",
      "Manter atualizados os dados cadastrais e os acessos (Portal do Empreendedor, gov.br) necessários aos serviços.",
    ],
  });

  B.push({ t: "secao", titulo: "CLÁUSULA 4  ·  HONORÁRIOS" });
  B.push({
    t: "destaque",
    titulo: "HONORÁRIOS MENSAIS",
    valor: moedaPh(h.valorMensal, "valor mensal", true),
    linhas: [
      `Vencimento todo dia ${h.vencimentoDia}, por ${ou(h.meioPagamento, "boleto bancário ou Pix")}, com nota fiscal. Inclui a rotina da Cláusula 1${funcs > 0 ? ` e até ${funcs} empregado${funcs > 1 ? "s" : ""}` : ""}.`,
    ],
  });
  if (h.decimoTerceiro) {
    B.push({
      t: "barra",
      rotulo: "4.1. 13º HONORÁRIO.",
      texto: `A mensalidade remunera a rotina da Cláusula 1 ao longo do ano: 12 DAS, 12 relatórios de receitas e, havendo empregado, 12 folhas, de janeiro a dezembro. No fim de cada ano e no início do seguinte, porém, o governo impõe obrigações anuais que fogem da rotina mensal (DASN-SIMEI, 13º salário e informes do empregado, fechamento e abertura do ano). Daí surge a remuneração por esses serviços, o **13º honorário**, fixo e igual ao valor-base da mensalidade (${moedaPh(h.valorMensal, "valor mensal")}), com ou sem empregado, pago em **duas parcelas iguais, com vencimentos em ${ph(h.decimoParcela1, "dia/mês")} e ${ph(h.decimoParcela2, "dia/mês")}**.`,
    });
  }
  B.push({
    t: "barra",
    rotulo: `4.${h.decimoTerceiro ? 2 : 1}. REAJUSTE E ATRASO.`,
    texto: `Reajuste automático a cada 12 meses de contrato, pela variação do ${ou(h.reajusteIndice, "IPCA (IBGE)")} ou do índice oficial que o substituir. Honorário pago após o vencimento sofre multa de ${h.multaPct}% e juros de ${h.jurosPct}% ao mês. Persistindo o atraso, a **CONTRATADA** avisa por escrito e dá ${h.inadimplenciaDias} dias para regularizar; só depois pode suspender os serviços, sem reter documentos da **CONTRATANTE**.`,
  });
  B.push({
    t: "barra",
    rotulo: `4.${h.decimoTerceiro ? 3 : 2}. SERVIÇOS EXTRAS.`,
    texto: "Serviços não incluídos (Cláusula 1.1), retroativos (Cláusula 2) e recálculos (Cláusula 2.1) são cobrados à parte, conforme este contrato ou orçamento aprovado por escrito. Taxas públicas e certificados são reembolsados mediante comprovante.",
  });

  B.push({ t: "secao", titulo: "CLÁUSULA 5  ·  VIGÊNCIA E ENCERRAMENTO" });
  B.push({ t: "destaque", titulo: "DATA DE INÍCIO", valor: inicio, linhas: [`Primeira competência: ${mesAno(v.dataInicio) || "[MÊS/ANO]"}. Prazo indeterminado.`] });
  B.push({
    t: "barra",
    rotulo: "5.1. AVISO PRÉVIO.",
    texto: `Não há fidelidade mínima: qualquer parte pode encerrar com aviso escrito de **${v.avisoPrevioDias} dias**. Durante o aviso os serviços e a mensalidade continuam, para a transição ser organizada. Quem dispensar o aviso sem acordo paga multa de uma mensalidade.`,
  });
  B.push({
    t: "barra",
    rotulo: "5.2. ENCERRAMENTO.",
    texto: `A **CONTRATANTE** nunca fica desassistida: no encerramento, a **CONTRATADA** entrega as declarações, as guias das competências já pagas e os arquivos do MEI em até ${p.transicaoDiasUteis} dias úteis, sem condicionar a entrega a quitação. Descumprimento grave, fraude ou quebra de sigilo autorizam rescisão imediata e motivada.`,
  });

  B.push({ t: "secao", titulo: "CLÁUSULA 6  ·  SIGILO, DADOS E FORO" });
  B.push({
    t: "escudo",
    blocos: [
      { titulo: "6.1. SIGILO E LGPD", texto: "As partes guardam sigilo sobre documentos e informações, inclusive após o término. O tratamento de dados pessoais segue a **Lei nº 13.709/2018**; a **CONTRATADA** atua como operadora nos dados tratados em nome da **CONTRATANTE** e comunica incidentes sem demora." },
      { titulo: "6.2. PREVENÇÃO À LAVAGEM DE DINHEIRO", texto: "A **CONTRATANTE** declara ciência da **Lei nº 9.613/1998** e da **Resolução CFC nº 1.721/2024** e informará a origem de suas operações quando solicitado." },
      { titulo: "6.3. FORO", texto: `Alterações só por aditivo escrito. As partes buscarão solução amigável; fica eleito o **foro da Comarca de ${foro}**.` },
    ],
  });

  B.push({ t: "secao", titulo: "ASSIM," });
  B.push({ t: "par", texto: "para firmeza e como prova de haverem contratado, firmam este documento em duas vias ou por assinatura eletrônica válida (art. 784, § 4º, do Código de Processo Civil)." });
  B.push({ t: "data", texto: `${ou(d.assinatura.cidade, ou(v.foro, "[CIDADE/UF]"))}, ${d.assinatura.data ? dataExtenso(d.assinatura.data) : "_____ de ______________ de ______"}.` });
  B.push({
    t: "assinaturas",
    itens: [
      { rotulo: "CONTRATANTE", nome: ph(ct.razao, "nome empresarial do mei"), linhas: [ph(ct.repNome, "titular"), "Titular"] },
      {
        rotulo: "CONTRATADA",
        nome: ph(cd.razao, "razão social da contratada"),
        linhas: cd.repNome.trim() ? [cd.repNome.trim(), `Resp. técnico: ${ph(cd.respTecnico, "responsável técnico")} · ${ph(cd.crcRt, "crc")}`] : [`${ph(cd.respTecnico, "responsável técnico")} · ${ph(cd.crcRt, "crc")}`, "Responsável técnico e representante"],
      },
      { rotulo: "TESTEMUNHA 1", nome: ou(d.assinatura.testemunha1Nome, "Nome: ______________________________"), linhas: [`CPF: ${ou(d.assinatura.testemunha1Cpf, "_____________________")}`] },
      { rotulo: "TESTEMUNHA 2", nome: ou(d.assinatura.testemunha2Nome, "Nome: ______________________________"), linhas: [`CPF: ${ou(d.assinatura.testemunha2Cpf, "_____________________")}`] },
    ],
  });
  return B;
}

/** Texto plano de um bloco (para busca e testes). */
export function textoPlano(texto: string): string {
  return texto.replace(/\*\*/g, "");
}
