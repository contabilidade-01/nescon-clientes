/**
 * A "inscrição" do cliente no G-Click nem sempre é um CNPJ.
 *
 * Na base real aparecem três coisas:
 *  - CNPJ (14 dígitos) — o caso comum;
 *  - CPF (11 dígitos) — cliente pessoa física;
 *  - lixo, como um "0" solto em cadastros de teste.
 *
 * Exigir 14 dígitos barrava os dois últimos casos até para **rejeitar**, que é
 * justamente o que se quer fazer com eles. Daí a separação abaixo: uma coisa é o
 * identificador ser utilizável para decidir, outra é ele poder virar cadastro.
 */

/** Serve para identificar a linha no espelho (rejeitar, reconsiderar, consultar). */
function inscricaoValida(v) {
  return typeof v === "string" && /^\d{1,14}$/.test(v);
}

/** Só CPF ou CNPJ podem virar empresa: é o que o portal usa como login. */
function podeVirarEmpresa(v) {
  return inscricaoValida(v) && (v.length === 11 || v.length === 14);
}

/** 'cpf' | 'cnpj' | 'invalida' — para a mensagem de erro dizer o que está errado. */
function tipoInscricao(v) {
  if (!inscricaoValida(v)) return "invalida";
  if (v.length === 14) return "cnpj";
  if (v.length === 11) return "cpf";
  return "invalida";
}

module.exports = { inscricaoValida, podeVirarEmpresa, tipoInscricao };
