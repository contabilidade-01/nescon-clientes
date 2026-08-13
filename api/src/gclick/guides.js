/**
 * Regras de domínio das guias do G-Click.
 *
 * Porte de `app/tipos.py` (classificação) e `gclick.extrair_guias_pendentes`
 * (versionamento) do sistema de guias. Ao acrescentar um tipo, mexer nos dois.
 */

/**
 * Tipos padrão, na ordem de precedência (menor `ordem` ganha).
 * `temVencimento=false` para folha: esses documentos não têm data a pagar.
 */
const TIPOS = [
  { codigo: "FGTS", nome: "FGTS", matchers: "FGTS", ordem: 10, temVencimento: true },
  { codigo: "DCTF_WEB", nome: "INSS (DCTF Web)", matchers: "DCTF Web|DCTFWeb|DCTF-Web", ordem: 20, temVencimento: true },
  { codigo: "DAS", nome: "DAS / Simples", matchers: "DAS Simples|DAS|Simples Nacional", ordem: 40, temVencimento: true },
  {
    codigo: "RECIBO_PAGTO",
    nome: "Recibos da Folha",
    matchers: "Anexar recibo de pagamento|Recibo de Pagamento|Recibo de Adiantamento",
    ordem: 100,
    temVencimento: false,
  },
  {
    codigo: "EXTRATO_FOLHA",
    nome: "Extrato da Folha",
    matchers: "Anexar Folha de Pagamento (Extrato)|Folha de Pagamento (Extrato)",
    ordem: 110,
    temVencimento: false,
  },
].sort((a, b) => a.ordem - b.ordem);

/** Os matchers têm parênteses literais ("(Extrato)"), então escapamos antes do regex. */
const PADROES = TIPOS.map((t) => ({
  ...t,
  regex: new RegExp(
    t.matchers
      .split("|")
      .map((m) => m.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "i"
  ),
}));

const CATEGORIA_POR_TIPO = {
  FGTS: "guia",
  DCTF_WEB: "guia",
  DAS: "guia",
  RECIBO_PAGTO: "folha",
  EXTRATO_FOLHA: "folha",
};

/**
 * Classifica pelo nome mais específico primeiro (arquivo > atividade > obrigação):
 * uma obrigação genérica ("FGTS, DCTF Web") não deve marcar todas as atividades dela.
 */
function classificar(...nomes) {
  for (const txt of nomes) {
    if (!txt) continue;
    for (const p of PADROES) {
      if (p.regex.test(txt)) return { codigo: p.codigo, nome: p.nome, temVencimento: p.temVencimento };
    }
  }
  return null;
}

function categoriaDe(codigo) {
  return CATEGORIA_POR_TIPO[codigo] || "outro";
}

/**
 * Identidade estável de um documento.
 *
 * NÃO usa `atividade_id`: no G-Click uma retificação cria uma atividade NOVA com o
 * mesmo nome. Usar o id faria a versão retificada entrar como documento separado e o
 * cliente veria as duas. Por tarefa + nome da atividade, a retificação atualiza a linha.
 */
function chaveDocumento(tarefaId, atividadeNome) {
  return `${tarefaId}::${String(atividadeNome || "").trim().toLowerCase()}`;
}

/**
 * De uma tarefa + suas atividades, devolve as guias — sempre a VERSÃO MAIS RECENTE
 * de cada documento.
 *
 * Agrupa as atividades de upload por nome e fica com a de `respondidaEm` mais alto,
 * anotando quantas versões existem (para a UI poder avisar "retificada").
 */
function extrairGuiasPendentes(tarefa, atividades) {
  const competencia = String(tarefa?.dataVencimento || "").slice(0, 7); // YYYY-MM

  const porNome = new Map();
  for (const a of atividades || []) {
    const arquivos = a?.arquivos || [];
    if (!arquivos.length || !a?.respondida) continue;
    const chave = String(a.nome || "").trim().toLowerCase();
    if (!porNome.has(chave)) porNome.set(chave, []);
    porNome.get(chave).push(a);
  }

  const guias = [];
  for (const lista of porNome.values()) {
    // Mais antigo primeiro; empate resolve pelo id (mesma regra do outro sistema).
    lista.sort((x, y) => {
      const a = `${x.respondidaEm || ""}|${x.id || ""}`;
      const b = `${y.respondidaEm || ""}|${y.id || ""}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const maisRecente = lista[lista.length - 1];
    const numVersoes = lista.length;

    for (const arq of maisRecente.arquivos || []) {
      guias.push({
        tarefaId: tarefa.id,
        atividadeId: maisRecente.id,
        atividadeNome: maisRecente.nome,
        arquivoNome: arq?.nome || null,
        arquivoUrl: arq?.url || null,
        cnpj: String(tarefa?.clienteInscricao || "").replace(/\D/g, ""),
        clienteApelido: tarefa?.clienteApelido || null,
        obrigacaoNome: tarefa?.nome || null,
        dataVencimento: tarefa?.dataVencimento || null,
        statusTarefa: tarefa?.status || null,
        competencia,
        respondidaEm: maisRecente.respondidaEm || null,
        ehRetificada: numVersoes > 1,
        numVersoes,
        chave: chaveDocumento(tarefa.id, maisRecente.nome),
      });
    }
  }
  return guias;
}

/** Primeiro e último dia da competência 'YYYY-MM', no formato que a API espera. */
function rangeCompetencia(competencia) {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimo = new Date(ano, mes, 0).getDate();
  return {
    inicio: `${competencia}-01`,
    fim: `${competencia}-${String(ultimo).padStart(2, "0")}`,
  };
}

/** As N competências até hoje, da mais recente para a mais antiga. */
function ultimasCompetencias(n) {
  const out = [];
  const hoje = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

module.exports = {
  TIPOS,
  classificar,
  categoriaDe,
  chaveDocumento,
  extrairGuiasPendentes,
  rangeCompetencia,
  ultimasCompetencias,
};
