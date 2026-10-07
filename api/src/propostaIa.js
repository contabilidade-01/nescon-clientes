/**
 * Assistente de propostas: conversa com o Claude (tool use) e devolve um PATCH.
 *
 * O modelo NUNCA calcula nem escreve valores livres: ele escolhe serviços do catálogo (por
 * código), quantidades e dados do cliente. Quem aplica e calcula é o navegador
 * (src/lib/propostaModelo.ts → aplicarPatch), que descarta o que não existe no catálogo.
 * Sem chave de API configurada, a tela funciona normalmente — só o assistente fica desligado.
 */
const { obterChaveApi } = require("./iaProvider");
const { getSetting } = require("./appSettings");

const MODELO_PADRAO = "claude-sonnet-5-5";
const MAX_MENSAGENS = 30;

const ITEM_PATCH = {
  type: "object",
  properties: {
    codigo: { type: "string" },
    quantidade: { type: "number", description: "anos, competências, meses, pessoas… conforme a unidade do serviço" },
    valorUnit: { type: "number", description: "SÓ se o operador informou o preço" },
    modo: { type: "string", enum: ["unico", "mensal", "retroativo", "percentual", "repasse", "sob_consulta"] },
    base: { type: "number", description: "valor do débito (modo percentual)" },
    percentual: { type: "number" },
    minimo: { type: "number" },
    entradaPct: { type: "number" },
    parcelas: { type: "number" },
    prazo: { type: "string" },
    pagamento: { type: "string" },
    obs: { type: "array", items: { type: "string" } },
  },
  required: ["codigo"],
};

const FERRAMENTA = {
  name: "responder",
  description:
    "Responde ao operador e devolve as alterações a aplicar na proposta. Use SEMPRE esta ferramenta, inclusive quando só precisa perguntar algo (patch vazio).",
  input_schema: {
    type: "object",
    properties: {
      mensagem: {
        type: "string",
        description: "Texto curto em português para o operador: o que foi aplicado e, no máximo, 2 ou 3 perguntas objetivas do que ainda falta.",
      },
      patch: {
        type: "object",
        description: "Alterações na proposta. Omita o que não mudou.",
        properties: {
          cliente: {
            type: "object",
            properties: {
              nome: { type: "string" },
              cnpj: { type: "string" },
              tratamento: { type: "string", description: "Sr., Sra. ou vazio" },
              contato: { type: "string", description: "Pessoa que recebe a proposta" },
              email: { type: "string" },
              telefone: { type: "string" },
              enquadramento: { type: "string", enum: ["mei", "simples", "presumido", "real"] },
              tipoEmpresa: { type: "string", enum: ["servico", "comercio", "industria"] },
              complexidade: { type: "string", enum: ["baixa", "media", "alta"] },
              funcionarios: { type: "number" },
              situacao: { type: "string", description: "Uma frase com a situação do cliente" },
            },
          },
          cabecalho: {
            type: "object",
            properties: {
              assunto: { type: "string" },
              validadeDias: { type: "number" },
              introducao: { type: "string" },
            },
          },
          condicoes: {
            type: "object",
            properties: {
              vencimentoDia: { type: "number" },
              formaPagamento: { type: "string" },
              funcionariosIncluidos: { type: "number" },
              valorFuncionarioExtra: { type: "number" },
              reajuste: { type: "string" },
              observacoes: { type: "array", items: { type: "string" } },
            },
          },
          pacotes: { type: "array", items: { type: "string" }, description: "ids de pacotes do catálogo a aplicar" },
          adicionar: { type: "array", items: ITEM_PATCH, description: "serviços a somar (código do catálogo)" },
          alterar: { type: "array", items: ITEM_PATCH, description: "ajustes em serviços já presentes (por código)" },
          remover: { type: "array", items: { type: "string" }, description: "códigos de serviços a tirar" },
        },
      },
      faltando: { type: "array", items: { type: "string" }, description: "O que ainda precisa ser informado" },
      pronta: { type: "boolean", description: "true quando nada essencial falta" },
    },
    required: ["mensagem", "patch"],
  },
};

function promptSistema({ catalogo, estado }) {
  return [
    "Você é o assistente de propostas comerciais da Nescon Contabilidade. O operador (sócio/comercial) descreve o cliente e o que ele precisa; você monta a proposta pelo catálogo.",
    "",
    "REGRAS",
    "1. Você NÃO calcula e NÃO inventa preço. Escolha serviços do catálogo pelo `codigo` e informe quantidades (ex.: 3 anos de DASN = quantidade 3 em dasn_atraso; 10 guias atrasadas = quantidade 10 em recalculo_das_mei; 8 meses retroativos = quantidade 8 em contab_retroativa).",
    "2. Só altere `valorUnit` se o operador disse o preço. Para cobrar percentual sobre a dívida, use alterar com modo=percentual, base (valor do débito), percentual e, se houver, minimo.",
    "3. Para cenários conhecidos, aplique o pacote (`pacotes`) e depois ajuste quantidades e remova o que não serve. Não repita itens que já estão em `estado.itens`.",
    "4. Use as `perguntas` do pacote como roteiro, mas pergunte SÓ o que ainda não foi dito, no máximo 3 por vez, curtas, em português do Brasil.",
    "5. Preencha cliente (nome, CNPJ, enquadramento, tipo, complexidade, funcionários, situação) assim que for informado. Mapeie: MEI→mei; Simples/ME/EPP→simples; Lucro Presumido→presumido; Lucro Real→real; serviço/comércio/indústria; complexidade baixa/media/alta.",
    "6. Aplique o que já sabe a cada resposta (patch) mesmo que falte o resto. Quando nada essencial faltar, marque pronta=true e diga que o operador pode revisar, baixar o PDF ou salvar.",
    "7. Entrada/parcelamento dos honorários: use entradaPct (ex.: 60) ou parcelas dentro do item. Prazos e observações específicas vão em prazo/obs do item.",
    "8. Se o pedido não couber no catálogo, diga isso e sugira o item mais próximo; não invente código.",
    "9. Seja objetivo: nada de explicações longas, nada de repetir a proposta inteira.",
    "",
    "CATÁLOGO (JSON):",
    JSON.stringify(catalogo),
    "",
    "ESTADO ATUAL DA PROPOSTA (JSON):",
    JSON.stringify(estado),
  ].join("\n");
}

/** Histórico precisa começar por "user" e alternar; junta mensagens seguidas do mesmo papel. */
function normalizarMensagens(mensagens) {
  const out = [];
  for (const m of (Array.isArray(mensagens) ? mensagens : []).slice(-MAX_MENSAGENS)) {
    const role = m?.role === "assistant" ? "assistant" : "user";
    const content = String(m?.content || "").trim().slice(0, 4000);
    if (!content) continue;
    if (!out.length && role !== "user") continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n${content}`;
    else out.push({ role, content });
  }
  return out;
}

async function conversarProposta(db, { mensagens, catalogo, estado }) {
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
  const modelo = process.env.PROPOSTA_IA_MODELO || (await getSetting(db, "proposta_ia_modelo")) || MODELO_PADRAO;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 2048,
        system: promptSistema({ catalogo, estado }),
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
      patch: inp.patch && typeof inp.patch === "object" ? inp.patch : {},
      faltando: Array.isArray(inp.faltando) ? inp.faltando.map((x) => String(x).slice(0, 200)).slice(0, 10) : [],
      pronta: Boolean(inp.pronta),
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

module.exports = { conversarProposta, normalizarMensagens, promptSistema, FERRAMENTA };
