/**
 * Agente de IA do onboarding: entrevista o operador e monta (ou ajusta) o modelo de roteiro.
 *
 * Mesmo desenho dos assistentes de contrato e proposta: o modelo de linguagem só devolve DADOS
 * (o rascunho do modelo), nunca texto que vá direto ao cliente sem passar pelo painel. Tudo o
 * que ele devolve passa por sanitizarBlocos/sanitizarRegras (descarta tipo desconhecido, campo
 * fora do tipo e valor fora dos limites) e só vira modelo salvo quando o operador clica em
 * "Salvar" no construtor — onde ainda pode arrastar, editar e remover bloco.
 *
 * A BASE DE CONHECIMENTO é um texto livre, editável na tela (app_settings), com o que o
 * escritório pede de cada tipo de cliente. Sem redeploy para ensinar o agente uma regra nova.
 */
const { obterChaveApi } = require("./iaProvider");
const { normalizarMensagens } = require("./propostaIa");
const { getSetting } = require("./appSettings");
const { TIPOS_BLOCO, sanitizarBlocos, sanitizarRegras } = require("./onboardingRegras");

const MODELO_PADRAO = "claude-sonnet-5-5";
const CHAVE_CONHECIMENTO = "onboarding_ia_conhecimento";
const LIMITE_CONHECIMENTO = 12000;

/** Ponto de partida da base de conhecimento; o escritório edita pela tela. */
const CONHECIMENTO_PADRAO = [
  "O QUE A NESCON PEDE AO CLIENTE NOVO (edite este texto com a prática real do escritório)",
  "",
  "Toda empresa: contrato social e última alteração (ou requerimento de empresário); cartão CNPJ; e-mail e WhatsApp de contato.",
  "Certificado digital e-CNPJ A1 é opcional no começo: se a empresa não tem, orientamos a emissão. A senha nunca vai por e-mail.",
  "Contábil: extratos bancários dos últimos 3 meses (prefira OFX); balancete e livro razão do contador anterior, se houver.",
  "Fiscal: notas fiscais emitidas e recebidas do mês anterior (XML); acesso ao portal da prefeitura, se a nota é emitida por lá.",
  "Pessoal (só com funcionários): lista de funcionários com salário e função; folha e ficha de registro mais recentes; ASO e contratos de experiência vigentes.",
  "",
  "PRAZOS USUAIS",
  "Contrato social e cartão CNPJ: 3 a 5 dias úteis após a assinatura. Demais documentos: 5 a 7 dias úteis a partir do início da prestação do serviço.",
  "Rotina mensal: variáveis da folha até o dia 20; documentos financeiros até o dia 5.",
  "",
  "TOM",
  "Texto curto, direto, tratando o cliente por 'você'. Sem jargão contábil sem explicar.",
].join("\n");

async function lerConhecimento(db) {
  const salvo = await getSetting(db, CHAVE_CONHECIMENTO);
  return salvo === null || salvo === undefined ? CONHECIMENTO_PADRAO : salvo;
}

const FERRAMENTA = {
  name: "responder",
  description:
    "Responde ao operador e, quando houver o que mudar, devolve o modelo de onboarding COMPLETO atualizado. Use SEMPRE esta ferramenta, inclusive quando só precisa perguntar (omita `modelo`).",
  input_schema: {
    type: "object",
    properties: {
      mensagem: {
        type: "string",
        description: "Texto curto em português para o operador: o que montou/mudou e, no máximo, 2 ou 3 perguntas objetivas do que ainda falta.",
      },
      modelo: {
        type: "object",
        description:
          "O modelo inteiro depois das suas mudanças (não só o que mudou): nome, descricao, regras e blocos na ordem em que o cliente os verá. Omita se nada mudou.",
        properties: {
          nome: { type: "string" },
          descricao: { type: "string" },
          regras: {
            type: "object",
            description:
              "Para qual contrato o modelo serve. Chaves opcionais: areas (contabil|fiscal|pessoal), enquadramento (mei|simples|presumido|real), tipoEmpresa (servico|comercio|industria), comFuncionarios (boolean).",
            additionalProperties: true,
          },
          blocos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tipo: { type: "string", enum: TIPOS_BLOCO },
                titulo: { type: "string" },
                descricao: { type: "string" },
                obrigatorio: { type: "boolean", description: "Só documento. Padrão true." },
                formatos: { type: "array", items: { type: "string" }, description: "Só documento: pdf, xml, ofx, xlsx, pfx…" },
                comoEnviar: { type: "string", description: "Só documento: orientação curta de como enviar." },
                prazo: {
                  type: "object",
                  description: "Documento e marco: dias a contar da assinatura do contrato ('assinatura') ou do início da prestação ('inicio').",
                  properties: {
                    ref: { type: "string", enum: ["assinatura", "inicio"] },
                    dias: { type: "number" },
                    uteis: { type: "boolean" },
                  },
                },
                regra: { type: "string", description: "Só prazo_recorrente: a regra mensal, ex.: 'Todo mês, até o dia {{prazos.diaVariaveisFolha|20}}.'" },
                contato: { type: "string", description: "Só contato: quem atende e como." },
                condicao: { type: "object", description: "Mostrar este bloco só em alguns contratos. Mesmas chaves de `regras`.", additionalProperties: true },
              },
              required: ["tipo", "titulo"],
            },
          },
        },
      },
      faltando: { type: "array", items: { type: "string" }, description: "O que ainda precisa ser decidido" },
      pronto: { type: "boolean", description: "true quando o modelo está completo para salvar" },
    },
    required: ["mensagem"],
  },
};

function promptSistema({ conhecimento, modelo }) {
  return [
    "Você é o agente de ONBOARDING da Nescon Contabilidade. O operador conta que tipo de cliente novo quer atender; você entrevista e monta o roteiro de primeiros passos (o 'modelo') que o cliente verá: o que enviar, até quando e por onde.",
    "",
    "REGRAS",
    "1. Você NÃO inventa exigência do escritório. Use a BASE DE CONHECIMENTO abaixo como fonte do que a Nescon pede. Se algo que o operador quer não está nela, pergunte antes de incluir.",
    "2. Tipos de bloco: boas_vindas (texto de abertura, no máximo um, no início), etapa (passo sem arquivo), documento (o cliente envia arquivo; tem prazo), prazo_recorrente (regra mensal), contato (quem atende e como), marco (primeira vitória, ex.: primeiro balancete; tem prazo).",
    "3. Documento: sempre com prazo (ref 'assinatura' ou 'inicio', dias, uteis). Use ref 'inicio' para o que depende do serviço já rodando (extratos, notas, folha) e 'assinatura' para o cadastro básico. Marque obrigatorio=false só no que é opcional.",
    "4. Use `regras` do modelo para dizer a quais contratos ele serve (áreas, enquadramento, tipoEmpresa, comFuncionarios). Use `condicao` num bloco para ele aparecer só em parte desses contratos (ex.: documentos de folha com condicao {areas:['pessoal']}).",
    "5. Textos aceitam {{secao.campo}} do contrato, com padrão {{secao.campo|padrão}} (ex.: 'até o dia {{prazos.diaVariaveisFolha|20}}'). Use só quando fizer sentido; não invente campo.",
    "6. Ao mudar o modelo, devolva-o INTEIRO em `modelo` (todos os blocos, na ordem final), preservando o que o operador não pediu para mudar. O rascunho atual está abaixo.",
    "7. Pergunte SÓ o que ainda não foi dito, no máximo 3 perguntas por vez, curtas, em português do Brasil. Monte uma primeira versão a partir da base já na primeira resposta, e refine.",
    "8. Texto para o cliente: curto, direto, 'você', sem jargão. Nada de promessa que o escritório não fez.",
    "9. Marque pronto=true quando o modelo cobrir o que o operador descreveu. Ele ainda revisa, arrasta e salva na tela.",
    "",
    "BASE DE CONHECIMENTO DO ESCRITÓRIO:",
    conhecimento || "(vazia)",
    "",
    "RASCUNHO ATUAL DO MODELO (JSON):",
    JSON.stringify(modelo || { nome: "", descricao: "", regras: {}, blocos: [] }),
  ].join("\n");
}

/** Normaliza o rascunho recebido do navegador para o formato do prompt (e limita o tamanho). */
function rascunhoLimpo(m) {
  const { blocos } = sanitizarBlocos(m && m.blocos);
  return {
    nome: String((m && m.nome) || "").slice(0, 120),
    descricao: String((m && m.descricao) || "").slice(0, 500),
    regras: sanitizarRegras(m && m.regras),
    blocos,
  };
}

/** Resposta crua da ferramenta -> o que o navegador recebe (modelo já sanitizado, ou null). */
function interpretarResposta(inp) {
  let modelo = null;
  if (inp.modelo && typeof inp.modelo === "object" && Array.isArray(inp.modelo.blocos)) {
    const { blocos, descartados } = sanitizarBlocos(inp.modelo.blocos);
    modelo = {
      nome: String(inp.modelo.nome || "").trim().slice(0, 120),
      descricao: String(inp.modelo.descricao || "").trim().slice(0, 500),
      regras: sanitizarRegras(inp.modelo.regras),
      blocos,
    };
    if (descartados) console.warn(`[onboarding-ia] ${descartados} bloco(s) inválido(s) descartado(s)`);
  }
  return {
    mensagem: String(inp.mensagem || "").slice(0, 2000),
    modelo,
    faltando: Array.isArray(inp.faltando) ? inp.faltando.map((x) => String(x).slice(0, 200)).slice(0, 10) : [],
    pronto: Boolean(inp.pronto),
  };
}

async function conversarModelo(db, { mensagens, modelo }) {
  const chave = await obterChaveApi("claude", db);
  if (!chave) {
    const e = new Error("Agente indisponível: configure a chave da Claude (ANTHROPIC_API_KEY ou Configurações › IA).");
    e.status = 409;
    throw e;
  }
  const msgs = normalizarMensagens(mensagens);
  if (!msgs.length) {
    const e = new Error("Escreva uma mensagem para o agente.");
    e.status = 400;
    throw e;
  }
  const nomeModelo = process.env.ONBOARDING_IA_MODELO || (await getSetting(db, "onboarding_ia_modelo")) || MODELO_PADRAO;
  const conhecimento = await lerConhecimento(db);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: nomeModelo,
        max_tokens: 6000,
        system: promptSistema({ conhecimento, modelo: rascunhoLimpo(modelo) }),
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
      const e = new Error("O agente não devolveu uma resposta utilizável. Tente de novo.");
      e.status = 502;
      throw e;
    }
    return interpretarResposta(bloco.input);
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error("O agente demorou demais. Tente de novo.");
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  CHAVE_CONHECIMENTO,
  LIMITE_CONHECIMENTO,
  CONHECIMENTO_PADRAO,
  lerConhecimento,
  conversarModelo,
  interpretarResposta,
  promptSistema,
  FERRAMENTA,
};
