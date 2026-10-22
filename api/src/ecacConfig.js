/**
 * Configuração da cobrança de pendências do e-CAC — fica na TELA (app_settings), não em
 * variável de ambiente, pelo mesmo motivo dos alertas: ligar/desligar é decisão do dia a
 * dia e não pode custar um redeploy.
 *
 * Padrões nascem DESLIGADOS. Desde o desvio 20 o motor NUNCA fala com o cliente: toda
 * mensagem automática vai para o escritório (e para o contato da equipe, se houver) como
 * lembrete; o alerta ao cliente é manual, por empresa, no painel (permissão própria).
 * `modo_teste` fica sempre true — a chave antiga é ignorada.
 */
const { getSetting, setSetting } = require("./appSettings");
const { lerConfig: lerConfigAlertas } = require("./alertasConfig");
const { CFG_PADRAO } = require("./ecacRegras");

const CHAVES = {
  importacaoAtiva: "ecac_importacao_ativa",
  diaImportacao: "ecac_dia_importacao",
  envioAtivo: "ecac_envio_ativo",
  modoTeste: "ecac_modo_teste",
  diasLembrete: "ecac_dias_lembrete",
  diasRegeracao: "ecac_dias_regeracao",
  diasCobranca: "ecac_dias_cobranca",
  maxRegeracoes: "ecac_max_regeracoes",
  ultimoCiclo: "ecac_ultimo_ciclo_importado",
  ultimaImportacao: "ecac_ultima_importacao",
  ultimoResumo: "ecac_ultima_importacao_resumo",
  escritorioNome: "ecac_escritorio_nome",
  escritorioEmail: "ecac_escritorio_email",
  equipeWhatsapp: "ecac_equipe_whatsapp",
  equipeEmail: "ecac_equipe_email",
};

function inteiro(v, padrao, min, max) {
  const n = parseInt(String(v ?? ""), 10);
  if (Number.isNaN(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}

async function lerConfig(db) {
  // eslint-disable-next-line no-unused-vars
  const [imp, dia, envio, _teste, dl, dr, dc, mr, ciclo, ultima, resumo, nome, email, eqWpp, eqEmail] = await Promise.all(
    Object.values(CHAVES).map((k) => getSetting(db, k))
  );
  const alertas = await lerConfigAlertas(db);
  let resumoObj = null;
  try {
    resumoObj = resumo ? JSON.parse(resumo) : null;
  } catch {
    resumoObj = null;
  }
  return {
    importacao_ativa: imp === "true",
    dia_importacao: inteiro(dia, 26, 1, 28),
    envio_ativo: envio === "true",
    // Fixo: mensagem automática só para o escritório (alerta ao cliente é manual).
    modo_teste: true,
    dias_lembrete: inteiro(dl, CFG_PADRAO.dias_lembrete, 1, 30),
    dias_regeracao: inteiro(dr, CFG_PADRAO.dias_regeracao, 1, 30),
    dias_cobranca: inteiro(dc, CFG_PADRAO.dias_cobranca, 1, 30),
    max_regeracoes: inteiro(mr, CFG_PADRAO.max_regeracoes, 0, 5),
    max_msgs_canal: CFG_PADRAO.max_msgs_canal,
    ultimo_ciclo_importado: ciclo || null,
    ultima_importacao: ultima || null,
    ultima_importacao_resumo: resumoObj,
    escritorio_nome: nome || "Nescon Contabilidade",
    escritorio_email: email || process.env.ECAC_EMAIL_ESCRITORIO || process.env.CHAT_EMAIL_EQUIPE || "",
    // WhatsApp do escritório: o mesmo que os alertas já usam.
    escritorio_whatsapp: alertas.escritorio_whatsapp || process.env.ADMIN_WHATSAPP || "",
    // Pessoa da equipe que também acompanha (recebe cópia dos lembretes do escritório).
    equipe_whatsapp: eqWpp || "",
    equipe_email: eqEmail || "",
  };
}

async function salvarConfig(db, parcial) {
  const p = parcial || {};
  const grava = async (chave, valor) => {
    if (valor === undefined) return;
    await setSetting(db, chave, valor);
  };
  if (typeof p.importacao_ativa === "boolean") await grava(CHAVES.importacaoAtiva, p.importacao_ativa);
  if (p.dia_importacao !== undefined) await grava(CHAVES.diaImportacao, inteiro(p.dia_importacao, 26, 1, 28));
  if (typeof p.envio_ativo === "boolean") await grava(CHAVES.envioAtivo, p.envio_ativo);
  if (p.dias_lembrete !== undefined) await grava(CHAVES.diasLembrete, inteiro(p.dias_lembrete, 5, 1, 30));
  if (p.dias_regeracao !== undefined) await grava(CHAVES.diasRegeracao, inteiro(p.dias_regeracao, 5, 1, 30));
  if (p.dias_cobranca !== undefined) await grava(CHAVES.diasCobranca, inteiro(p.dias_cobranca, 3, 1, 30));
  if (p.max_regeracoes !== undefined) await grava(CHAVES.maxRegeracoes, inteiro(p.max_regeracoes, 2, 0, 5));
  if (p.escritorio_nome !== undefined) await grava(CHAVES.escritorioNome, String(p.escritorio_nome || "").slice(0, 120));
  if (p.escritorio_email !== undefined) await grava(CHAVES.escritorioEmail, String(p.escritorio_email || "").trim().slice(0, 200));
  if (p.equipe_whatsapp !== undefined) await grava(CHAVES.equipeWhatsapp, String(p.equipe_whatsapp || "").replace(/\D/g, "").slice(0, 20));
  if (p.equipe_email !== undefined) await grava(CHAVES.equipeEmail, String(p.equipe_email || "").trim().slice(0, 200));
  return lerConfig(db);
}

async function registrarImportacao(db, ciclo, resumo) {
  await setSetting(db, CHAVES.ultimoCiclo, ciclo);
  await setSetting(db, CHAVES.ultimaImportacao, new Date().toISOString());
  await setSetting(db, CHAVES.ultimoResumo, JSON.stringify(resumo).slice(0, 20000));
}

module.exports = { CHAVES, lerConfig, salvarConfig, registrarImportacao };
