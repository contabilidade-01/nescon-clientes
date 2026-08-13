/**
 * Quem PODE virar aviso de "documento novo no portal" (WhatsApp).
 *
 * ALLOWLIST (não denylist): SÓ os tipos abaixo geram mensagem ao cliente. Qualquer outra
 * guia/DARF entra no portal CALADA — o cliente vê, mas não leva WhatsApp. É a forma
 * robusta: não é preciso adivinhar e bloquear cada tipo ruim (IRRF, INSS-GPS, ICMS, ISS,
 * PIS, COFINS, IRPJ, CSLL, DARF avulso, guia não classificada...); só o que é bom avisa,
 * o resto é silêncio por padrão.
 *
 * Motivo real (13/08/2026): guias federais que 99,99% dos clientes (Simples Nacional) não
 * acompanham por WhatsApp vazavam como "documento novo" — inclusive um DARF de IRRF
 * (código 0561, sobre a folha) e um INSS-GPS de competência antiga. A lista de supressão
 * anterior não pegava o IRRF; a allowlist pega tudo o que não for explicitamente liberado.
 *
 * Avisam:
 *   - Núcleo:  FGTS, DAS, INSS via DCTF Web
 *   - Folha:   recibo de pagamento, extrato da folha
 *   - Programação de Férias (não tem doc_type — reconhecida pelo título)
 * Boletos (Cora) avisam por caminho próprio (coraSync), fora deste filtro.
 */
const DOC_TYPE_QUE_AVISA = new Set([
  "FGTS",
  "DAS",
  "DCTF_WEB",
  "RECIBO_PAGTO",
  "EXTRATO_FOLHA",
]);

/**
 * Programação de Férias não é classificada em guias.js (não tem doc_type), então é
 * reconhecida pelo título. Tolerante a ordem de palavras e a encoding quebrado no banco
 * (mesma cautela de dueDateSugestoes.js): basta conter "programa…" e "férias/ferias".
 */
function ehProgramacaoFerias(titulo) {
  const t = String(titulo || "");
  return /programa/i.test(t) && /f[eé\xc3]rias|ferias/i.test(t);
}

/** true se um documento (por doc_type OU título) pode gerar aviso de "documento novo". */
function avisaDocumentoNovo(docType, titulo = "") {
  if (DOC_TYPE_QUE_AVISA.has(docType)) return true;
  if (ehProgramacaoFerias(titulo)) return true;
  return false;
}

module.exports = { DOC_TYPE_QUE_AVISA, avisaDocumentoNovo, ehProgramacaoFerias };
