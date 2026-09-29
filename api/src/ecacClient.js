/**
 * Cliente HTTP do central-ecac (`/api/interno/*`).
 *
 * O central-ecac é a FONTE das pendências e o emissor de guias; este módulo é a única
 * porta por onde o portal fala com ele. Tudo passa pelo cabeçalho `X-Integracao-Token`
 * (nunca na URL) e por um timeout — a SERPRO leva segundos para emitir uma guia, e uma
 * chamada travada não pode segurar o agendador.
 *
 * Erros distinguidos de propósito, como no uazapi:
 *   EcacNaoConfigurado  falta ECAC_API_URL / ECAC_INTEGRACAO_TOKEN → nada a fazer;
 *   EcacIndisponivel    rede/timeout/5xx → transitório, quem chama tenta depois;
 *   EcacRecusou         4xx com mensagem legível (teto, procuração, limite diário,
 *                       empresa sem cadastro) → mostrar ao usuário, não repetir.
 */

class EcacNaoConfigurado extends Error {}
class EcacIndisponivel extends Error {}
class EcacRecusou extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function credenciais() {
  return {
    base: (process.env.ECAC_API_URL || "").trim().replace(/\/+$/, ""),
    token: (process.env.ECAC_INTEGRACAO_TOKEN || "").trim(),
  };
}

function configurado() {
  const { base, token } = credenciais();
  return Boolean(base && token.length >= 32);
}

function soDigitos(v) {
  return String(v || "").replace(/\D/g, "");
}

async function chamar(caminho, { metodo = "GET", corpo = null, timeoutMs = 30000, binario = false } = {}) {
  if (!configurado()) {
    throw new EcacNaoConfigurado("ECAC_API_URL/ECAC_INTEGRACAO_TOKEN não configurados (token com 32+ caracteres).");
  }
  const { base, token } = credenciais();
  const controle = new AbortController();
  const t = setTimeout(() => controle.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${base}/api/interno${caminho}`, {
      method: metodo,
      headers: {
        "X-Integracao-Token": token,
        ...(corpo ? { "Content-Type": "application/json" } : {}),
        Accept: binario ? "application/pdf" : "application/json",
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controle.signal,
    });
  } catch (err) {
    throw new EcacIndisponivel(`central-ecac inacessível: ${err.name === "AbortError" ? "timeout" : err.message}`);
  } finally {
    clearTimeout(t);
  }

  if (binario && res.ok) {
    return Buffer.from(await res.arrayBuffer());
  }

  let dados = null;
  const texto = await res.text();
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }
  if (res.ok) return dados;

  const mensagem = (dados && dados.message) || `HTTP ${res.status}`;
  if (res.status >= 500 || res.status === 401 || res.status === 503) {
    // 401/503 = configuração (token errado ou integração desligada lá): não é o cliente
    // que resolve, e repetir não ajuda — mas também não é "recusa de negócio".
    throw new EcacIndisponivel(`central-ecac: ${mensagem}`);
  }
  throw new EcacRecusou(res.status, mensagem);
}

/** Saúde + teto de gasto do central-ecac. */
function ping() {
  return chamar("/ping", { timeoutMs: 10000 });
}

/** Carteira inteira (custo zero lá). `desde` = 'AAAA-MM-DD' marca o que é "recente". */
async function pendencias({ desde = null } = {}) {
  const q = desde ? `?desde=${encodeURIComponent(desde)}` : "";
  const r = await chamar(`/pendencias${q}`, { timeoutMs: 120000 });
  return r && Array.isArray(r.empresas) ? r.empresas : [];
}

/** Uma empresa (custo zero lá). */
async function pendenciasEmpresa(cnpj, { desde = null } = {}) {
  const q = desde ? `?desde=${encodeURIComponent(desde)}` : "";
  const r = await chamar(`/pendencias/${soDigitos(cnpj)}${q}`, { timeoutMs: 30000 });
  return r ? r.empresa : null;
}

/**
 * Emite (ou reaproveita) uma guia. PAGO quando não há PDF válido guardado lá.
 * Devolve `{ reuso, emissao: {id, tipo, periodo_apuracao, vencimento, valor_total, ...} }`.
 */
async function emitirGuia({ cnpj, tipo, periodoApuracao, dataConsolidacao = null, categoria = null, origem = "portal", solicitadoPor = null, forcar = false }) {
  return chamar("/das/emitir", {
    metodo: "POST",
    timeoutMs: 90000,
    corpo: {
      cnpj: soDigitos(cnpj),
      tipo,
      periodo_apuracao: soDigitos(periodoApuracao),
      data_consolidacao: dataConsolidacao ? soDigitos(dataConsolidacao) : null,
      categoria,
      origem,
      solicitado_por: solicitadoPor,
      forcar: Boolean(forcar),
    },
  });
}

/** PDF guardado de uma emissão. O CNPJ vai junto: lá é recusado se não for o dono. */
function pdfGuia(emissaoId, cnpj) {
  return chamar(`/das/${Number(emissaoId)}/pdf?cnpj=${soDigitos(cnpj)}`, { timeoutMs: 30000, binario: true });
}

/** Emissões (eventos) de uma empresa a partir de uma data ISO. */
async function emissoes({ cnpj = null, desde = null } = {}) {
  const p = new URLSearchParams();
  if (cnpj) p.set("cnpj", soDigitos(cnpj));
  if (desde) p.set("desde", desde);
  const r = await chamar(`/das/emissoes?${p.toString()}`, { timeoutMs: 30000 });
  return r && Array.isArray(r.emissoes) ? r.emissoes : [];
}

/** Pede para regerar a situação fiscal da empresa daqui a N dias úteis. */
function reprocessar({ cnpj, diasUteis = 5, motivo = "recalculo_guia", origem = "portal" }) {
  return chamar("/reprocessar", {
    metodo: "POST",
    timeoutMs: 15000,
    corpo: { cnpj: soDigitos(cnpj), dias_uteis: diasUteis, motivo, origem },
  });
}

module.exports = {
  configurado,
  ping,
  pendencias,
  pendenciasEmpresa,
  emitirGuia,
  pdfGuia,
  emissoes,
  reprocessar,
  EcacNaoConfigurado,
  EcacIndisponivel,
  EcacRecusou,
};
