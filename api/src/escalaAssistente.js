/**
 * Assistente de IA do planejador de escalas (API do Claude, com ferramentas).
 *
 * Como funciona: a conversa e o estado da escala ficam no NAVEGADOR, onde está o motor de
 * regras (src/lib/escala/). O servidor só guarda a chave da API e chama o Claude com o
 * prompt e as ferramentas abaixo. Quando o Claude pede uma ferramenta (tool_use), a
 * resposta volta para a tela, que executa a ferramenta na escala aberta (passando pela
 * mesma trava de regras da grade) e manda o resultado (tool_result) na próxima chamada.
 * Assim a IA nunca grava nada que o motor recusaria, e o que ela muda aparece na grade.
 *
 * Chave: ANTHROPIC_API_KEY no ambiente ou a chave do Claude salva em /admin/config-ia.
 * Modelo: ESCALA_IA_MODELO (padrão claude-opus-5-5).
 */
const Anthropic = require("@anthropic-ai/sdk");
const { obterChaveApi } = require("./iaProvider");

const MODELO = process.env.ESCALA_IA_MODELO || "claude-opus-5-5";
/** A conversa inteira vai a cada chamada; o teto barra abuso. */
const MAX_BYTES = 600 * 1024;
const MAX_MENSAGENS = 120;

const SISTEMA = `Você é o assistente de escalas de trabalho do portal da Nescon, um escritório de contabilidade. Você conversa em português do Brasil com o dono ou o gerente de uma empresa cliente (ou com alguém do escritório) que está montando a escala de trabalho dos funcionários.

Contexto legal que o sistema aplica (não invente números fora disto):
- EC 141/2026 (fim da escala 6x1): até 15/12/2026 vale 44h semanais e 1 folga por semana; a partir de 16/12/2026, 42h semanais e 2 folgas por semana (uma preferencialmente no domingo); a partir de 16/12/2027, 40h semanais.
- O salário não pode ser reduzido por causa da redução de jornada.
- CLT: no máximo 8h normais por dia (+2h extras), intervalo de 1h acima de 6h (30 min com acordo coletivo), 11h entre jornadas, no máximo 6 dias seguidos, domingo de folga ao menos a cada 3 semanas no comércio e a cada 7 nos demais.
- 12x36 continua permitida, mas a média (42h) passa do limite de 40h: depende da convenção coletiva.
- Com acordo ou convenção coletiva, a jornada diária pode subir para distribuir 42h em 5 dias (8h24).

Seu papel tem duas partes:
1. Consultor: explique as regras, aponte gargalos (dias com menos gente do que a demanda, pessoas acima do limite, quem precisa mudar até a próxima etapa) e faça projeções (como a escala atual fica em 16/12/2026 e em 16/12/2027, quantas pessoas a mais seriam necessárias).
2. Operador: quando a pessoa pedir, use as ferramentas para mudar a escala aberta na tela. As ferramentas passam pelo motor de regras: se uma mudança criar erro, ela é recusada e você recebe o motivo. Nesse caso explique e proponha outra saída.

Como trabalhar:
- Comece consultando a situação (ver_situacao) antes de opinar sobre a escala.
- Para mudanças de equipe inteira ou de grupos, prefira simular_distribuicao e mostrar o resultado antes de aplicar. Aplique (aplicar_distribuicao) quando a pessoa concordar ou quando ela já tiver pedido para aplicar.
- Mudanças feitas pelas ferramentas ficam na tela e só são gravadas quando a pessoa clicar em Salvar ou pedir para salvar (salvar_escala).
- Não invente dados de funcionários. Use os ids que as ferramentas devolvem.
- Respostas curtas e diretas, em linguagem simples, sem jargão técnico do sistema. Use listas só quando ajudarem.
- Você não substitui o Departamento Pessoal: para aditivo de contrato, convenção coletiva ou dúvida jurídica específica, oriente a falar com a Nescon.`;

const DIAS_DESC = "Dia da semana: 0 = domingo, 1 = segunda, ..., 6 = sábado.";
const MODELOS_DESC =
  "Modelos: '6x1' (só até 15/12/2026), '5x2' (folgas fixas), '5x2_rev' (5x2 com rodízio do domingo), '5x2_fechado' (folga fixa no dia em que a casa fecha + 1 escalonada), '4x3' (4 dias de 10h, exige acordo), '12x36' (plantões).";

/** Ferramentas: executadas no navegador (src/lib/escala/assistenteFerramentas.ts). */
const FERRAMENTAS = [
  {
    name: "ver_situacao",
    description:
      "Mostra a escala aberta na tela: mês, regra em vigor, empresa (segmento, acordo, demanda por dia), cada pessoa com id, modelo, folgas e horário, erros e avisos, média de pessoas por dia da semana e dias sem cobertura. Use antes de opinar ou mudar.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "projetar_etapas",
    description:
      "Projeta a escala atual (mesmos modelos e folgas) nos meses das etapas da emenda (dez/2026 com 42h e dez/2027 com 40h) e diz quantas pessoas ficam fora da regra e quais erros aparecem. Use para responder 'o que muda' e 'o que preciso ajustar'.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "simular_distribuicao",
    description:
      "Gera, sem aplicar, uma distribuição automática da equipe em grupos (aleatória e coesa: folgas espalhadas, turmas equilibradas), validada pelo motor de regras. Devolve um id para aplicar depois. " +
      MODELOS_DESC +
      " " +
      DIAS_DESC,
    input_schema: {
      type: "object",
      properties: {
        grupos: {
          type: "array",
          description: "Grupos na ordem. Pessoas sem grupo vão para o grupo com quantidade null (ou o último).",
          items: {
            type: "object",
            properties: {
              modelo: { type: "string", enum: ["6x1", "5x2", "5x2_rev", "5x2_fechado", "4x3", "12x36"] },
              quantidade: { type: ["integer", "null"], description: "Quantas pessoas; null = o resto da equipe." },
              pessoas: { type: "array", items: { type: "string" }, description: "Ids de pessoas fixadas neste grupo (opcional)." },
              folga_fixa: {
                type: ["integer", "null"],
                description: "Dia de folga fixo (0-6) ou null para folga variável. No 5x2_fechado é o dia em que a casa fecha.",
              },
              entrada: { type: "string", description: "HH:MM (opcional, padrão do modelo)" },
              saida: { type: "string", description: "HH:MM (opcional, padrão do modelo)" },
              intervalo_min: { type: "integer", description: "Intervalo em minutos (opcional)" },
            },
            required: ["modelo", "quantidade", "folga_fixa"],
            additionalProperties: false,
          },
        },
        semente: { type: "integer", description: "Opcional. Outra semente gera outra distribuição." },
      },
      required: ["grupos"],
      additionalProperties: false,
    },
  },
  {
    name: "aplicar_distribuicao",
    description: "Aplica na grade uma distribuição gerada por simular_distribuicao (só se ela estiver sem erro).",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "alterar_pessoa",
    description:
      "Muda a escala de UMA pessoa na grade. A mudança é recusada se criar erro novo. " +
      MODELOS_DESC +
      " " +
      DIAS_DESC +
      " Campos de folga: no 6x1 use folga_6x1; no 5x2 use folgas_5x2 (dois dias); no 5x2_rev, 5x2_fechado e 4x3 use folga_fixa (1-6); no 12x36 use turma ('A' ou 'B'); no 5x2_fechado use dia_fechado.",
    input_schema: {
      type: "object",
      properties: {
        pessoa_id: { type: "string" },
        modelo: { type: "string", enum: ["6x1", "5x2", "5x2_rev", "5x2_fechado", "4x3", "12x36"] },
        entrada: { type: "string" },
        saida: { type: "string" },
        intervalo_min: { type: "integer" },
        folga_6x1: { type: "integer" },
        folgas_5x2: { type: "array", items: { type: "integer" } },
        folga_fixa: { type: "integer" },
        semanas_rodizio: { type: "integer" },
        dia_fechado: { type: "integer" },
        turma: { type: "string", enum: ["A", "B"] },
      },
      required: ["pessoa_id"],
      additionalProperties: false,
    },
  },
  {
    name: "definir_demanda",
    description: "Define quantas pessoas a empresa precisa trabalhando em cada dia da semana (domingo a sábado). Serve para medir gargalos.",
    input_schema: {
      type: "object",
      properties: {
        demanda: { type: "array", items: { type: "integer" }, description: "7 números, de domingo a sábado." },
      },
      required: ["demanda"],
      additionalProperties: false,
    },
  },
  {
    name: "salvar_escala",
    description: "Grava a escala do mês aberto. Só use quando a pessoa pedir para salvar ou confirmar que quer gravar.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/** Só user/assistant, conteúdo em texto ou blocos; o resto é recusado. */
function validarMensagens(messages) {
  if (!Array.isArray(messages) || !messages.length) return "Conversa vazia.";
  if (messages.length > MAX_MENSAGENS) return "Conversa longa demais. Comece uma nova.";
  if (Buffer.byteLength(JSON.stringify(messages)) > MAX_BYTES) return "Conversa longa demais. Comece uma nova.";
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return "Mensagem inválida.";
    if (typeof m.content !== "string" && !Array.isArray(m.content)) return "Mensagem inválida.";
  }
  if (messages[0].role !== "user") return "A conversa começa pela pessoa.";
  return null;
}

let clienteCache = { chave: null, cliente: null };

async function clienteAnthropic(db) {
  const chave = await obterChaveApi("claude", db);
  if (!chave) return null;
  if (clienteCache.chave !== chave) clienteCache = { chave, cliente: new Anthropic({ apiKey: chave, timeout: 120_000 }) };
  return clienteCache.cliente;
}

/**
 * Uma volta da conversa. Devolve o conteúdo do Claude como veio (os blocos de raciocínio
 * precisam voltar intactos na próxima chamada) e o motivo da parada.
 */
async function responder(db, messages) {
  const erro = validarMensagens(messages);
  if (erro) return { status: 400, body: { error: erro } };
  const client = await clienteAnthropic(db);
  if (!client) {
    return {
      status: 503,
      body: { error: "Assistente sem chave da API do Claude. O escritório configura em Configuração de IA.", code: "SEM_CHAVE" },
    };
  }
  try {
    const resp = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: SISTEMA,
      tools: FERRAMENTAS,
      messages,
    });
    return {
      status: 200,
      body: { content: resp.content, stop_reason: resp.stop_reason, model: resp.model },
    };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return { status: 429, body: { error: "Muitas perguntas seguidas. Espere um pouco e tente de novo." } };
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return { status: 503, body: { error: "A chave da API do Claude foi recusada. Confira em Configuração de IA." } };
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error("[escala-ia] pedido recusado:", err.message);
      return { status: 400, body: { error: "A conversa ficou num formato que a IA não aceitou. Comece uma nova." } };
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[escala-ia] API:", err.status, err.message);
      return { status: 502, body: { error: "A IA não respondeu agora. Tente de novo em instantes." } };
    }
    console.error("[escala-ia]", err.message);
    return { status: 502, body: { error: "Falha ao falar com a IA." } };
  }
}

module.exports = { responder, validarMensagens, FERRAMENTAS, SISTEMA, MODELO };
