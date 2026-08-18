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
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
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

    const response = await makeHTTPSRequest(authOptions, postData);

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
      search: cnpj,
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

    const response = await makeHTTPSRequest(requestOptions);
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

    const response = await makeHTTPSRequest(requestOptions);
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
};
