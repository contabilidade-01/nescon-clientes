/**
 * Modo manutenção: um interruptor global que barra o CLIENTE (login e sessão), mostra uma
 * mensagem e o manda voltar depois — enquanto o escritório trabalha no portal. O ADMIN
 * continua entrando normalmente; é ele quem liga e desliga.
 *
 * Guardado em `app_settings` (na tela, não no ambiente — ligar/desligar não pode custar
 * um redeploy). Cache curto em memória para não consultar o banco a cada requisição
 * autenticada: a leitura roda no middleware de auth, que é o caminho mais quente do app.
 */
const { getSetting, setSetting } = require("./appSettings");

const CHAVE_ATIVO = "maintenance_mode";
const CHAVE_MSG = "maintenance_message";

/** Texto padrão quando o admin liga a manutenção sem escrever uma mensagem própria. */
const MENSAGEM_PADRAO =
  "Portal em manutenção no momento. Já já voltamos — tente novamente em instantes. " +
  "Qualquer urgência, fale com o escritório.";

const TTL_MS = 10000;
let cache = { ativo: false, mensagem: "", em: 0 };

/**
 * Estado atual. `mensagem` volta CRUA (pode ser ''): quem mostra ao cliente aplica o
 * padrão. Nunca lança — erro de leitura devolve "desligado", para uma falha de banco não
 * trancar o sistema em manutenção sem ninguém ter pedido.
 */
async function lerManutencao(db, { force = false } = {}) {
  const agora = Date.now();
  if (!force && agora - cache.em < TTL_MS) {
    return { ativo: cache.ativo, mensagem: cache.mensagem };
  }
  try {
    const [a, m] = await Promise.all([getSetting(db, CHAVE_ATIVO), getSetting(db, CHAVE_MSG)]);
    cache = { ativo: a === "true", mensagem: m || "", em: agora };
  } catch (err) {
    console.error("[manutencao] leitura falhou (assumindo desligado):", err.message);
    cache = { ativo: false, mensagem: "", em: agora };
  }
  return { ativo: cache.ativo, mensagem: cache.mensagem };
}

async function salvarManutencao(db, { ativo, mensagem }) {
  if (ativo !== undefined) await setSetting(db, CHAVE_ATIVO, Boolean(ativo));
  if (mensagem !== undefined) {
    const t = String(mensagem || "").trim();
    await setSetting(db, CHAVE_MSG, t || null);
  }
  cache.em = 0; // invalida o cache: a próxima leitura pega o valor novo
  return lerManutencao(db, { force: true });
}

module.exports = { lerManutencao, salvarManutencao, MENSAGEM_PADRAO };
