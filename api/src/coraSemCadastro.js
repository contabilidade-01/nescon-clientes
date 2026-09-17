/**
 * Boleto em aberto na Cora de CNPJ que o portal não enxerga.
 *
 * A sincronização da Cora parte do cadastro: para cada empresa, busca os boletos do CNPJ.
 * O caminho inverso não existia — boleto de quem não está em Cadastro > Empresas (ou está,
 * mas com boletos desligado) ficava invisível: sem tela, sem cobrança, sem alerta. Foi o
 * caso do cliente que o G-Click não devolve por cadastro com defeito.
 *
 * Aqui a Cora é lida sem filtro de CNPJ, e o que está em aberto e não casa com o cadastro
 * vira uma lista para o escritório. **Não cria empresa nem grava boleto** — só avisa.
 */
const { getSetting, setSetting } = require("./appSettings");

const CHAVE = "cora_sem_cadastro";

/** CPF/CNPJ do cliente no boleto. A listagem da Cora já variou o formato. Função pura. */
function documentoDoBoleto(b) {
  const bruto =
    b?.customer_document ??
    b?.customer?.document?.identity ??
    b?.customer?.document ??
    b?.customer?.identity ??
    "";
  return String(typeof bruto === "object" ? bruto?.identity || "" : bruto).replace(/\D/g, "");
}

function nomeDoBoleto(b) {
  return String(b?.customer_name ?? b?.customer?.name ?? "").trim() || null;
}

/** Em aberto = nem pago, nem cancelado, nem rascunho. */
function emAberto(status) {
  const s = String(status || "").toUpperCase();
  return !["PAID", "PAGO", "CANCELLED", "CANCELED", "CANCELADO", "REJECTED", "REJEITADO", "DRAFT", "RECURRENCE_DRAFT"].includes(s);
}

/**
 * Função pura: agrupa por documento os boletos em aberto que o portal não importa.
 *
 * @param boletos   itens da listagem da Cora
 * @param cadastro  Map documento → { boletosAtivo: boolean } das empresas não excluídas
 */
function resumirSemCadastro(boletos, cadastro) {
  const grupos = new Map();
  for (const b of boletos) {
    if (!b?.id || !emAberto(b.status)) continue;
    const doc = documentoDoBoleto(b);
    if (!doc) continue;
    const empresa = cadastro.get(doc);
    if (empresa && empresa.boletosAtivo) continue; // esse a sync normal já traz

    const g = grupos.get(doc) || {
      documento: doc,
      nome: nomeDoBoleto(b),
      situacao: empresa ? "sem_acesso_boletos" : "sem_cadastro",
      boletos: 0,
      total_centavos: 0,
      vencimentos: [],
    };
    g.boletos += 1;
    g.total_centavos += Number(b.total_amount) || 0;
    if (b.due_date) g.vencimentos.push(String(b.due_date).slice(0, 10));
    grupos.set(doc, g);
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, vencimentos: g.vencimentos.sort() }))
    .sort((a, b) => (a.vencimentos[0] || "9").localeCompare(b.vencimentos[0] || "9"));
}

/** Lê a Cora inteira da janela e grava o resultado (roda no fim da sync completa). */
async function conferirSemCadastro(db, cora, { start, end }) {
  const boletos = [];
  for (let page = 1; page <= 50; page++) {
    const r = await cora.searchInvoices("", { start, end, page, perPage: 200 });
    const items = r?.items || [];
    boletos.push(...items);
    if (items.length < 200) break;
  }

  const { rows } = await db.query(
    `SELECT regexp_replace(cnpj, '\\D', '', 'g') AS doc,
            (tool_access IS NULL OR tool_access->>'boletos' = 'true') AS boletos_ativo
       FROM companies
      WHERE cnpj IS NOT NULL AND cnpj <> '' AND COALESCE(excluida, false) = false`
  );
  const cadastro = new Map(rows.map((r) => [r.doc, { boletosAtivo: r.boletos_ativo }]));

  const itens = resumirSemCadastro(boletos, cadastro);
  const resultado = { em: new Date().toISOString(), lidos: boletos.length, itens };
  await setSetting(db, CHAVE, JSON.stringify(resultado));
  return resultado;
}

async function lerSemCadastro(db) {
  try {
    const bruto = await getSetting(db, CHAVE);
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

module.exports = { documentoDoBoleto, emAberto, resumirSemCadastro, conferirSemCadastro, lerSemCadastro };
