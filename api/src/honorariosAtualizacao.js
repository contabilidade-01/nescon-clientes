/**
 * Regras puras do painel Atualização de Honorários (classificação + config).
 */
const { getSetting, setSetting } = require("./appSettings");

const CHAVE_TOL_ABAIXO = "honorario_atualizacao_tol_abaixo_pct";
const CHAVE_TOL_ACIMA = "honorario_atualizacao_tol_acima_pct";
const TOL_PADRAO = 5;

const ENQUADRAMENTOS = ["mei", "simples", "presumido", "real"];
const TIPOS = ["servico", "comercio", "industria"];
const COMPLEXIDADES = ["baixa", "media", "alta"];

function pctValido(valor, padrao = TOL_PADRAO) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 100) return padrao;
  return Math.round(n * 100) / 100;
}

async function lerTolerancias(db) {
  const [abaixo, acima] = await Promise.all([
    getSetting(db, CHAVE_TOL_ABAIXO),
    getSetting(db, CHAVE_TOL_ACIMA),
  ]);
  return {
    tol_abaixo_pct: abaixo === null || abaixo === undefined ? TOL_PADRAO : pctValido(abaixo),
    tol_acima_pct: acima === null || acima === undefined ? TOL_PADRAO : pctValido(acima),
  };
}

async function salvarTolerancias(db, { tol_abaixo_pct, tol_acima_pct }) {
  if (tol_abaixo_pct !== undefined) {
    await setSetting(db, CHAVE_TOL_ABAIXO, String(pctValido(tol_abaixo_pct)));
  }
  if (tol_acima_pct !== undefined) {
    await setSetting(db, CHAVE_TOL_ACIMA, String(pctValido(tol_acima_pct)));
  }
  return lerTolerancias(db);
}

/**
 * @returns {{ situacao: 'pendente'|'prejuizo'|'equilibrio'|'lucro', dentro: boolean, ok_auto: boolean, piso: number|null, teto: number|null }}
 */
function classificar(atualCentavos, idealCentavos, tolAbaixoPct, tolAcimaPct) {
  if (atualCentavos == null || idealCentavos == null) {
    return { situacao: "pendente", dentro: false, ok_auto: false, piso: null, teto: null };
  }
  const atual = Number(atualCentavos);
  const ideal = Number(idealCentavos);
  if (!Number.isFinite(atual) || !Number.isFinite(ideal) || ideal < 0) {
    return { situacao: "pendente", dentro: false, ok_auto: false, piso: null, teto: null };
  }
  const abaixo = pctValido(tolAbaixoPct) / 100;
  const acima = pctValido(tolAcimaPct) / 100;
  const piso = Math.round(ideal * (1 - abaixo));
  const teto = Math.round(ideal * (1 + acima));
  if (atual < piso) {
    return { situacao: "prejuizo", dentro: false, ok_auto: false, piso, teto };
  }
  if (atual > teto) {
    return { situacao: "lucro", dentro: true, ok_auto: true, piso, teto };
  }
  return { situacao: "equilibrio", dentro: true, ok_auto: true, piso, teto };
}

function okEfetivo(okManual, okAuto) {
  if (okManual === true || okManual === false) return okManual;
  return Boolean(okAuto);
}

function enumOuNull(valor, lista) {
  if (valor === null || valor === undefined || valor === "") return null;
  const v = String(valor);
  return lista.includes(v) ? v : undefined; // undefined = inválido
}

function centavosOuNull(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

module.exports = {
  CHAVE_TOL_ABAIXO,
  CHAVE_TOL_ACIMA,
  TOL_PADRAO,
  ENQUADRAMENTOS,
  TIPOS,
  COMPLEXIDADES,
  pctValido,
  lerTolerancias,
  salvarTolerancias,
  classificar,
  okEfetivo,
  enumOuNull,
  centavosOuNull,
};
