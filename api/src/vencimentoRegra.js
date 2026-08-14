/**
 * Vencimento POR REGRA — para tributos cujo dia de vencimento é fixado em lei, nacional
 * e inequívoco. Nesses casos a regra do catálogo (obrigacoes.js) é mais confiável do que
 * qualquer data lida do PDF ou vinda do G-Click, que erram: o G-Click sistematicamente
 * (ex. FGTS Digital), o PDF enquanto o leitor determinístico/IA não está 100% validado.
 *
 * Decisão (12/08/2026, Jean): enquanto o verificador de datas não é 100% confiável, a
 * REGRA manda para os tributos abaixo. Guia de GRRF (FGTS rescisório, que vence noutra
 * data) NUNCA chega pelo G-Click — então todo FGTS que entra por lá é FGTS mensal, dia
 * 20, sem exceção. Ver docs/PLANO-RECONHECIMENTO-VENCIMENTO-IA.md.
 *
 * ## Por que só alguns tributos
 *
 * Só entram os de regra NACIONAL e sem ambiguidade — o mesmo dia em todo o país:
 *   - FGTS      → dia 20 (antecipa)         [obrigacoes: FGTS]
 *   - DAS       → dia 20 (adia — LC 123)    [obrigacoes: DAS]
 *   - DCTF Web  → dia 20 (antecipa, INSS)   [obrigacoes: INSS_DCTFWEB]
 *
 * Os três acima são exatamente `OBRIGACOES_NUCLEO` (exportada de obrigacoes.js) — fonte
 * única da verdade. Aqui abaixo o DOC_TYPE_PARA_OBRIGACAO traduz o doc_type do G-Click
 * (chave) para o código do catálogo (valor).
 *
 * Ficam DE FORA de propósito, porque o dia varia e não há regra única confiável:
 *   - ISS   → municipal (o catálogo só conhece Uberlândia)
 *   - ICMS  → estadual (dia varia por UF)
 *   - INSS  → doc_type genérico ambíguo (GPS comum dia 20, contribuinte individual dia 15)
 * Para esses, a data lida do documento continua valendo (comportamento anterior).
 */
const { calcularVencimento, OBRIGACOES_NUCLEO } = require("./obrigacoes");

/**
 * doc_type do G-Click (ver gclick/guides.js) → código de obrigação (ver obrigacoes.js).
 * Só os de regra nacional inequívoca. Acrescentar aqui é o único passo para ligar um novo
 * tributo à regra fixa. Os três códigos do VALUES devem ser um subconjunto de
 * OBRIGACOES_NUCLEO (FGTS, INSS_DCTFWEB, DAS) — se divergir, o teste de obrição
 * núcleo+test abaixo pega.
 */
const DOC_TYPE_PARA_OBRIGACAO = {
  FGTS: "FGTS",
  DAS: "DAS",
  DCTF_WEB: "INSS_DCTFWEB",
};

/** true se o doc_type tem regra nacional fixa (e portanto a regra deve mandar). */
function temRegraFixa(docType) {
  return Boolean(DOC_TYPE_PARA_OBRIGACAO[String(docType || "").toUpperCase()]);
}

/**
 * Vencimento pela regra do tributo, ancorado no MÊS DE PAGAMENTO.
 *
 * `refMesPagamento` pode ser 'YYYY-MM' (campo competencia do deliverable, que já é o mês
 * de pagamento) ou 'YYYY-MM-DD' (a própria data que veio errada — usamos só o mês, porque
 * o erro é sempre no dia, não no mês: FGTS dia 7 vs dia 20 caem no mesmo mês).
 *
 * Devolve 'YYYY-MM-DD' pela regra, ou null quando o doc_type não tem regra fixa, ou a
 * referência não é um mês válido. Nunca chuta — null é resposta legítima ("aqui a regra
 * não se aplica, use a data lida").
 */
function vencimentoPorRegra(docType, refMesPagamento) {
  const codigo = DOC_TYPE_PARA_OBRIGACAO[String(docType || "").toUpperCase()];
  if (!codigo) return null;

  const m = /^(\d{4})-(\d{2})/.exec(String(refMesPagamento || ""));
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;

  const v = calcularVencimento(codigo, ano, mes);
  return v ? v.data : null;
}

module.exports = {
  DOC_TYPE_PARA_OBRIGACAO,
  temRegraFixa,
  vencimentoPorRegra,
};
