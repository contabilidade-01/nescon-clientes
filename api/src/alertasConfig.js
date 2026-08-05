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
};

/** Padrão do envio automático é **desligado**: ninguém começa a mandar mensagem por acidente. */
const HORA_PADRAO = 8;

function horaValida(valor, padrao = HORA_PADRAO) {
  const n = parseInt(valor, 10);
  if (!Number.isInteger(n) || n < 0 || n > 23) return padrao;
  return n;
}

async function lerConfig(db) {
  const [auto, hora, cnpj] = await Promise.all([
    getSetting(db, CHAVES.automatico),
    getSetting(db, CHAVES.hora),
    getSetting(db, CHAVES.escritorioCnpj),
  ]);
  return {
    envio_automatico: auto === "true",
    hora: horaValida(hora),
    // Fallback no ambiente só para não perder o que já estava configurado antes desta
    // tela existir. A tela é a fonte assim que alguém salvar.
    escritorio_cnpj: (cnpj || process.env.ESCRITORIO_CNPJ || "").replace(/\D/g, ""),
  };
}

async function salvarConfig(db, { envio_automatico, hora, escritorio_cnpj }) {
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
