/**
 * Validação dos campos de jornada do funcionário (ver ensureJornadaSchema.js).
 * Função pura: recebe o corpo da requisição e devolve as colunas a gravar ou um erro.
 */
const ESCALAS = ["5x2", "6x1", "12x36", "4x3", "outra"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * @returns {{ campos: Record<string, unknown> } | { erro: string }}
 *  `campos` só traz o que veio no corpo (undefined = não mexe). null limpa o campo.
 */
function lerJornada(body) {
  const b = body || {};
  const campos = {};

  if (b.carga_semanal !== undefined) {
    if (b.carga_semanal === null || b.carga_semanal === "") campos.carga_semanal = null;
    else {
      const n = Number(String(b.carga_semanal).replace(",", "."));
      if (!Number.isFinite(n) || n <= 0 || n > 60) return { erro: "Carga semanal inválida (entre 1 e 60 horas)" };
      campos.carga_semanal = Math.round(n * 100) / 100;
    }
  }
  if (b.escala !== undefined) {
    if (b.escala === null || b.escala === "") campos.escala = null;
    else if (!ESCALAS.includes(b.escala)) return { erro: "Escala inválida" };
    else campos.escala = b.escala;
  }
  if (b.folga !== undefined) {
    if (b.folga === null || b.folga === "") campos.folga = null;
    else if (typeof b.folga !== "string" || b.folga.length > 60) return { erro: "Folga inválida" };
    else campos.folga = b.folga.trim();
  }
  for (const k of ["horario_entrada", "horario_saida"]) {
    if (b[k] === undefined) continue;
    if (b[k] === null || b[k] === "") campos[k] = null;
    else if (!HHMM.test(String(b[k]))) return { erro: "Horário inválido (use HH:MM)" };
    else campos[k] = String(b[k]);
  }
  if (b.hipersuficiente !== undefined) {
    if (typeof b.hipersuficiente !== "boolean") return { erro: "Hipersuficiente inválido" };
    campos.hipersuficiente = b.hipersuficiente;
  }
  return { campos };
}

module.exports = { ESCALAS, lerJornada };
