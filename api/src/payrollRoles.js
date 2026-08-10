/**
 * Quem é funcionário de verdade e quem é só pró-labore.
 *
 * O extrato traz dois campos que distinguem: **vínculo** (Celetista / Diretor /
 * Estagiário) e **cargo** (Diretor, Sócio, Auxiliar DP…). O vínculo é mais
 * confiável: "Diretor" no vínculo = pró-labore com certeza; "Diretor" no cargo pode
 * ser um diretor CLT (raro, mas existe). Usamos ambos em cascata.
 *
 * Regras de quem NÃO recebe 13º:
 * - vínculo = Diretor → pró-labore, sem 13º
 * - vínculo = Estagiário → sem 13º (estagiário recebe bolsa, não salário CLT)
 * - cargo contém diretor/sócio/titular/pró-labore → pró-labore
 *
 * Férias:
 * - Diretor (pró-labore) → sem férias CLT
 * - Estagiário → TEM férias (recesso remunerado de 30 dias após 12 meses)
 * - Celetista → férias normais
 */
const RE_PROLABORE = /\b(diretor|diretora|s[oó]cio|s[oó]cia|titular|pr[oó]\s*-?\s*labore)\b/i;
const RE_VINCULO_DIRETOR = /^diretor$/i;
const RE_VINCULO_ESTAGIARIO = /^estagi[aá]ri[oa]$/i;

function ehProLabore(cargo, vinculo) {
  if (vinculo && RE_VINCULO_DIRETOR.test(vinculo.trim())) return true;
  const c = String(cargo || "").trim();
  if (!c) return false;
  return RE_PROLABORE.test(c);
}

function ehEstagiario(vinculo) {
  return vinculo && RE_VINCULO_ESTAGIARIO.test(vinculo.trim());
}

/** Quem conta para 13º: exclui pró-labore E estagiário. */
function apenasFuncionarios13(lista) {
  return lista.filter((e) => !ehProLabore(e.cargo, e.vinculo) && !ehEstagiario(e.vinculo));
}

/** Quem conta para férias: exclui pró-labore (estagiário TEM férias). */
function apenasFuncionariosFerias(lista) {
  return lista.filter((e) => !ehProLabore(e.cargo, e.vinculo));
}

/**
 * SQL que filtra quem entra no 13º (exclui diretor E estagiário).
 * `alias` é a tabela de employees na consulta.
 */
function funcionarioRealSql(alias = "e") {
  return `(${alias}.active IS TRUE AND (${alias}.vinculo IS NULL OR ${alias}.vinculo !~* '^(diretor|estagi[aá]ri[oa])$') AND (${alias}.cargo IS NULL OR ${alias}.cargo !~* '(diretor|diretora|s[oó]cio|s[oó]cia|titular|pr[oó] ?-? ?labore)'))`;
}

/**
 * SQL que filtra quem entra nas férias (exclui diretor, mas mantém estagiário).
 */
function funcionarioFeriasSql(alias = "e") {
  return `(${alias}.active IS TRUE AND (${alias}.vinculo IS NULL OR ${alias}.vinculo !~* '^diretor$') AND (${alias}.cargo IS NULL OR ${alias}.cargo !~* '(diretor|diretora|s[oó]cio|s[oó]cia|titular|pr[oó] ?-? ?labore)'))`;
}

module.exports = {
  ehProLabore,
  ehEstagiario,
  apenasFuncionarios13,
  apenasFuncionariosFerias,
  funcionarioRealSql,
  funcionarioFeriasSql,
  RE_PROLABORE,
};
