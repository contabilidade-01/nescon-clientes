/**
 * Janela diurna de envio — fonte única de verdade para "não mandar mensagem de madrugada".
 *
 * Toda mensagem que chega no cliente (alerta de vencimento, cobrança de boleto, aviso de
 * documento novo, envio de acesso) tem de sair só dentro do horário comercial. Antes cada
 * ponto de envio decidia por conta própria: o drenador da fila tinha a trava, mas o envio
 * direto (automático das 08h e o botão "Enviar" do painel) e o "Enviar Acesso por WhatsApp"
 * não tinham — bastava o agendador marcar 03h, ou alguém clicar de madrugada, para o
 * cliente receber WhatsApp em plena madrugada. Um só lugar para a regra evita esse drift.
 *
 * A janela é em MINUTOS DESDE A MEIA-NOITE no fuso de São Paulo (ver `minutosSP`), porque
 * o servidor roda em UTC e `getHours()` mandaria no fuso errado. 08:00–19:00: mesma janela
 * que o aviso de documento (`docNotify.js`) já usava, para o sistema inteiro falar no mesmo
 * horário.
 */

// 08:00 (inclusive) às 19:00 (exclusive) no horário de São Paulo.
const JANELA_INICIO_MIN = 8 * 60; // 08:00
const JANELA_FIM_MIN = 19 * 60; // 19:00

/** Está dentro da janela diurna de envio? Função pura, testável sem relógio real. */
function dentroDaJanela(minutos) {
  return minutos >= JANELA_INICIO_MIN && minutos < JANELA_FIM_MIN;
}

/** É dia útil? Segunda(1) a sexta(5). Sábado(6) e domingo(0) são fim de semana. */
function ehDiaUtil() {
  // Usa Date no fuso de São Paulo para não errar em servidor UTC.
  const agora = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  const dia = new Date(agora).getDay();
  return dia >= 1 && dia <= 5;
}

/** Texto curto da janela para mensagens de erro/diagnóstico ("08:00–19:00"). */
function descricaoJanela() {
  const hh = (min) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
  return `${hh(JANELA_INICIO_MIN)}–${hh(JANELA_FIM_MIN)}`;
}

module.exports = { JANELA_INICIO_MIN, JANELA_FIM_MIN, dentroDaJanela, ehDiaUtil, descricaoJanela };
