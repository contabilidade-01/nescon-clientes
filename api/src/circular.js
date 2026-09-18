/**
 * Envio da circular pelo WhatsApp: texto primeiro, depois o vídeo/imagem (duas mensagens,
 * escolha do escritório), uma empresa a cada ~30s.
 *
 * O ritmo é a parte importante. A instância é o número da Nescon — o mesmo dos alertas e
 * das guias. Disparar 76 mensagens em um minuto é o jeito mais rápido de o WhatsApp
 * restringir o número. Por isso: intervalo de 20 a 40s com sorteio (não parece robô),
 * só dentro da janela diurna, e para tudo se a instância cair.
 *
 * O laço roda em memória. Se a API reiniciar no meio, a circular volta como "pausada" e
 * o escritório retoma na tela — quem já recebeu não recebe de novo.
 */
const path = require("path");
const numeroWpp = require("./whatsappNumero");
const uazapi = require("./uazapi");
const { dentroDaJanela, descricaoJanela } = require("./janelaEnvio");
const { minutosSP } = require("./diasBancarios");

const INTERVALO_MIN_MS = Number(process.env.CIRCULAR_INTERVALO_MIN_MS || 20000);
const INTERVALO_MAX_MS = Number(process.env.CIRCULAR_INTERVALO_MAX_MS || 40000);
/** Pausa curta entre o texto e a mídia da MESMA empresa. */
const ENTRE_MENSAGENS_MS = 3000;

const rodando = new Set();
const pararPedido = new Set();

/** Intervalo sorteado entre duas empresas. Função pura (recebe o sorteio). */
function intervaloMs(sorteio = Math.random()) {
  return Math.round(INTERVALO_MIN_MS + sorteio * (INTERVALO_MAX_MS - INTERVALO_MIN_MS));
}

/**
 * Função pura: transforma as empresas escolhidas em linhas de envio.
 *
 * - número inválido/ausente → `sem_whatsapp` (fica registrado, não tenta);
 * - mesmo número em duas empresas → a segunda vira `duplicado` (a pessoa recebe uma vez);
 * - empresa que já recebeu (ou está na fila) nesta circular → fica de fora.
 */
function planejarEnvios(empresas, { jaNaCircular = new Set(), numerosJaUsados = new Set() } = {}) {
  const numeros = new Set(numerosJaUsados);
  const envios = [];
  for (const e of empresas) {
    if (jaNaCircular.has(e.id)) continue;
    const v = numeroWpp.validar(e.whatsapp);
    if (!v.ok) {
      envios.push({ company_id: e.id, empresa_nome: e.name, numero: null, status: "sem_whatsapp", erro: v.motivo });
      continue;
    }
    if (numeros.has(v.numero)) {
      envios.push({
        company_id: e.id,
        empresa_nome: e.name,
        numero: v.numero,
        status: "duplicado",
        erro: "Mesmo WhatsApp de outra empresa desta circular",
      });
      continue;
    }
    numeros.add(v.numero);
    envios.push({ company_id: e.id, empresa_nome: e.name, numero: v.numero, status: "pendente", erro: null });
  }
  return envios;
}

/** Tipo de mídia pelo mimetype. Só o que o WhatsApp mostra direto na conversa. */
function tipoDaMidia(mimetype, nome = "") {
  const m = String(mimetype || "").toLowerCase();
  if (/^image\/(jpeg|png|webp)$/.test(m) || /\.(jpe?g|png|webp)$/i.test(nome)) return "image";
  if (/^video\/(mp4|3gpp)$/.test(m) || /\.(mp4|3gp)$/i.test(nome)) return "video";
  return null;
}

function urlPublicaDaMidia(arquivo) {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  if (!base || !arquivo) return null;
  return `${base}/api/uploads/${arquivo.split(path.sep).join("/")}`;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function marcarCircular(db, id, status, erro = null) {
  await db.query(
    "UPDATE circulares SET status = $2, ultimo_erro = $3, atualizado_em = now() WHERE id = $1",
    [id, status, erro]
  );
}

/**
 * Esvazia a fila de uma circular. Não lança: o que falhar fica anotado na linha.
 */
async function processar(db, circularId) {
  if (rodando.has(circularId)) return;
  rodando.add(circularId);
  pararPedido.delete(circularId);
  try {
    const { rows: cs } = await db.query("SELECT * FROM circulares WHERE id = $1", [circularId]);
    const c = cs[0];
    if (!c) return;
    const midiaUrl = c.midia_arquivo ? urlPublicaDaMidia(c.midia_arquivo) : null;
    if (c.midia_arquivo && !midiaUrl) {
      await marcarCircular(db, circularId, "pausada", "PUBLIC_APP_URL não configurado: a mídia não tem link.");
      return;
    }
    await marcarCircular(db, circularId, "enviando");

    let primeira = true;
    for (;;) {
      if (pararPedido.has(circularId)) {
        await marcarCircular(db, circularId, "pausada", "Parada pelo escritório.");
        return;
      }
      if (!dentroDaJanela(minutosSP())) {
        await marcarCircular(db, circularId, "pausada", `Fora da janela de envio (${descricaoJanela()}). Retome durante o dia.`);
        return;
      }
      const { rows } = await db.query(
        `SELECT id, numero FROM circular_envios
          WHERE circular_id = $1 AND status = 'pendente'
          ORDER BY criado_em, empresa_nome LIMIT 1`,
        [circularId]
      );
      const e = rows[0];
      if (!e) break;

      if (!primeira) await espera(intervaloMs());
      primeira = false;

      try {
        if (c.texto) await uazapi.enviarTexto({ numero: e.numero, texto: c.texto, delayMs: 1500 });
        if (midiaUrl) {
          if (c.texto) await espera(ENTRE_MENSAGENS_MS);
          await uazapi.enviarMidia({ numero: e.numero, fileUrl: midiaUrl, tipo: c.midia_tipo, docName: c.midia_nome });
        }
        await db.query(
          "UPDATE circular_envios SET status = 'enviado', erro = NULL, enviado_em = now() WHERE id = $1",
          [e.id]
        );
      } catch (err) {
        await db.query("UPDATE circular_envios SET status = 'falhou', erro = $2 WHERE id = $1", [
          e.id,
          String(err.message || err).slice(0, 300),
        ]);
        // Instância caída: não adianta seguir queimando a fila.
        if (err instanceof uazapi.UazapiTokenInvalido || err instanceof uazapi.UazapiNaoConfigurado) {
          await marcarCircular(db, circularId, "pausada", err.message);
          return;
        }
      }
    }
    await marcarCircular(db, circularId, "concluida");
  } catch (err) {
    console.error("[circular] falhou:", err.message);
    await marcarCircular(db, circularId, "pausada", err.message).catch(() => {});
  } finally {
    rodando.delete(circularId);
    pararPedido.delete(circularId);
  }
}

function pedirParada(circularId) {
  if (rodando.has(circularId)) pararPedido.add(circularId);
  return rodando.has(circularId);
}

function estaRodando(circularId) {
  return rodando.has(circularId);
}

/** No arranque: circular que estava "enviando" perdeu o laço — vira "pausada" para retomar. */
async function recuperarNoArranque(db) {
  try {
    await db.query(
      `UPDATE circulares SET status = 'pausada',
              ultimo_erro = 'O sistema reiniciou durante o envio. Clique em retomar.', atualizado_em = now()
        WHERE status = 'enviando'`
    );
  } catch (err) {
    console.error("[circular] recuperar no arranque:", err.message);
  }
}

module.exports = {
  intervaloMs,
  planejarEnvios,
  tipoDaMidia,
  urlPublicaDaMidia,
  processar,
  pedirParada,
  estaRodando,
  recuperarNoArranque,
};
