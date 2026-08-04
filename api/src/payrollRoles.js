/**
 * Quem é funcionário de verdade e quem é só pró-labore.
 *
 * Muitas empresas na carteira têm apenas o sócio na folha. Para elas, "Férias" não faz
 * sentido: sócio não tem férias no sentido celetista. A regra vive aqui para o portal,
 * o painel e os relatórios responderem a mesma coisa.
 *
 * O cargo vem do Extrato Mensal. Enquanto ele não tiver sido lido, `cargo` é nulo — e
 * nesse caso tratamos a pessoa como **funcionário**. Errar mostrando um menu a mais é
 * barato; errar escondendo faz o cliente achar que perdeu um serviço que contratou.
 */
const RE_PROLABORE = /\b(diretor|diretora|s[oó]cio|s[oó]cia|titular|pr[oó]\s*-?\s*labore)\b/i;

function ehProLabore(cargo) {
  const c = String(cargo || "").trim();
  if (!c) return false;
  return RE_PROLABORE.test(c);
}

/** Só quem conta como funcionário celetista (cargo desconhecido conta). */
function apenasFuncionarios(lista) {
  return lista.filter((e) => !ehProLabore(e.cargo));
}

/**
 * Mesma regra em SQL, para não duplicar critério entre a tela e o relatório.
 * `alias` é a tabela de employees na consulta.
 */
function funcionarioRealSql(alias = "e") {
  return `(${alias}.active IS TRUE AND (${alias}.cargo IS NULL OR ${alias}.cargo !~* '(diretor|diretora|s[oó]cio|s[oó]cia|titular|pr[oó] ?-? ?labore)'))`;
}

module.exports = { ehProLabore, apenasFuncionarios, funcionarioRealSql, RE_PROLABORE };
