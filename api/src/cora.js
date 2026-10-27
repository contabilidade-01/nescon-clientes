/**
 * Cliente HTTP para a API Cora (boletos).
 *
 * Autenticação mTLS com suporte a:
 * 1. Certificados em BASE64 via env (CORA_CERT_BASE64 / CORA_KEY_BASE64) — preferido em produção
 * 2. Certificados em arquivo no disco (CORA_CERT_PATH / CORA_KEY_PATH) — fallback local
 *
 * Mantém token em cache em memória (renovado 60s antes de expirar).
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

// Configuração da API Cora de Produção
const CORA_CONFIG = {
  clientId: process.env.CORA_CLIENT_ID || "",
  baseURL: "https://matls-clients.api.cora.com.br",
  authEndpoint: "/token",
  invoicesEndpoint: "/v2/invoices",
  // Fallback para arquivo no disco (se base64 não estiver disponível)
  certificatePath: process.env.CORA_CERT_PATH || path.join(__dirname, "../certificates/certificate.pem"),
  privateKeyPath: process.env.CORA_KEY_PATH || path.join(__dirname, "../certificates/private-key.key"),
};

// Cache do token
let tokenCache = {
  token: null,
  expiresAt: null,
};

/**
 * Carrega os certificados SSL.
 * Prioridade: env base64 > arquivo no disco.
 */
function loadCertificates() {
  // 1. Tentar base64 da env (deploy limpo, sem arquivo no disco)
  const certBase64 = process.env.CORA_CERT_BASE64;
  const keyBase64 = process.env.CORA_KEY_BASE64;

  if (certBase64 && keyBase64) {
    return {
      cert: Buffer.from(certBase64, "base64").toString("utf8"),
      key: Buffer.from(keyBase64, "base64").toString("utf8"),
    };
  }

  // 2. Fallback: arquivo no disco
  try {
    const certificate = fs.readFileSync(CORA_CONFIG.certificatePath, "utf8");
    const privateKey = fs.readFileSync(CORA_CONFIG.privateKeyPath, "utf8");
    return { cert: certificate, key: privateKey };
  } catch (error) {
    throw new Error(`Erro ao carregar certificados SSL: ${error.message}`);
  }
}

/**
 * Faz requisição HTTPS com certificados SSL mTLS.
 */
// Teto por requisição. Sem isto, uma conexão pendurada da Cora nunca resolvia a Promise
// e prendia um worker do mapLimit no coraSync para sempre. `unref` não se aplica a
// sockets aqui; o destroy() abaixo é o que libera.
const CORA_TIMEOUT_MS = Number(process.env.CORA_TIMEOUT_MS) || 30000;

function makeHTTPSRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const response = {
            statusCode: res.statusCode,
            headers: res.headers,
            data: data,
          };
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              response.json = JSON.parse(data);
            } catch (e) {
              response.json = null;
            }
            resolve(response);
          } else {
            // statusCode/headers no erro: a fila abaixo precisa deles para reconhecer o 429
            // e ler o Retry-After.
            const err = new Error(`HTTP ${res.statusCode}: ${data}`);
            err.statusCode = res.statusCode;
            err.headers = res.headers;
            reject(err);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    // Timeout de conexão/resposta: dispara `destroy`, que emite 'error' e rejeita a
    // Promise em vez de deixá-la pendurada indefinidamente.
    req.setTimeout(CORA_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout Cora após ${CORA_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/*
 * Fila única de requisições à Cora.
 *
 * A sync dispara a listagem de ~100 empresas (4 em paralelo) e, para cada boleto, o
 * detalhe; logo depois vêm a reconciliação, a conferência sem cadastro e a checagem da
 * cobrança. Tudo saía sem freio e a Cora respondia HTTP 429 (limite de requisições) para
 * quase tudo: em 27/10/2026 a sync terminou em 6 s com 94 erros e a cobrança do dia rodou
 * sem a consulta na Cora. Agora toda chamada passa por aqui: no máximo CORA_MAX_PARALELO
 * ao mesmo tempo, CORA_INTERVALO_MS entre uma saída e outra e, se mesmo assim vier 429
 * (ou 503), a fila INTEIRA pausa pelo Retry-After (ou backoff exponencial) e a chamada é
 * repetida até CORA_TENTATIVAS vezes.
 */
const CORA_MAX_PARALELO = Number(process.env.CORA_MAX_PARALELO) || 2;
const CORA_INTERVALO_MS = Number(process.env.CORA_INTERVALO_MS ?? 250);
const CORA_TENTATIVAS = Number(process.env.CORA_TENTATIVAS ?? 4);
const ESPERA_MAX_MS = 60000;

/**
 * Quanto esperar antes de repetir. Respeita o Retry-After (segundos ou data HTTP); sem
 * ele, 1 s, 2 s, 4 s... com um pouco de folga aleatória para os paralelos não voltarem
 * juntos. Função pura (o `aleatorio` é injetável para teste).
 */
function esperaParaRepetir(retryAfter, tentativa, agora = Date.now(), aleatorio = Math.random) {
  if (retryAfter != null && retryAfter !== "") {
    const seg = Number(retryAfter);
    if (Number.isFinite(seg) && seg >= 0) return Math.min(seg * 1000, ESPERA_MAX_MS);
    const data = Date.parse(retryAfter);
    if (!Number.isNaN(data)) return Math.min(Math.max(data - agora, 0), ESPERA_MAX_MS);
  }
  const base = 1000 * 2 ** tentativa;
  return Math.min(base + Math.floor(aleatorio() * 500), ESPERA_MAX_MS);
}

function ehLimite(err) {
  return err && (err.statusCode === 429 || err.statusCode === 503);
}

/**
 * Cria a fila. Exposta (com dependências injetáveis) só para o teste; o módulo usa uma
 * instância única, compartilhada por todos os chamadores.
 */
function criarFila({
  maxParalelo = CORA_MAX_PARALELO,
  intervaloMs = CORA_INTERVALO_MS,
  tentativas = CORA_TENTATIVAS,
  dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.warn,
} = {}) {
  let ativos = 0;
  let proximaSaida = 0;
  let pausaAte = 0;
  let timer = null;
  const aguardando = [];

  function bombear() {
    if (timer) return;
    while (ativos < maxParalelo && aguardando.length) {
      const agora = Date.now();
      const livre = Math.max(proximaSaida, pausaAte);
      if (agora < livre) {
        timer = setTimeout(() => {
          timer = null;
          bombear();
        }, livre - agora);
        return;
      }
      ativos++;
      proximaSaida = agora + intervaloMs;
      aguardando.shift()();
    }
  }

  function vez() {
    return new Promise((resolve) => {
      aguardando.push(resolve);
      bombear();
    });
  }

  function liberar() {
    ativos--;
    bombear();
  }

  return async function executar(fn) {
    for (let tentativa = 0; ; tentativa++) {
      await vez();
      let espera = 0;
      try {
        return await fn();
      } catch (err) {
        if (!ehLimite(err) || tentativa >= tentativas) throw err;
        espera = esperaParaRepetir(err.headers?.["retry-after"], tentativa);
        // Pausa a fila toda: quem está esperando também bateria no limite.
        pausaAte = Math.max(pausaAte, Date.now() + espera);
        log(`[cora] HTTP ${err.statusCode}: aguardando ${Math.ceil(espera / 1000)}s (tentativa ${tentativa + 1}/${tentativas})`);
      } finally {
        liberar();
      }
      await dormir(espera);
    }
  };
}

const filaCora = criarFila();

/** Toda requisição à Cora passa por aqui (limite de ritmo + repetição no 429). */
function requisicaoCora(options, postData = null) {
  return filaCora(() => makeHTTPSRequest(options, postData));
}

/**
 * Obtém token válido (com cache).
 */
async function getValidToken() {
  try {
    // Verificar se o token em cache ainda é válido
    if (tokenCache.token && tokenCache.expiresAt && Date.now() < tokenCache.expiresAt) {
      return tokenCache.token;
    }

    // Carregar certificados SSL
    const sslCertificates = loadCertificates();

    // Fazer autenticação
    const postData = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CORA_CONFIG.clientId,
    }).toString();

    const authOptions = {
      hostname: "matls-clients.api.cora.com.br",
      port: 443,
      path: CORA_CONFIG.authEndpoint,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        Accept: "application/json",
      },
      cert: sslCertificates.cert,
      key: sslCertificates.key,
    };

    const response = await requisicaoCora(authOptions, postData);

    // Cachear o token (1 minuto antes do vencimento)
    tokenCache.token = response.json.access_token;
    tokenCache.expiresAt = Date.now() + response.json.expires_in * 1000 - 60000;

    console.log("[cora] token obtido com sucesso");
    return response.json.access_token;
  } catch (error) {
    console.error("[cora] erro ao obter token:", error.message);
    throw error;
  }
}

/**
 * Busca boletos por CNPJ e filtros opcionais.
 */
async function searchInvoices(cnpj, options = {}) {
  try {
    const sslCertificates = loadCertificates();
    const token = await getValidToken();

    const queryParams = new URLSearchParams({
      page: options.page || 1,
      perPage: Math.min(options.perPage || 100, 200), // Máximo 200
      // Sem CNPJ = listagem geral (usada para achar boleto de quem não está no cadastro).
      ...(cnpj && { search: cnpj }),
      ...(options.start && { start: options.start }),
      ...(options.end && { end: options.end }),
      ...(options.state && { state: options.state }),
    });

    const requestOptions = {
      hostname: "matls-clients.api.cora.com.br",
      port: 443,
      path: `${CORA_CONFIG.invoicesEndpoint}?${queryParams}`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      cert: sslCertificates.cert,
      key: sslCertificates.key,
    };

    const response = await requisicaoCora(requestOptions);
    return response.json;
  } catch (error) {
    console.error(`[cora] erro ao buscar boletos para ${cnpj}:`, error.message);
    throw error;
  }
}

/**
 * Busca detalhes de um boleto específico (inclui payment_options com PDF URL).
 */
async function getInvoiceDetail(invoiceId) {
  try {
    const sslCertificates = loadCertificates();
    const token = await getValidToken();

    const requestOptions = {
      hostname: "matls-clients.api.cora.com.br",
      port: 443,
      path: `/v2/invoices/${invoiceId}`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      cert: sslCertificates.cert,
      key: sslCertificates.key,
    };

    const response = await requisicaoCora(requestOptions);
    return response.json;
  } catch (error) {
    console.error(`[cora] erro ao buscar detalhe do boleto ${invoiceId}:`, error.message);
    return null;
  }
}

/**
 * Mapeia status Cora para status do deliverable.
 */
/**
 * O boleto foi cancelado/rejeitado na Cora?
 *
 * Existe separado de `mapCoraStatusToPortal` porque "cancelado" não cabe no par
 * pendente/pago do portal: não é dívida, mas também não foi pago por ninguém. Tratá-lo
 * como pago mostrava "Pago" para o cliente num boleto que ninguém quitou e inflava o
 * total de pagos do painel. Quem decide o que fazer com ele é `coraSync`, gravando a
 * coluna `cancelado` — e aí ele some das telas sem sumir do banco.
 */
function ehCancelado(coraStatus) {
  const status = String(coraStatus || "").toUpperCase();
  return ["CANCELLED", "CANCELED", "CANCELADO", "REJECTED", "REJEITADO"].includes(status);
}

function mapCoraStatusToPortal(coraStatus) {
  if (!coraStatus) return "pending";
  const status = String(coraStatus).toUpperCase();

  // Pago
  if (status === "PAID" || status === "PAGO") return "paid";

  // Cancelado NÃO é pago. Antes esta função devolvia 'paid' aqui como fallback, o que
  // era uma armadilha: cancelado não é dívida, mas ninguém quitou. Quem trata cancelado
  // é `coraSync` via `ehCancelado` (grava a coluna `cancelado` e o boleto some da tela),
  // então este caminho é morto na prática. Devolvemos 'pending' — o valor conservador e
  // honesto — para que, se alguém um dia chamar esta função sem consultar `ehCancelado`,
  // o boleto NÃO apareça falsamente como pago.
  if (ehCancelado(status)) return "pending";

  // Aberto/Atrasado conta como pendente
  if (["OPEN", "PENDING", "ABERTO", "PENDENTE", "LATE", "OVERDUE", "VENCIDO", "DRAFT", "RECURRENCE_DRAFT"].includes(status)) {
    return "pending";
  }

  // Default: pendente (conservador)
  return "pending";
}

/**
 * Checa se a Cora está configurada.
 * Precisa de: CORA_CLIENT_ID + (base64 env OU arquivos no disco).
 */
function isConfigured() {
  const clientId = process.env.CORA_CLIENT_ID || "";
  if (!clientId) return false;

  // Base64 na env: preferido
  if (process.env.CORA_CERT_BASE64 && process.env.CORA_KEY_BASE64) return true;

  // Fallback: arquivos no disco
  try {
    const certPath = process.env.CORA_CERT_PATH || path.join(__dirname, "../certificates/certificate.pem");
    const keyPath = process.env.CORA_KEY_PATH || path.join(__dirname, "../certificates/private-key.key");
    return fs.existsSync(certPath) && fs.existsSync(keyPath);
  } catch {
    return false;
  }
}

/**
 * Diagnóstico: retorna o que está configurado (sem revelar valores sensíveis).
 */
function diagnostico() {
  return {
    clientId: process.env.CORA_CLIENT_ID ? `${process.env.CORA_CLIENT_ID.slice(0, 8)}...` : "(vazio)",
    certBase64: process.env.CORA_CERT_BASE64 ? `${process.env.CORA_CERT_BASE64.length} chars` : "(vazio)",
    keyBase64: process.env.CORA_KEY_BASE64 ? `${process.env.CORA_KEY_BASE64.length} chars` : "(vazio)",
    certPath: process.env.CORA_CERT_PATH || "(default)",
    keyPath: process.env.CORA_KEY_PATH || "(default)",
    configurado: isConfigured(),
  };
}

module.exports = {
  searchInvoices,
  getInvoiceDetail,
  getValidToken,
  mapCoraStatusToPortal,
  ehCancelado,
  isConfigured,
  loadCertificates,
  diagnostico,
  // expostos para teste
  criarFila,
  esperaParaRepetir,
};
