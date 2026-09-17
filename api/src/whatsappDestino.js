/**
 * Trava única do WhatsApp: **só fala com quem é cliente cadastrado no portal.**
 *
 * Regra do escritório: a instância uazapi só interage com clientes do app. Antes, cada
 * envio escolhia o número da empresa por conta própria, e o robô do webhook respondia a
 * qualquer número que escrevesse. Agora toda saída passa por `exigirDestinoPermitido`
 * (dentro de `uazapi.js`) e o webhook ignora em silêncio quem não é cliente.
 *
 * Quem é permitido:
 * - **cliente**: número (whatsapp, phone, ou o telefone do espelho G-Click) de empresa
 *   ativa — nem arquivada nem excluída.
 * - **escritório**: ADMIN_WHATSAPP, o WhatsApp do escritório configurado nos alertas e o
 *   do backup diário. São avisos internos, não mensagem a terceiros.
 *
 * Desligar em emergência: WHATSAPP_SO_CLIENTES=false no ambiente.
 */
const numeroWpp = require("./whatsappNumero");

const TTL_MS = 60000;
let cache = { clientes: null, escritorio: null, ts: 0 };

function travaLigada() {
  return process.env.WHATSAPP_SO_CLIENTES !== "false";
}

/**
 * Chave de comparação: DDD + últimos 8 dígitos. Ignora o 55 e o 9º dígito, porque o
 * cadastro tem o mesmo celular escrito com e sem eles. Função pura.
 */
function chaveNumero(valor) {
  let d = numeroWpp.normalizar(valor);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length < 10) return "";
  return d.slice(0, 2) + d.slice(-8);
}

/** Função pura: classifica um número contra os conjuntos de chaves. */
function classificarDestino(numero, { clientes, escritorio }) {
  const chave = chaveNumero(numero);
  if (!chave) return { ok: false, tipo: null, motivo: "Número inválido" };
  if (clientes.has(chave)) return { ok: true, tipo: "cliente" };
  if (escritorio.has(chave)) return { ok: true, tipo: "escritorio" };
  return {
    ok: false,
    tipo: null,
    motivo: "Número não pertence a nenhum cliente ativo cadastrado no portal",
  };
}

async function carregar(db) {
  const { rows } = await db.query(
    `SELECT c.whatsapp, c.phone, g.phone AS gclick_phone
       FROM companies c
       LEFT JOIN gclick_clients g ON g.company_id = c.id
      WHERE COALESCE(c.arquivada, false) = false
        AND COALESCE(c.excluida, false) = false`
  );
  const clientes = new Set();
  for (const r of rows) {
    for (const n of [r.whatsapp, r.phone, r.gclick_phone]) {
      const k = chaveNumero(n);
      if (k) clientes.add(k);
    }
  }

  const escritorio = new Set();
  const { getSetting } = require("./appSettings");
  const { lerConfig } = require("./alertasConfig");
  const internos = [process.env.ADMIN_WHATSAPP || "5511948626605"];
  internos.push(await getSetting(db, "backup_diario_whatsapp").catch(() => null));
  internos.push((await lerConfig(db).catch(() => ({}))).escritorio_whatsapp);
  for (const n of internos) {
    const k = chaveNumero(n);
    if (k) escritorio.add(k);
  }

  cache = { clientes, escritorio, ts: Date.now() };
  return cache;
}

/**
 * Pode mandar para este número? Usa cache de 1 minuto; se o número não estiver no cache,
 * recarrega uma vez antes de recusar (empresa cadastrada agora mesmo não fica de fora).
 */
async function destinoPermitido(numero, db = require("./db")) {
  if (!travaLigada()) return { ok: true, tipo: "trava_desligada" };
  let c = cache;
  if (!c.clientes || Date.now() - c.ts > TTL_MS) c = await carregar(db);
  let r = classificarDestino(numero, c);
  if (!r.ok && c.ts < Date.now() - 2000) r = classificarDestino(numero, await carregar(db));
  return r;
}

/** Só cliente (o webhook não conversa nem com o número do escritório como se fosse cliente). */
async function ehCliente(numero, db) {
  const r = await destinoPermitido(numero, db);
  return r.ok && r.tipo !== "escritorio";
}

function limparCache() {
  cache = { clientes: null, escritorio: null, ts: 0 };
}

module.exports = { chaveNumero, classificarDestino, destinoPermitido, ehCliente, limparCache, travaLigada };
