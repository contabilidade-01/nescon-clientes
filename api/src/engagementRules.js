/**
 * Quando mandar uma mensagem de incentivo, e qual.
 *
 * Função pura, sem banco — é aqui que mora o risco do módulo. Mandar demais irrita o
 * cliente e queima o canal; mandar de menos não converte ninguém. As três travas abaixo
 * são cumulativas de propósito.
 */

/** A cada quantos alertas de vencimento entra uma mensagem. */
const A_CADA_ENVIOS = 3;
/** Piso em dias entre duas mensagens — três vencimentos na mesma semana não viram três frases. */
const INTERVALO_MINIMO_DIAS = 7;

/**
 * Nunca acessou o portal?
 *
 * `ultimoLoginEm` só passou a ser gravado agora, então sozinho ele acusaria como "novato"
 * quem entra há meses. Por isso o segundo sinal: quem **já trocou a senha inicial**
 * necessariamente entrou alguma vez. E qualquer abertura de documento registrada também
 * vale como acesso.
 */
function nuncaAcessou({ ultimoLoginEm, mustChangePassword, aberturas = 0 }) {
  if (ultimoLoginEm) return false;
  if (mustChangePassword === false) return false;
  if (Number(aberturas) > 0) return false;
  return true;
}

function diasEntre(a, b) {
  const d1 = a instanceof Date ? a : new Date(a);
  const d2 = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return Infinity;
  return Math.floor((d2 - d1) / 86400000);
}

/**
 * Decide se ESTE alerta leva mensagem junto.
 *
 * `enviosDesde` já deve incluir o alerta atual (quem chama incrementa antes de perguntar).
 */
function deveEnviar({
  nuncaAcessou: nunca,
  enviosDesde,
  ultimoIncentivoEm = null,
  hoje = new Date(),
  aCadaEnvios = A_CADA_ENVIOS,
  intervaloMinimoDias = INTERVALO_MINIMO_DIAS,
}) {
  if (!nunca) return { enviar: false, motivo: "já acessou o portal" };
  if (Number(enviosDesde) < aCadaEnvios) {
    return { enviar: false, motivo: `faltam ${aCadaEnvios - Number(enviosDesde)} aviso(s)` };
  }
  if (ultimoIncentivoEm) {
    const dias = diasEntre(ultimoIncentivoEm, hoje);
    if (dias < intervaloMinimoDias) {
      return { enviar: false, motivo: `última faz ${dias} dia(s), mínimo ${intervaloMinimoDias}` };
    }
  }
  return { enviar: true, motivo: "ok" };
}

/**
 * Qual mensagem mandar: a que este cliente ainda não recebeu, na ordem definida no
 * repositório. Esgotado o repositório, recomeça pela mais antiga que ele recebeu — assim
 * a rotação nunca trava, mas também nunca repete cedo demais.
 */
function escolherMensagem(ativas, jaEnviadas = []) {
  if (!ativas.length) return null;
  const usadas = new Map();
  for (const e of jaEnviadas) {
    const t = new Date(e.enviado_em).getTime();
    const atual = usadas.get(e.message_id);
    if (atual === undefined || t > atual) usadas.set(e.message_id, t);
  }

  const ordenadas = [...ativas].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const inedita = ordenadas.find((m) => !usadas.has(m.id));
  if (inedita) return inedita;

  // Todas já foram: volta para a usada há mais tempo.
  return ordenadas.reduce((maisAntiga, m) =>
    (usadas.get(m.id) ?? 0) < (usadas.get(maisAntiga.id) ?? 0) ? m : maisAntiga
  );
}

/** Troca os marcadores do texto. Marcador desconhecido fica como está, visível. */
function montarTexto(texto, { portal = "", empresa = "" } = {}) {
  return String(texto || "")
    .replace(/\{portal\}/g, portal)
    .replace(/\{empresa\}/g, empresa)
    .trim();
}

module.exports = {
  A_CADA_ENVIOS,
  INTERVALO_MINIMO_DIAS,
  nuncaAcessou,
  deveEnviar,
  escolherMensagem,
  montarTexto,
};
