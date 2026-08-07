/**
 * De onde sai o segredo que assina os tokens.
 *
 * A versão anterior tinha um padrão no código — quem lesse o repositório forjava token
 * de administrador. Trocá-lo por "a API não sobe sem segredo" fechou o buraco, mas
 * empurrou para o operador uma tarefa que a máquina faz melhor: gerar 32 bytes
 * aleatórios. Tarefa manual em deploy é tarefa esquecida em deploy.
 *
 * Três fontes, nesta ordem:
 *
 *  1. **`JWT_SECRET` no ambiente** — continua ganhando. É o que permite rotacionar o
 *     segredo de fora e derrubar todas as sessões de propósito.
 *  2. **`app_settings`** — se não veio do ambiente, usa o que já foi gerado antes.
 *     Vive no Postgres, que é o volume com backup diário; sobrevive a redeploy, que é o
 *     que importa: segredo que muda a cada deploy desloga todo mundo toda vez.
 *  3. **Gera um novo** na primeira subida e grava. Aleatório, único por instalação, e
 *     em lugar nenhum do repositório.
 *
 * Guardar no banco significa que quem tem o banco forja token. É um degrau a menos que
 * o ideal — mas quem tem o banco já tem os dados todos, então não abre porta nova. E é
 * muitos degraus acima de um padrão versionado, que era a situação real.
 *
 * Os valores de exemplo continuam recusados: se alguém colar
 * `troque-este-segredo-em-producao` no painel, é tratado como ausente.
 */
const crypto = require("crypto");
const { getSetting, setSetting } = require("./appSettings");

const CHAVE = "jwt_secret";
const TAMANHO_MINIMO = 32;

/** Padrões que já circularam no repositório e no compose. Valem como "não definido". */
const PROIBIDOS = new Set([
  "change-this-secret-in-production",
  "troque-este-segredo-em-producao",
  "defina_um_segredo_jwt_longo",
  "secret",
  "changeme",
]);

function utilizavel(s) {
  const v = String(s || "").trim();
  if (!v || v.length < TAMANHO_MINIMO) return null;
  if (PROIBIDOS.has(v.toLowerCase())) return null;
  return v;
}

let emUso = null;

/**
 * Resolve o segredo. Chamado uma vez no arranque, antes de qualquer token ser assinado.
 * Devolve `{ origem }` para o log dizer de onde veio — sem nunca imprimir o valor.
 */
async function resolverJwtSecret(db) {
  const doAmbiente = utilizavel(process.env.JWT_SECRET);
  if (doAmbiente) {
    emUso = doAmbiente;
    return { origem: "ambiente" };
  }

  if (process.env.JWT_SECRET) {
    console.warn(
      "[SEGURANCA] JWT_SECRET do ambiente foi ignorado (valor de exemplo ou com menos de " +
        `${TAMANHO_MINIMO} caracteres). Usando o segredo da instalacao.`
    );
  }

  const guardado = utilizavel(await getSetting(db, CHAVE));
  if (guardado) {
    emUso = guardado;
    return { origem: "instalacao" };
  }

  const novo = crypto.randomBytes(48).toString("base64url");
  await setSetting(db, CHAVE, novo);
  emUso = novo;
  return { origem: "gerado" };
}

/**
 * O segredo em uso. Lançar quando não há é deliberado: assinar com `undefined` faria a
 * biblioteca aceitar QUALQUER token depois, e a falha apareceria como invasão, não como
 * erro.
 */
function jwtSecret() {
  if (!emUso) {
    throw new Error(
      "JWT_SECRET ainda não foi resolvido — resolverJwtSecret(db) precisa rodar no arranque."
    );
  }
  return emUso;
}

/** Só para teste: injeta um segredo sem passar pelo banco. */
function definirParaTeste(valor) {
  emUso = utilizavel(valor) || null;
}

module.exports = { resolverJwtSecret, jwtSecret, definirParaTeste, CHAVE, TAMANHO_MINIMO };
