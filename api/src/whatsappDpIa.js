/**
 * A IA lê o recado no contexto da sessão e preenche o que já estiver claro
 * (motivo, data da falta, dias 1-3, “hoje”). O fluxo só pergunta o que faltar.
 */
const { chamarIaConfigurada } = require("./iaProvider");

async function interpretarMensagem(db, { texto, sessao, funcionarios }) {
  const d = sessao?.dados || {};
  const lista = (funcionarios || [])
    .slice(0, 25)
    .map((e, i) => `${i + 1}. ${e.name}`)
    .join("\n");
  const prompt =
    `Você interpreta mensagens de um cliente de DP (advertência/suspensão) no WhatsApp.\n` +
    `NÃO invente funcionário, data, dia nem motivo. Se não estiver claro, use null.\n` +
    `Passo atual: ${sessao?.step || "inicio"}. Tema: ${sessao?.tema || "?"}.\n` +
    `Já coletado: ${JSON.stringify({
      funcionario: d.funcionario || null,
      dias: d.dias || null,
      motivo: d.motivo || null,
      datasFatoBR: d.datasFatoBR || null,
      dataBR: d.dataBR || null,
      conduta: d.conduta || null,
    })}\n` +
    (lista ? `Funcionários:\n${lista}\n` : "") +
    `Mensagem: """${String(texto).slice(0, 900)}"""\n` +
    `Responda SOMENTE JSON:\n` +
    `{"funcionario_numero":null,"funcionario_nome":null,"dias":null,"motivo":null,` +
    `"datas_falta":[],"data":null,"conduta":null,"anuncio_trabalha":null,"confirmar":null,"cancelar":false}\n` +
    `Regras:\n` +
    `- dias só 1, 2 ou 3 (teto deste escritório; CLT art. 474 permite até 30).\n` +
    `- Se o cliente já descreveu o fato (ex. "faltou dia 30"), isso É o motivo — preencha motivo e datas_falta.\n` +
    `- data: "hoje", "amanhã" ou dd/mm/aaaa = data do TERMO ou início da suspensão, não necessariamente o dia da falta.\n` +
    `- datas_falta: dias em que faltou/atrasou, formato dd/mm/aaaa (ano atual se faltar).\n` +
    `- Se o passo é funcionario, um número pequeno é o índice da lista, não dias.\n` +
    `- confirmar: true só se disser sim/confirmo para emitir. cancelar: true só se quiser abortar tudo.\n` +
    `- Se o passo é confirma e a pessoa disser que o resumo está errado, confirmar=false, cancelar=false, e preencha OS CAMPOS CORRIGIDOS (motivo, dias, data, datas_falta, funcionário).\n` +
    `- "não está correto" / "errado" / "muda o motivo" NÃO é cancelar — é correção.\n` +
    `- conduta: "faltas"|"ordem"|"conduta"|"desempenho"|"outro" ou null. Se o motivo for falta/atraso, use "faltas".\n` +
    `- anuncio_trabalha: true/false/null (12x36: no dia do anúncio ele trabalha?).`;

  const { resposta } = await chamarIaConfigurada(db, { prompt, timeoutMs: 22000 });
  return resposta && typeof resposta === "object" ? resposta : {};
}

module.exports = { interpretarMensagem };
