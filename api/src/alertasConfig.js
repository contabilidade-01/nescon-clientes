/**
 * Configuração operacional dos alertas — na tela, não no ambiente.
 *
 * Variável de ambiente é para o que o app precisa saber **antes de existir**: senha do
 * banco, token da uazapi, endereço público. "Ligar o envio automático" e "a que horas"
 * não são isso — são decisões do dia a dia, que mudam sem que nada seja reconstruído.
 *
 * Deixá-las no ambiente cobrava um redeploy por decisão e, pior, criava um modo de
 * falha silencioso: a variável precisa ser repassada pelo compose ao contentor, e a que
 * não estivesse listada lá simplesmente não chegava — a configuração parecia feita e
 * não valia nada.
 *
 * Mesma tabela e mesmo padrão da chave `ai_parsing` do fallback de IA.
 */
const { getSetting, setSetting } = require("./appSettings");

const CHAVES = {
  automatico: "alertas_envio_automatico",
  hora: "alertas_hora",
  escritorioCnpj: "escritorio_cnpj",
  // Cadência de cobrança do BOLETO (Cora). Antes só existia em variável de ambiente
  // (ALERTAS_BOLETO_*), o que cobrava redeploy e não aparecia na tela.
  boletoDiasAntes: "alertas_boleto_dias_antes",
  boletoCobrancaDias: "alertas_boleto_cobranca_dias",
};

/** Padrão do envio automático é **desligado**: ninguém começa a mandar mensagem por acidente. */
const HORA_PADRAO = 8;

// Padrões da cadência do boleto: o ambiente é só o valor INICIAL (instalação que já
// rodava antes desta tela); a tela é a fonte assim que alguém salvar. Preservam o
// comportamento histórico: avisar 1 dia antes e cobrar o vencido em 3, 10 e 30 dias.
const BOLETO_DIAS_ANTES_PADRAO = diasAntesValido(process.env.ALERTAS_BOLETO_DIAS_ANTES, 1);
const BOLETO_COBRANCA_PADRAO = parseCobrancaDias(process.env.ALERTAS_BOLETO_COBRANCA_DIAS, [3, 10, 30]);

function horaValida(valor, padrao = HORA_PADRAO) {
  const n = parseInt(valor, 10);
  if (!Number.isInteger(n) || n < 0 || n > 23) return padrao;
  return n;
}

/** Antecedência do lembrete do boleto, em dias. 0 = sem lembrete de véspera. */
function diasAntesValido(valor, padrao) {
  const n = parseInt(valor, 10);
  if (!Number.isInteger(n) || n < 0 || n > 30) return padrao;
  return n;
}

/**
 * "3,10,30" (ou array) -> [3,10,30]: inteiros positivos até 90, sem duplicatas, ordenados.
 * Lista vazia é resultado LEGÍTIMO (cobrança de vencido desligada). `padrao` só entra
 * quando o valor é nulo/indefinido — nunca para uma lista que o admin esvaziou de propósito.
 */
function parseCobrancaDias(valor, padrao = []) {
  if (valor === null || valor === undefined) return padrao;
  const bruto = Array.isArray(valor) ? valor : String(valor).split(",");
  const nums = bruto
    .map((s) => parseInt(String(s).trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 90);
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

async function lerConfig(db) {
  const [auto, hora, cnpj, diasAntes, cobranca] = await Promise.all([
    getSetting(db, CHAVES.automatico),
    getSetting(db, CHAVES.hora),
    getSetting(db, CHAVES.escritorioCnpj),
    getSetting(db, CHAVES.boletoDiasAntes),
    getSetting(db, CHAVES.boletoCobrancaDias),
  ]);
  return {
    envio_automatico: auto === "true",
    hora: horaValida(hora),
    // Fallback no ambiente só para não perder o que já estava configurado antes desta
    // tela existir. A tela é a fonte assim que alguém salvar.
    escritorio_cnpj: (cnpj || process.env.ESCRITORIO_CNPJ || "").replace(/\D/g, ""),
    boleto_dias_antes: diasAntes === null ? BOLETO_DIAS_ANTES_PADRAO : diasAntesValido(diasAntes, BOLETO_DIAS_ANTES_PADRAO),
    // null = nunca configurado → padrão; string (mesmo vazia) = escolha do admin.
    boleto_cobranca_dias: cobranca === null ? BOLETO_COBRANCA_PADRAO : parseCobrancaDias(cobranca),
  };
}

async function salvarConfig(db, { envio_automatico, hora, escritorio_cnpj, boleto_dias_antes, boleto_cobranca_dias }) {
  if (envio_automatico !== undefined) {
    await setSetting(db, CHAVES.automatico, Boolean(envio_automatico));
  }
  if (hora !== undefined) {
    await setSetting(db, CHAVES.hora, horaValida(hora));
  }
  if (escritorio_cnpj !== undefined) {
    const so = String(escritorio_cnpj || "").replace(/\D/g, "");
    await setSetting(db, CHAVES.escritorioCnpj, so || null);
  }
  if (boleto_dias_antes !== undefined) {
    await setSetting(db, CHAVES.boletoDiasAntes, diasAntesValido(boleto_dias_antes, BOLETO_DIAS_ANTES_PADRAO));
  }
  if (boleto_cobranca_dias !== undefined) {
    // Normaliza para "3,10,30" (ou "" se o admin desligou a cobrança de vencido).
    await setSetting(db, CHAVES.boletoCobrancaDias, parseCobrancaDias(boleto_cobranca_dias).join(","));
  }
  return lerConfig(db);
}

/** CNPJ do escritório, para o upload não alocar o documento do cliente para a contabilidade. */
async function cnpjDoEscritorio(db) {
  try {
    const { escritorio_cnpj } = await lerConfig(db);
    return escritorio_cnpj;
  } catch {
    return (process.env.ESCRITORIO_CNPJ || "").replace(/\D/g, "");
  }
}

module.exports = { CHAVES, lerConfig, salvarConfig, cnpjDoEscritorio, HORA_PADRAO };
