/**
 * Certificado digital (e-CNPJ / e-CPF) da empresa: validade e aviso de vencimento.
 *
 * Mesma regra das licenças (licenseStatus.js): não se grava "vencido" na base. Guarda-se
 * só a data de validade e o estado (ativo / a vencer / vencido / ausente) é calculado na
 * leitura, contra a data de hoje. Renovação = nova linha; o vigente é o de maior validade.
 *
 * O arquivo do certificado (.pfx) e a senha NUNCA entram aqui: o portal só precisa saber
 * até quando ele vale para avisar a tempo.
 */
const CERT_TIPOS = ["a1", "a3"];
const CERT_TIPO_LABELS = { a1: "A1 (arquivo)", a3: "A3 (token ou cartão)" };
const CERT_TITULARES = ["e_cnpj", "e_cpf"];
const CERT_TITULAR_LABELS = { e_cnpj: "e-CNPJ", e_cpf: "e-CPF" };
const CERT_STATUSES = ["ativo", "a_vencer", "vencido", "ausente"];

/** Quantos dias antes da validade o certificado entra em "a vencer". */
const DEFAULT_CERT_WARN_DAYS = 30;

function certWarnDays() {
  const n = parseInt(process.env.CERT_WARN_DAYS || "", 10);
  if (!Number.isInteger(n) || n < 1 || n > 180) return DEFAULT_CERT_WARN_DAYS;
  return n;
}

/** Fragmento SQL do estado. `dias` é sempre um inteiro validado. */
function certStatusSql(col, dias = certWarnDays()) {
  const d = Number.isInteger(dias) ? dias : DEFAULT_CERT_WARN_DAYS;
  return `CASE
    WHEN ${col} IS NULL THEN 'ausente'
    WHEN ${col} < CURRENT_DATE THEN 'vencido'
    WHEN ${col} <= CURRENT_DATE + INTERVAL '${d} days' THEN 'a_vencer'
    ELSE 'ativo'
  END`;
}

/** Dias corridos de hoje até a validade (negativo = já venceu). */
function diasAte(venceEm, hoje = new Date()) {
  if (!venceEm) return null;
  const v = venceEm instanceof Date ? venceEm : new Date(`${String(venceEm).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(v.getTime())) return null;
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const alvo = new Date(v.getFullYear(), v.getMonth(), v.getDate());
  return Math.round((alvo - base) / 86400000);
}

/** Mesma regra do SQL, em JS (testes e telas). */
function certStatusOf(venceEm, hoje = new Date(), dias = certWarnDays()) {
  const d = diasAte(venceEm, hoje);
  if (d === null) return "ausente";
  if (d < 0) return "vencido";
  if (d <= dias) return "a_vencer";
  return "ativo";
}

function dataBr(iso) {
  const s = String(iso || "").slice(0, 10);
  const [a, m, d] = s.split("-");
  return a && m && d ? `${d}/${m}/${a}` : s;
}

/** Texto do aviso pelo WhatsApp. Curto e com o que o cliente precisa fazer. */
function montarAvisoCertificado({ empresa, venceEm, hoje = new Date() }) {
  const d = diasAte(venceEm, hoje);
  const quando =
    d === null
      ? "não tem validade registrada no portal"
      : d < 0
        ? `venceu em ${dataBr(venceEm)}`
        : d === 0
          ? "vence hoje"
          : `vence em ${dataBr(venceEm)} (daqui a ${d} dia${d === 1 ? "" : "s"})`;
  return [
    `Olá! Aqui é da Nescon Contabilidade.`,
    `O certificado digital da ${empresa} ${quando}.`,
    `Sem ele não conseguimos emitir notas nem entregar as declarações da empresa. Providencie a renovação e, depois de renovar, informe a nova validade no portal (Início › Certificado digital) ou responda esta mensagem.`,
  ].join("\n\n");
}

/** Campos aceitos no cadastro. Retorna { erro } ou os valores limpos. */
function lerCamposCertificado(body, { validateDate, validateString }) {
  const b = body || {};
  const tipo = b.tipo ? String(b.tipo) : "a1";
  const titular = b.titular ? String(b.titular) : "e_cnpj";
  const vazio = (v) => v === undefined || v === null || String(v).trim() === "";
  const emissor = vazio(b.emissor) ? null : String(b.emissor).trim();
  const observacao = vazio(b.observacao) ? null : String(b.observacao).trim();
  const emitido = vazio(b.emitido_em) ? null : String(b.emitido_em).slice(0, 10);
  const vence = vazio(b.vence_em) ? null : String(b.vence_em).slice(0, 10);

  if (!CERT_TIPOS.includes(tipo)) return { erro: "Tipo deve ser A1 ou A3" };
  if (!CERT_TITULARES.includes(titular)) return { erro: "Titular deve ser e-CNPJ ou e-CPF" };
  if (emissor !== null && !validateString(emissor, 1, 120)) return { erro: "Emissor inválido" };
  if (observacao !== null && !validateString(observacao, 1, 500)) {
    return { erro: "Observação muito longa (máx. 500)" };
  }
  if (emitido && !validateDate(emitido)) return { erro: "Data de emissão inválida" };
  if (!vence || !validateDate(vence)) return { erro: "Informe a validade do certificado (AAAA-MM-DD)" };
  if (emitido && emitido > vence) return { erro: "A emissão não pode ser depois da validade" };
  return { tipo, titular, emissor, observacao, emitido, vence };
}

module.exports = {
  CERT_TIPOS,
  CERT_TIPO_LABELS,
  CERT_TITULARES,
  CERT_TITULAR_LABELS,
  CERT_STATUSES,
  DEFAULT_CERT_WARN_DAYS,
  certWarnDays,
  certStatusSql,
  certStatusOf,
  diasAte,
  montarAvisoCertificado,
  lerCamposCertificado,
};
