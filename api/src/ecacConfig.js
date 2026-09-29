/**
 * Configuração da cobrança de pendências do e-CAC — fica na TELA (app_settings), não em
 * variável de ambiente, pelo mesmo motivo dos alertas: ligar/desligar é decisão do dia a
 * dia e não pode custar um redeploy.
 *
 * Padrões nascem DESLIGADOS e em MODO TESTE: nada sai para cliente por acidente de
 * deploy. Em modo teste toda mensagem vai para o e-mail/WhatsApp do escritório, com o
 * nome da empresa no assunto — é como se confere o texto antes de liberar.
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
};

function inteiro(v, padrao, min, max) {
  const n = parseInt(String(v ?? ""), 10);
  if (Number.isNaN(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}

async function lerConfig(db) {
  const [imp, dia, envio, teste, dl, dr, dc, mr, ciclo, ultima, resumo, nome, email] = await Promise.all(
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
    modo_teste: teste === null ? true : teste === "true",
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
  if (typeof p.modo_teste === "boolean") await grava(CHAVES.modoTeste, p.modo_teste);
  if (p.dias_lembrete !== undefined) await grava(CHAVES.diasLembrete, inteiro(p.dias_lembrete, 5, 1, 30));
  if (p.dias_regeracao !== undefined) await grava(CHAVES.diasRegeracao, inteiro(p.dias_regeracao, 5, 1, 30));
  if (p.dias_cobranca !== undefined) await grava(CHAVES.diasCobranca, inteiro(p.dias_cobranca, 3, 1, 30));
  if (p.max_regeracoes !== undefined) await grava(CHAVES.maxRegeracoes, inteiro(p.max_regeracoes, 2, 0, 5));
  if (p.escritorio_nome !== undefined) await grava(CHAVES.escritorioNome, String(p.escritorio_nome || "").slice(0, 120));
  if (p.escritorio_email !== undefined) await grava(CHAVES.escritorioEmail, String(p.escritorio_email || "").trim().slice(0, 200));
  return lerConfig(db);
}

async function registrarImportacao(db, ciclo, resumo) {
  await setSetting(db, CHAVES.ultimoCiclo, ciclo);
  await setSetting(db, CHAVES.ultimaImportacao, new Date().toISOString());
  await setSetting(db, CHAVES.ultimoResumo, JSON.stringify(resumo).slice(0, 20000));
}

module.exports = { CHAVES, lerConfig, salvarConfig, registrarImportacao };
