/**
 * Leitura de PDF por IA — **fallback**, nunca o caminho principal.
 *
 * Porte da estratégia do app anterior (`src/lib/payroll.functions.ts`), com a mesma
 * ordem, que é a parte que importa:
 *
 *   1. **Parser determinístico** sempre primeiro. Regex sobre o texto do PDF. Sem
 *      chamada externa, sem custo por arquivo, funciona offline e dá o mesmo resultado
 *      hoje e daqui a um ano.
 *   2. **IA só quando o determinístico falhar** — e só se o escritório tiver ligado a
 *      opção. Desligada, este arquivo inteiro é código dormente.
 *
 * Por que fallback e não principal: o determinístico erra de forma previsível (não acha,
 * e avisa que não achou). A IA erra de forma plausível — devolve um CNPJ com cara de
 * certo que veio do rodapé errado. Num fluxo em que o erro aloca o documento de um
 * cliente para outro, previsível vale mais que esperto.
 *
 * A chave `ai_parsing` em `app_settings` é a mesma do app anterior, de propósito: quem
 * conhece um sistema entende o outro.
 */
const { getSetting, setSetting } = require("./appSettings");

const CHAVE_IA = "ai_parsing";

/** Gateway compatível com OpenAI (`/chat/completions`). O endereço vem do ambiente. */
const BASE_URL = (process.env.IA_PDF_BASE_URL || "").replace(/\/+$/, "");
const MODELO = process.env.IA_PDF_MODELO || "google/gemini-3-flash-preview";
const TIMEOUT_MS = Number(process.env.IA_PDF_TIMEOUT_MS || 45000);

function chave() {
  return (process.env.IA_PDF_API_KEY || "").trim();
}

/** Precisa da chave E do endereço do gateway: sem os dois, não há fallback de IA. */
function configurada() {
  return Boolean(chave() && BASE_URL);
}

/** Ligada na tela E com chave no ambiente. Sem os dois, não há fallback. */
async function iaHabilitada(db) {
  if (!configurada()) return false;
  const v = await getSetting(db, CHAVE_IA);
  return v === "true";
}

async function definirIaHabilitada(db, ligada) {
  await setSetting(db, CHAVE_IA, Boolean(ligada));
  return { habilitada: Boolean(ligada), configurada: configurada() };
}

async function estado(db) {
  const v = await getSetting(db, CHAVE_IA);
  return {
    habilitada: v === "true",
    configurada: configurada(),
    modelo: MODELO,
  };
}

/**
 * Manda o PDF e devolve o JSON que o modelo respondeu.
 *
 * Lança com mensagem legível — quem chama decide se cai fora ou segue sem IA. Os dois
 * códigos tratados à parte (429 e 402) são os que o escritório precisa entender sem
 * ler log: limite de uso e crédito acabado.
 */
async function extrairComIa({ pdfBuffer, fileName = "documento.pdf", instrucao, pergunta }) {
  if (!configurada()) throw new Error("IA indisponível: falta a chave no ambiente.");

  const controle = new AbortController();
  const t = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${chave()}`,
      },
      signal: controle.signal,
      body: JSON.stringify({
        model: MODELO,
        messages: [
          { role: "system", content: instrucao },
          {
            role: "user",
            content: [
              { type: "text", text: pergunta || "Extraia os dados deste documento:" },
              {
                type: "file",
                file: {
                  filename: fileName,
                  file_data: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (res.status === 429) throw new Error("Limite de requisições da IA atingido.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados.");
    if (!res.ok) {
      const t2 = await res.text();
      throw new Error(`Falha na leitura por IA: ${res.status} ${t2.slice(0, 200)}`);
    }

    const json = await res.json();
    const conteudo = json?.choices?.[0]?.message?.content ?? "{}";
    // O modelo às vezes devolve o JSON dentro de uma cerca de código, mesmo pedindo
    // json_object. Tirar a cerca é mais barato que falhar.
    return JSON.parse(String(conteudo).replace(/^```json\s*|\s*```$/g, "").trim());
  } finally {
    clearTimeout(t);
  }
}

const INSTRUCAO_CNPJ = `Você lê documentos fiscais e contábeis brasileiros. Identifique o CNPJ da EMPRESA CONTRIBUINTE
a que o documento se refere — não o do banco, não o do órgão emissor, não o do escritório de contabilidade.
Responda SOMENTE JSON no formato {"cnpj":"00000000000000","confianca":"alta|media|baixa","motivo":"..."}.
Use apenas dígitos no cnpj. Se não tiver certeza, devolva {"cnpj":null,...}.`;

/**
 * Fallback do reconhecimento de CNPJ. Devolve `{ cnpj, confianca, motivo }` ou null.
 * Nunca lança: se a IA falhar, o fluxo continua pedindo o CNPJ ao admin.
 */
async function cnpjPorIa({ pdfBuffer, fileName }) {
  try {
    const r = await extrairComIa({
      pdfBuffer,
      fileName,
      instrucao: INSTRUCAO_CNPJ,
      pergunta: "Qual é o CNPJ da empresa contribuinte deste documento?",
    });
    const digitos = String(r?.cnpj || "").replace(/\D/g, "");
    if (digitos.length !== 14) return null;
    return {
      cnpj: digitos,
      confianca: r?.confianca || "baixa",
      motivo: r?.motivo || null,
    };
  } catch (err) {
    console.error("[pdfIa] fallback de CNPJ falhou:", err.message);
    return null;
  }
}

module.exports = {
  CHAVE_IA,
  configurada,
  iaHabilitada,
  definirIaHabilitada,
  estado,
  extrairComIa,
  cnpjPorIa,
};
