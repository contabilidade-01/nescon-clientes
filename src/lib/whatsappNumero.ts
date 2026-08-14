/**
 * Validação de WhatsApp em TypeScript — espelho do backend (api/src/whatsappNumero.js).
 *
 * Mesmas regras: celular brasileiro, 9 dígitos + 8, DDD válido, sem fixo.
 * Sem 55 na entrada? A gente completa.
 */

// 55 + DDD + 9 + 8 dígitos = 13.
const RE_CELULAR = /^55(?:1[1-9]|[2-9][1-9])9\d{8}$/;
// 55 + DDD + 8 dígitos = 12. Fixo (ou celular antigo, sem o 9).
const RE_FIXO = /^55(?:1[1-9]|[2-9][1-9])\d{8}$/;

function soDigitos(valor: string | null | undefined): string {
  return String(valor || "").replace(/\D/g, "");
}

/**
 * Completa o DDI quando o usuário digitou só DDD + número.
 */
export function normalizar(valor: string | null | undefined): string {
  const d = soDigitos(valor);
  if (!d) return "";
  if (d.length === 11 || d.length === 10) return `55${d}`;
  return d;
}

/**
 * Valida o número. Retorna { ok, numero, motivo }.
 * `numero` só vem preenchido quando `ok === true`.
 */
export function validar(valor: string | null | undefined): {
  ok: boolean;
  numero: string | null;
  motivo: string;
} {
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

/**
 * Formata para exibição: (34) 99999-8888.
 */
export function formatar(valor: string | null | undefined): string {
  const d = soDigitos(valor);
  const sem55 = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (sem55.length === 11) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 7)}-${sem55.slice(7)}`;
  if (sem55.length === 10) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 6)}-${sem55.slice(6)}`;
  return String(valor || "");
}
