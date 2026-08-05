/**
 * Número de WhatsApp: validação e normalização.
 *
 * Porte da regra já rodada em produção no sistema de guias (`app/helpers.py`,
 * `validar_whatsapp_br`), com uma diferença: lá o número tinha de chegar pronto com o
 * 55; aqui a gente **completa**. O escritório digita o número como fala — "34 99999-8888"
 * — e o portal põe o DDI. Exigir o 55 na mão só gera cadastro errado.
 *
 * O que NÃO mudou, porque é o que evita envio silenciosamente perdido:
 *
 * - **Só celular.** WhatsApp não existe em fixo. Um fixo de 10 dígitos é rejeitado com
 *   mensagem própria, para o admin entender que precisa trocar o cadastro, e não ficar
 *   procurando defeito no envio.
 * - **DDD tem de ser real.** `[1-9][1-9]` cobre a faixa válida; 01, 10, 20… não existem.
 * - **O 9 na frente é obrigatório.** Celular brasileiro é 9 + 8 dígitos desde 2016.
 */

// 55 + DDD + 9 + 8 dígitos = 13.
const RE_CELULAR = /^55(?:1[1-9]|[2-9][1-9])9\d{8}$/;
// 55 + DDD + 8 dígitos = 12. Fixo (ou celular antigo, sem o 9).
const RE_FIXO = /^55(?:1[1-9]|[2-9][1-9])\d{8}$/;

function soDigitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

/**
 * Completa o DDI quando o usuário digitou só DDD + número.
 * 11 dígitos (DDD + 9 + 8) e 10 dígitos (DDD + 8) ganham o 55; o resto passa direto,
 * para a validação decidir.
 */
function normalizar(valor) {
  const d = soDigitos(valor);
  if (!d) return "";
  if (d.length === 11 || d.length === 10) return `55${d}`;
  return d;
}

/**
 * Devolve `{ ok, numero, motivo }`. `numero` só vem preenchido quando `ok`.
 * O motivo é texto para o admin ler na tela — por isso é específico por caso.
 */
function validar(valor) {
  const numero = normalizar(valor);
  if (!numero) return { ok: false, numero: null, motivo: "WhatsApp em branco" };
  if (RE_CELULAR.test(numero)) return { ok: true, numero, motivo: "" };
  if (RE_FIXO.test(numero)) {
    return {
      ok: false,
      numero: null,
      motivo:
        "Parece telefone fixo (falta o 9 do celular). O WhatsApp só funciona em celular — corrija o cadastro.",
    };
  }
  return {
    ok: false,
    numero: null,
    motivo: `Formato inválido: esperado DDD + 9 dígitos (recebido ${numero.length} dígito(s)).`,
  };
}

/** Para exibir na tela: (34) 99999-8888. */
function formatar(valor) {
  const d = soDigitos(valor);
  const sem55 = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (sem55.length === 11) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 7)}-${sem55.slice(7)}`;
  if (sem55.length === 10) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 6)}-${sem55.slice(6)}`;
  return String(valor || "");
}

module.exports = { normalizar, validar, formatar, soDigitos };
