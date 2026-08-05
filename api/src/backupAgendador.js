/**
 * Rotina diária do backup: gera, confere, e entrega por dois canais separados.
 *
 * **O arquivo vai por e-mail, cifrado. O WhatsApp recebe só o resumo.** A separação é o
 * ponto: o resumo é o que faz alguém PERCEBER que parou de chegar — cron silencioso
 * falha meses sem ninguém notar —, e o WhatsApp é onde o escritório olha todo dia. Já o
 * arquivo carrega dado pessoal de terceiros e não tem por que passar por lá.
 *
 * Se o e-mail falhar mas o WhatsApp sair, a mensagem diz isso. Backup que se dá por
 * feito sem ter sido entregue é o pior dos dois mundos.
 */
const { getSetting, setSetting } = require("./appSettings");
const { executarBackup, mensagemResumo, configurado } = require("./backup");
const { sendBackupEmail, isSmtpConfigured } = require("./mailer");
const uazapi = require("./uazapi");
const numeroWpp = require("./whatsappNumero");
const { hojeSP } = require("./diasBancarios");
const { horaSP } = require("./alertasEnvio");

const CHAVES = {
  ativo: "backup_diario_ativo",
  hora: "backup_diario_hora",
  email: "backup_diario_email",
  whatsapp: "backup_diario_whatsapp",
};

const HORA_PADRAO = 3; // madrugada: pg_dump segura conexões e o portal fica ocioso

function horaValida(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : HORA_PADRAO;
}

async function lerConfig(db) {
  const [ativo, hora, email, whatsapp] = await Promise.all([
    getSetting(db, CHAVES.ativo),
    getSetting(db, CHAVES.hora),
    getSetting(db, CHAVES.email),
    getSetting(db, CHAVES.whatsapp),
  ]);
  return {
    ativo: ativo === "true",
    hora: horaValida(hora),
    email: email || "",
    whatsapp: whatsapp || "",
    // O painel precisa distinguir "desligado" de "não dá para ligar".
    senha_configurada: configurado(),
    smtp_configurado: isSmtpConfigured(),
  };
}

async function salvarConfig(db, { ativo, hora, email, whatsapp }) {
  if (ativo !== undefined) await setSetting(db, CHAVES.ativo, Boolean(ativo));
  if (hora !== undefined) await setSetting(db, CHAVES.hora, horaValida(hora));
  if (email !== undefined) await setSetting(db, CHAVES.email, String(email || "").trim() || null);
  if (whatsapp !== undefined) {
    const v = numeroWpp.validar(whatsapp);
    if (whatsapp && !v.ok) return { erro: v.motivo };
    await setSetting(db, CHAVES.whatsapp, v.ok ? v.numero : null);
  }
  return lerConfig(db);
}

/**
 * Faz o backup e entrega. `db` é o pool; devolve o relatório sem o arquivo — quem chama
 * é uma rota HTTP e o binário não tem por que trafegar de volta.
 */
async function rodarEEntregar(db) {
  const cfg = await lerConfig(db);
  const r = await executarBackup(db);
  if (r.erro) return { ok: false, erro: r.erro };

  const entregas = { email: null, whatsapp: null };

  if (cfg.email && isSmtpConfigured()) {
    try {
      await sendBackupEmail({
        to: cfg.email,
        nome: r.nome,
        arquivo: r.arquivo,
        resumo: mensagemResumo(r),
      });
      entregas.email = "enviado";
    } catch (err) {
      entregas.email = `falhou: ${err.message}`;
      console.error("[backup] e-mail:", err.message);
    }
  } else {
    entregas.email = cfg.email ? "SMTP não configurado" : "sem destinatário";
  }

  if (cfg.whatsapp && uazapi.configurado()) {
    try {
      // A mensagem avisa quando o arquivo NÃO foi entregue: saber que o backup rodou
      // não serve de nada se ele não chegou a lugar nenhum.
      const aviso =
        entregas.email === "enviado"
          ? ""
          : `\n\n⚠️ O arquivo NÃO foi enviado por e-mail (${entregas.email}).`;
      await uazapi.enviarTexto({ numero: cfg.whatsapp, texto: mensagemResumo(r) + aviso });
      entregas.whatsapp = "enviado";
    } catch (err) {
      entregas.whatsapp = `falhou: ${err.message}`;
      console.error("[backup] whatsapp:", err.message);
    }
  } else {
    entregas.whatsapp = cfg.whatsapp ? "uazapi não configurada" : "sem destinatário";
  }

  return {
    ok: r.ok,
    problemas: r.problemas,
    nome: r.nome,
    tamanho: r.tamanho,
    linhas: r.linhas,
    segundos: r.segundos,
    entregas,
  };
}

let ultimoDia = null;

/** Mesmo desenho do agendador de alertas: confere a cada 15 min, config lida a cada ciclo. */
function iniciarAgendadorBackup(db) {
  const tique = async () => {
    try {
      const cfg = await lerConfig(db);
      if (!cfg.ativo) return;
      const dia = hojeSP();
      if (ultimoDia === dia) return;
      if (horaSP() < cfg.hora) return;
      ultimoDia = dia;
      const r = await rodarEEntregar(db);
      console.log(
        `[backup] ${dia}: ${r.ok ? "ok" : "COM PROBLEMA"} · ${r.tamanho ?? "-"} · ` +
          `e-mail ${r.entregas?.email} · whatsapp ${r.entregas?.whatsapp}`
      );
    } catch (err) {
      console.error("[backup] ciclo diário:", err.message);
    }
  };
  setInterval(tique, 15 * 60 * 1000);
  setTimeout(tique, 3 * 60 * 1000);
  console.log("[backup] agendador de pé; ligar/desligar é na tela.");
}

module.exports = { lerConfig, salvarConfig, rodarEEntregar, iniciarAgendadorBackup };
