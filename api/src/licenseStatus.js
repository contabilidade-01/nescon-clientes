/**
 * Estado de uma licença — decidido em UM lugar só.
 *
 * Nunca gravamos "vencida"/"ativa" na base: o estado é derivado de vence_em contra a
 * data de hoje. O painel, a listagem e os filtros usam esta mesma expressão, então é
 * impossível o resumo discordar da lista.
 */
const LICENSE_TYPES = ["funcionamento", "avcb_clcb", "sanitaria"];

const LICENSE_TYPE_LABELS = {
  funcionamento: "Alvará de Funcionamento",
  avcb_clcb: "AVCB / CLCB (Bombeiros)",
  sanitaria: "Vigilância Sanitária",
};

const LICENSE_STATUSES = ["ativa", "a_vencer", "vencida", "ausente"];

/** Janela de aviso: quantos dias antes do vencimento a licença entra em "a vencer". */
const DEFAULT_WARN_DAYS = 60;

function warnDays() {
  const n = parseInt(process.env.LICENSE_WARN_DAYS || "", 10);
  if (!Number.isInteger(n) || n < 1 || n > 365) return DEFAULT_WARN_DAYS;
  return n;
}

/**
 * Fragmento SQL que classifica uma coluna DATE de vencimento.
 * `dias` entra interpolado, mas é sempre um inteiro validado por warnDays().
 */
function statusSql(col, dias = warnDays()) {
  const d = Number.isInteger(dias) ? dias : DEFAULT_WARN_DAYS;
  return `CASE
    WHEN ${col} IS NULL THEN 'ausente'
    WHEN ${col} < CURRENT_DATE THEN 'vencida'
    WHEN ${col} <= CURRENT_DATE + INTERVAL '${d} days' THEN 'a_vencer'
    ELSE 'ativa'
  END`;
}

/** Mesma regra em JS (usada em testes e em qualquer cálculo fora do Postgres). */
function statusOf(venceEm, hoje = new Date(), dias = warnDays()) {
  if (!venceEm) return "ausente";
  const v = venceEm instanceof Date ? venceEm : new Date(`${String(venceEm).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(v.getTime())) return "ausente";
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const alvo = new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const diff = Math.round((alvo - base) / 86400000);
  if (diff < 0) return "vencida";
  if (diff <= dias) return "a_vencer";
  return "ativa";
}

function isLicenseType(t) {
  return LICENSE_TYPES.includes(t);
}

function isLicenseStatus(s) {
  return LICENSE_STATUSES.includes(s);
}

module.exports = {
  LICENSE_TYPES,
  LICENSE_TYPE_LABELS,
  LICENSE_STATUSES,
  DEFAULT_WARN_DAYS,
  warnDays,
  statusSql,
  statusOf,
  isLicenseType,
  isLicenseStatus,
};
