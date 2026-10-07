/**
 * Lembretes automáticos de prazo do onboarding.
 *
 * A regra de QUEM merece lembrete hoje é pura e vive em onboardingRegras.js
 * (lembretesDevidos). Aqui só há banco, e-mail e agendador.
 *
 * - Nasce DESLIGADO (chave `onboarding_lembretes_ativo`): ninguém deve começar a escrever
 *   para cliente por acidente de deploy. Liga na tela Onboarding.
 * - Só manda em dia útil e dentro da janela diurna (janelaEnvio.js), como todo aviso do portal.
 * - Cada lembrete (item + marco) sai uma única vez: fica gravado em `onboarding_eventos`
 *   (tipo 'lembrete', detalhe 'itemId:marco|título'). Se o e-mail falha ou não há SMTP, nada
 *   é marcado e a próxima rodada tenta de novo.
 */
const { getBoolSetting } = require("./appSettings");
const { lembretesDevidos } = require("./onboardingRegras");
const { hojeSP, minutosSP } = require("./diasBancarios");
const { dentroDaJanela, ehDiaUtil } = require("./janelaEnvio");
const { enviarEmailContrato } = require("./contratosMail");
const { linkDoOnboarding, registrarEvento, statusPorItem } = require("./onboardingServico");

const CHAVE_LEMBRETES = "onboarding_lembretes_ativo";

function dataBR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Frase do prazo de um item no e-mail: "vence amanhã", "venceu há 3 dias"… */
function situacaoDoPrazo(dias, prazoData) {
  if (dias < 0) return `vence em ${dataBR(prazoData)}`;
  if (dias === 0) return "vence hoje";
  return `venceu em ${dataBR(prazoData)} (${dias} dia${dias === 1 ? "" : "s"} de atraso)`;
}

function montarEmail(onb, devidos) {
  const atrasados = devidos.some((d) => d.dias > 0);
  const link = linkDoOnboarding(onb.token_publico);
  return {
    para: [onb.cliente_email],
    assunto: atrasados ? "Falta pouco: documentos pendentes na Nescon" : "Lembrete: documentos para a Nescon",
    linhas: [
      `Olá${onb.cliente_nome ? `, ${onb.cliente_nome}` : ""}!`,
      devidos.length === 1 ? "Ainda precisamos de um documento seu:" : `Ainda precisamos de ${devidos.length} documentos seus:`,
      ...devidos.map((d) => `• ${d.item.titulo} — ${situacaoDoPrazo(d.dias, d.item.prazoData)}`),
      "Você envia pelo link abaixo, direto do celular ou do computador. Se já enviou e não chegou, avise a gente.",
      "Nescon Contabilidade",
    ],
    link: link ? { texto: "Enviar meus documentos", url: link } : null,
  };
}

/**
 * Uma rodada. `simular` só devolve o que sairia. Devolve { onboardings, lembretes, enviados, falhas, detalhes }.
 */
async function enviarLembretes(db, { simular = false, hoje = hojeSP() } = {}) {
  const { rows } = await db.query(`SELECT * FROM onboardings WHERE status <> 'concluido' ORDER BY created_at`);
  const r = { onboardings: 0, lembretes: 0, enviados: 0, falhas: 0, detalhes: [] };
  for (const onb of rows) {
    const ja = await db.query(`SELECT detalhe FROM onboarding_eventos WHERE onboarding_id = $1 AND tipo = 'lembrete'`, [onb.id]);
    const jaEnviados = new Set(ja.rows.map((e) => String(e.detalhe).split("|")[0]));
    const devidos = lembretesDevidos(onb.itens, await statusPorItem(db, onb.id), hoje, jaEnviados);
    if (!devidos.length) continue;
    r.onboardings += 1;
    r.lembretes += devidos.length;
    const registro = { cliente: onb.cliente_nome, itens: devidos.map((d) => d.item.titulo), email: onb.cliente_email };
    if (simular) {
      r.detalhes.push({ ...registro, enviado: false });
      continue;
    }
    let enviado = false;
    try {
      enviado = await enviarEmailContrato(montarEmail(onb, devidos));
    } catch (err) {
      console.error("[onboarding] lembrete falhou:", err.message);
    }
    if (enviado) {
      for (const d of devidos) await registrarEvento(db, onb.id, "lembrete", `${d.chave}|${d.item.titulo}`);
      r.enviados += 1;
    } else {
      r.falhas += 1;
    }
    r.detalhes.push({ ...registro, enviado });
  }
  return r;
}

/** Confere a cada 30 minutos; só age ligado, em dia útil e dentro da janela diurna. */
function iniciarAgendadorLembretes(db) {
  const tique = async () => {
    try {
      if (!(await getBoolSetting(db, CHAVE_LEMBRETES, false))) return;
      if (!ehDiaUtil() || !dentroDaJanela(minutosSP())) return;
      const r = await enviarLembretes(db);
      if (r.enviados || r.falhas) console.log(`[onboarding] lembretes: ${r.enviados} enviado(s), ${r.falhas} falha(s).`);
    } catch (err) {
      console.error("[onboarding] agendador de lembretes:", err.message);
    }
  };
  setInterval(tique, 30 * 60 * 1000).unref();
  setTimeout(tique, 60 * 1000).unref();
}

module.exports = { CHAVE_LEMBRETES, enviarLembretes, iniciarAgendadorLembretes, montarEmail, situacaoDoPrazo };
