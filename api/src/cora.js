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
 * Mapeia status Cora para status do deliverable.
 */
function mapCoraStatusToPortal(coraStatus) {
  if (!coraStatus) return "pending";
  const status = String(coraStatus).toUpperCase();

  // Pago
  if (status === "PAID" || status === "PAGO") return "paid";

  // Não conta a pagar (canceled, rejected)
  if (status === "CANCELLED" || status === "CANCELADO") return "paid";

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
  if (!CORA_CONFIG.clientId) return false;

  // Base64 na env: preferido
  if (process.env.CORA_CERT_BASE64 && process.env.CORA_KEY_BASE64) return true;

  // Fallback: arquivos no disco
  try {
    return fs.existsSync(CORA_CONFIG.certificatePath) && fs.existsSync(CORA_CONFIG.privateKeyPath);
  } catch {
    return false;
  }
}

module.exports = {
  searchInvoices,
  getValidToken,
  mapCoraStatusToPortal,
  isConfigured,
  loadCertificates,
};
