/**
 * Regras puras do onboarding: qual modelo serve para um contrato e como transformar o
 * modelo em itens com data. Sem banco, sem rede — é o que os testes exercitam.
 *
 * Bloco do modelo (campo `tipo`):
 *   boas_vindas      texto de abertura
 *   etapa            passo a seguir (sem arquivo)
 *   documento        o cliente envia arquivo; tem prazo
 *   prazo_recorrente regra mensal (ex.: "variáveis da folha até o dia X")
 *   contato          quem atende e como
 *   marco            "primeira vitória" (ex.: primeiro balancete)
 *
 * Todo bloco aceita `condicao` ({areas, enquadramento, tipoEmpresa, comFuncionarios}) —
 * mesma forma de `regras` do modelo — para aparecer só em alguns contratos.
 *
 * Prazo de `documento`/`marco`: { ref: 'assinatura' | 'inicio', dias: N, uteis?: bool }
 *   assinatura = data em que o contrato foi assinado
 *   inicio     = vigencia.dataInicio do contrato (cliente que começa só depois da assinatura
 *                recebe o prazo contado do início real, não da assinatura)
 *
 * Textos aceitam {{secao.campo}} do contrato, ex.: "até o dia {{prazos.diaVariaveisFolha}}".
 */
const { proximoDiaBancario, somarDias } = require("./diasBancarios");

const TIPOS_BLOCO = ["boas_vindas", "etapa", "documento", "prazo_recorrente", "contato", "marco"];
const AREAS = ["contabil", "fiscal", "pessoal"];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function ehDataISO(v) {
  return typeof v === "string" && ISO.test(v);
}

/** Áreas contratadas, a partir dos três booleanos de `objeto`. Sem nenhum marcado = todas (contrato antigo). */
function areasDoContrato(dados) {
  const o = (dados && dados.objeto) || {};
  const marcadas = [];
  if (o.areaContabil) marcadas.push("contabil");
  if (o.areaFiscal) marcadas.push("fiscal");
  if (o.areaPessoal) marcadas.push("pessoal");
  return marcadas.length ? marcadas : [...AREAS];
}

function temFuncionarios(dados) {
  const o = (dados && dados.objeto) || {};
  return Number(o.funcionariosIncluidos) > 0 && areasDoContrato(dados).includes("pessoal");
}

function lista(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  return v ? [v] : [];
}

/**
 * `condicao`/`regras` bate com o contrato? Critério ausente = não restringe.
 * `areas` exige que TODAS as áreas listadas estejam contratadas.
 */
function condicaoBate(cond, dados) {
  if (!cond || typeof cond !== "object") return true;
  const o = (dados && dados.objeto) || {};
  const areas = lista(cond.areas);
  if (areas.length) {
    const contratadas = areasDoContrato(dados);
    if (!areas.every((a) => contratadas.includes(a))) return false;
  }
  const enq = lista(cond.enquadramento);
  if (enq.length && !enq.includes(o.enquadramento)) return false;
  const tipo = lista(cond.tipoEmpresa);
  if (tipo.length && !tipo.includes(o.tipoEmpresa)) return false;
  if (typeof cond.comFuncionarios === "boolean" && cond.comFuncionarios !== temFuncionarios(dados)) return false;
  return true;
}

/** Quantos critérios o modelo especifica — o mais específico vence. */
function especificidade(regras) {
  if (!regras || typeof regras !== "object") return 0;
  let n = 0;
  if (lista(regras.areas).length) n += 1;
  if (lista(regras.enquadramento).length) n += 1;
  if (lista(regras.tipoEmpresa).length) n += 1;
  if (typeof regras.comFuncionarios === "boolean") n += 1;
  return n;
}

/**
 * Modelo que melhor serve ao contrato: entre os ativos que batem, o de mais critérios;
 * empate = menor `ordem`. Modelo sem regras é o "padrão" (especificidade 0). Null se nenhum bate.
 */
function escolherModelo(dados, modelos) {
  const candidatos = (modelos || [])
    .filter((m) => m && m.ativo !== false && condicaoBate(m.regras, dados))
    .map((m) => ({ m, e: especificidade(m.regras) }));
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => b.e - a.e || (a.m.ordem || 0) - (b.m.ordem || 0));
  return candidatos[0].m;
}

function porCaminho(obj, caminho) {
  return String(caminho)
    .split(".")
    .reduce((acc, k) => (acc && typeof acc === "object" ? acc[k] : undefined), obj);
}

/** Troca {{secao.campo}} pelo valor do contrato; campo vazio some em vez de aparecer "undefined". */
function preencherTexto(texto, dados) {
  return String(texto || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, caminho) => {
    const v = porCaminho(dados, caminho);
    return v === undefined || v === null ? "" : String(v);
  });
}

/** Soma `n` dias úteis (bancários) a partir de `data`; `n` 0 = o próprio dia, ou o próximo útil. */
function somarDiasUteis(data, n) {
  if (!ehDataISO(data)) return null;
  let atual = proximoDiaBancario(data);
  for (let i = 0; i < n && atual; i += 1) atual = proximoDiaBancario(somarDias(atual, 1));
  return atual;
}

/** Data absoluta de um prazo relativo. Devolve null se faltar a data-base. */
function calcularPrazo(prazo, base) {
  if (!prazo || typeof prazo !== "object") return null;
  const origem = prazo.ref === "inicio" ? base.inicio || base.assinatura : base.assinatura;
  if (!ehDataISO(origem)) return null;
  const dias = Math.max(0, Math.min(365, Math.trunc(Number(prazo.dias) || 0)));
  return prazo.uteis ? somarDiasUteis(origem, dias) : somarDias(origem, dias);
}

/**
 * Transforma o modelo em itens do cliente: descarta blocos cuja condição não bate, preenche
 * os textos com o contrato e fixa as datas. `id` é estável (posição + tipo) para o upload
 * apontar sempre para o mesmo item.
 */
function resolverItens(modelo, dados, assinaturaISO) {
  const blocos = Array.isArray(modelo && modelo.blocos) ? modelo.blocos : [];
  const inicio = ehDataISO(dados && dados.vigencia && dados.vigencia.dataInicio) ? dados.vigencia.dataInicio : null;
  const base = { assinatura: assinaturaISO, inicio };
  const itens = [];
  for (const [i, b] of blocos.entries()) {
    if (!b || !TIPOS_BLOCO.includes(b.tipo)) continue;
    if (!condicaoBate(b.condicao, dados)) continue;
    const item = {
      id: `${i + 1}-${b.tipo}`,
      tipo: b.tipo,
      titulo: preencherTexto(b.titulo, dados),
      descricao: preencherTexto(b.descricao, dados),
    };
    if (b.tipo === "documento") {
      item.obrigatorio = b.obrigatorio !== false;
      item.formatos = lista(b.formatos);
      item.comoEnviar = preencherTexto(b.comoEnviar, dados);
      item.exemploUrl = typeof b.exemploUrl === "string" ? b.exemploUrl : "";
    }
    if (b.tipo === "documento" || b.tipo === "marco") {
      item.prazoData = calcularPrazo(b.prazo, base);
    }
    if (b.tipo === "prazo_recorrente") item.regra = preencherTexto(b.regra, dados);
    if (b.tipo === "contato") item.contato = preencherTexto(b.contato, dados);
    itens.push(item);
  }
  return itens;
}

/**
 * Status a partir dos itens e dos arquivos. `arquivosPorItem`: { [itemId]: 'enviado'|'aprovado'|'reprovado' }
 * (o último status do item). Concluído = todo documento obrigatório aprovado;
 * em_analise = todos enviados mas algum ainda não aprovado; em_andamento = algum enviado.
 */
function calcularStatus(itens, arquivosPorItem) {
  const obrig = (itens || []).filter((i) => i.tipo === "documento" && i.obrigatorio);
  const st = arquivosPorItem || {};
  if (!obrig.length) return "concluido";
  if (obrig.every((i) => st[i.id] === "aprovado")) return "concluido";
  const enviados = obrig.filter((i) => st[i.id] === "enviado" || st[i.id] === "aprovado");
  if (enviados.length === obrig.length && obrig.every((i) => st[i.id] !== "reprovado")) return "em_analise";
  if (obrig.some((i) => st[i.id])) return "em_andamento";
  return "aguardando";
}

/** Documentos obrigatórios sem envio aprovado cujo prazo já passou (`hoje` 'YYYY-MM-DD'). */
function itensAtrasados(itens, arquivosPorItem, hoje) {
  const st = arquivosPorItem || {};
  return (itens || []).filter(
    (i) =>
      i.tipo === "documento" &&
      i.obrigatorio &&
      i.prazoData &&
      i.prazoData < hoje &&
      st[i.id] !== "aprovado" &&
      st[i.id] !== "enviado"
  );
}

module.exports = {
  TIPOS_BLOCO,
  areasDoContrato,
  temFuncionarios,
  condicaoBate,
  escolherModelo,
  preencherTexto,
  somarDiasUteis,
  calcularPrazo,
  resolverItens,
  calcularStatus,
  itensAtrasados,
};
