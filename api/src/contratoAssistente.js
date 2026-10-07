/**
 * Assistente de contratos: entrevista o operador e devolve um mapa de campos a preencher.
 *
 * Mesmo desenho do assistente de propostas (propostaIa.js): o modelo NUNCA escreve
 * cláusula nem calcula nada. Ele só devolve valores para campos do catálogo ("secao.campo")
 * e, opcionalmente, o id de um perfil de honorário. Quem valida e aplica é o navegador
 * (src/lib/contratoCampos.ts → aplicarAtualizacoes), que descarta campo fora do catálogo,
 * valor fora dos limites e dado identificador (CPF, endereço…), que a IA nem recebe.
 * O texto jurídico vem sempre do modelo fixo (contratoModelo.ts / montarAditivo).
 */
const { obterChaveApi } = require("./iaProvider");
const { normalizarMensagens } = require("./propostaIa");
const { getSetting } = require("./appSettings");

const MODELO_PADRAO = "claude-sonnet-5-5";

const FERRAMENTA = {
  name: "responder",
  description:
    "Responde ao operador e devolve os campos a preencher no contrato. Use SEMPRE esta ferramenta, inclusive quando só precisa perguntar algo (atualizacoes vazio).",
  input_schema: {
    type: "object",
    properties: {
      mensagem: {
        type: "string",
        description: "Texto curto em português para o operador: o que foi preenchido e, no máximo, 2 ou 3 perguntas objetivas do que ainda falta.",
      },
      perfil_id: {
        type: "string",
        description: "id de um perfil de honorário da lista, se um deles descreve bem a situação. Aplicado antes das atualizações. Omita se não houver.",
      },
      atualizacoes: {
        type: "object",
        description:
          'Mapa plano chave → valor, usando SÓ as chaves de CAMPOS (ex.: {"honorarios.valorMensal": 450, "honorarios.vencimentoDia": 10}). Números sem símbolo, datas AAAA-MM-DD, booleanos true/false, enums pelo valor listado. Omita o que não mudou.',
        additionalProperties: true,
      },
      faltando: { type: "array", items: { type: "string" }, description: "O que ainda precisa ser informado" },
      pronto: { type: "boolean", description: "true quando nada essencial falta" },
    },
    required: ["mensagem", "atualizacoes"],
  },
};

function promptSistema({ modo, campos, estado, perfis, contexto }) {
  const aditivo = modo === "aditivo";
  return [
    aditivo
      ? "Você é o assistente de ADITIVOS contratuais da Nescon Contabilidade. O operador diz o que mudou no contrato já assinado; você preenche só os campos que mudam."
      : "Você é o assistente de CONTRATOS da Nescon Contabilidade. O operador descreve o cliente e o acordo; você preenche os campos do contrato padrão, fazendo perguntas curtas.",
    "",
    "REGRAS",
    "1. Você NÃO escreve cláusula, NÃO redige texto jurídico e NÃO inventa dado. O contrato é gerado por um modelo fixo a partir dos campos; sua única saída são valores de campos.",
    "2. Use SOMENTE as chaves de CAMPOS, com o tipo e os limites indicados. Se o operador pedir algo que não existe nos campos, diga que não cabe e sugira registrar manualmente; não force em outro campo.",
    "3. Só preencha o que o operador disse ou o que decorre de um perfil/faixa dos dados abaixo. Se faltar informação essencial, pergunte; não chute valores, datas nem nomes.",
    "4. Pergunte SÓ o que ainda não foi dito, no máximo 3 perguntas por vez, curtas, em português do Brasil. Aplique a cada resposta o que já sabe (atualizacoes), mesmo que falte o resto.",
    "5. Mapeie: MEI→objeto.enquadramento=mei e objeto.modelo=mei; Simples/ME/EPP→simples; Lucro Presumido→presumido; Lucro Real→real; serviço/comércio/indústria; complexidade baixa/media/alta.",
    "6. Se um PERFIL descreve a situação (enquadramento, tipo, complexidade), informe `perfil_id` em vez de repetir os campos dele. Depois ajuste só o que o operador negociar diferente.",
    "7. Não há CPF, endereço, e-mail nem telefone nos campos: esses dados vêm do cadastro da empresa. Se o operador os digitar, não repita nem tente salvá-los; diga que entram pelo cadastro prévio ou pelo formulário.",
    "8. Valores fora dos limites dos campos serão descartados pelo sistema. Se o operador pedir algo fora do limite, avise.",
    aditivo
      ? "9. Em aditivo, os campos são as CONDIÇÕES VIGENTES (estado). Devolva só o que muda. Para reajuste percentual, calcule o novo valor (arredonde a centavos) e informe-o. Pergunte sempre a partir de quando vale, se ainda não foi dito (o operador preenche a data na tela)."
      : "9. Quando nada essencial faltar (empresa, enquadramento, valor mensal, vencimento, início), marque pronto=true e diga que o operador pode revisar a prévia, baixar o PDF ou salvar.",
    "10. Seja objetivo: nada de explicações longas.",
    "",
    "CAMPOS (JSON):",
    JSON.stringify(campos),
    "",
    "PERFIS DE HONORÁRIO (JSON):",
    JSON.stringify(perfis || []),
    "",
    "CONTEXTO (JSON):",
    JSON.stringify(contexto || {}),
    "",
    aditivo ? "CONDIÇÕES VIGENTES (JSON):" : "ESTADO ATUAL DO CONTRATO (JSON):",
    JSON.stringify(estado),
  ].join("\n");
}

async function conversarContrato(db, { mensagens, modo, campos, estado, perfis, contexto }) {
  const chave = await obterChaveApi("claude", db);
  if (!chave) {
    const e = new Error("Assistente indisponível: configure a chave da Claude (ANTHROPIC_API_KEY ou Configurações › IA).");
    e.status = 409;
    throw e;
  }
  const msgs = normalizarMensagens(mensagens);
  if (!msgs.length) {
    const e = new Error("Escreva uma mensagem para o assistente.");
    e.status = 400;
    throw e;
  }
  const modelo = process.env.CONTRATO_IA_MODELO || (await getSetting(db, "contrato_ia_modelo")) || MODELO_PADRAO;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 2048,
        system: promptSistema({ modo, campos, estado, perfis, contexto }),
        messages: msgs,
        tools: [FERRAMENTA],
        tool_choice: { type: "tool", name: "responder" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(`Claude API: ${err.error?.message || res.statusText}`);
      e.status = 502;
      throw e;
    }
    const data = await res.json();
    const bloco = (data.content || []).find((b) => b.type === "tool_use" && b.name === "responder");
    if (!bloco?.input) {
      const e = new Error("O assistente não devolveu uma resposta utilizável. Tente de novo.");
      e.status = 502;
      throw e;
    }
    const inp = bloco.input;
    return {
      mensagem: String(inp.mensagem || "").slice(0, 2000),
      perfil_id: typeof inp.perfil_id === "string" ? inp.perfil_id.slice(0, 64) : null,
      atualizacoes: inp.atualizacoes && typeof inp.atualizacoes === "object" && !Array.isArray(inp.atualizacoes) ? inp.atualizacoes : {},
      faltando: Array.isArray(inp.faltando) ? inp.faltando.map((x) => String(x).slice(0, 200)).slice(0, 10) : [],
      pronto: Boolean(inp.pronto),
      modelo,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error("O assistente demorou demais. Tente de novo.");
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { conversarContrato, promptSistema, FERRAMENTA };
