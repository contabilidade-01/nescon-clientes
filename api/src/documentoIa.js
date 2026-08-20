/**
 * Geração de advertência/suspensão por IA — o admin descreve em texto livre
 * (ou por voz transcrita no front) e o sistema gera o documento estruturado.
 *
 * Fluxo:
 * 1. Admin fala/escreve: "Advertência para João da Silva, empresa Queijeiro, falta dia 15/08"
 * 2. Front transcreve (Whisper) ou manda texto
 * 3. Esta rota extrai: funcionário, empresa, tipo, data, motivo
 * 4. Retorna dados estruturados para o front montar o documento (mesma lib generateWarningDoc)
 *
 * A IA NÃO gera o documento diretamente — ela extrai campos. O documento é gerado pelo
 * mesmo código que o formulário manual usa (generateWarningDoc/generateSuspensionDoc).
 * Isso garante consistência: formulário e voz produzem documentos idênticos.
 */
const { jwtSecret } = require("../jwtSecret");

// Usa a mesma API que o financehub: OpenAI (chat completion) para extração de campos.
const AI_MODEL = process.env.AI_CHAT_MODEL || "gpt-4o-mini";

/**
 * Extrai campos de advertência/suspensão de um texto livre usando IA.
 *
 * Retorna null se a IA não estiver configurada, ou throw se falhar.
 */
async function extrairCamposDocumento(texto) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.IA_PDF_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || process.env.IA_PDF_BASE_URL || "https://api.openai.com/v1";
  if (!apiKey) return null;

  const prompt = `Você é um assistente de departamento pessoal de uma contabilidade. Extraia os campos de um documento de advertência ou suspensão a partir do texto do usuário.

REGRAS:
- Se mencionar "suspensão" ou "dias de suspensão", o tipo é "suspension". Senão é "warning".
- Datas devem ser no formato YYYY-MM-DD.
- Se não informar a data da advertência/suspensão, use hoje (${new Date().toISOString().slice(0, 10)}).
- Se mencionar "falta", o motivo_tipo é "falta" e extraia as datas das faltas.
- Se mencionar "má conduta", "indisciplina", "briga", "desrespeito", o motivo_tipo é "ma_conduta".
- Se não identificar um dos acima, motivo_tipo é "outro".
- Se o número de dias de suspensão não for informado, use 1.
- Extraia o NOME DO FUNCIONÁRIO e o NOME DA EMPRESA do texto.
- O motivo_descricao é uma frase descrevendo o que aconteceu (para má conduta/outro).

Responda APENAS com JSON válido, sem markdown:
{
  "tipo": "warning" ou "suspension",
  "funcionario_nome": "nome completo",
  "empresa_nome": "nome da empresa (se informado, senão null)",
  "data_documento": "YYYY-MM-DD",
  "motivo_tipo": "falta" ou "ma_conduta" ou "outro",
  "motivo_descricao": "texto descritivo do motivo",
  "datas_falta": ["YYYY-MM-DD", ...] (só se motivo_tipo=falta),
  "dias_suspensao": numero (só se tipo=suspension),
  "confianca": "alta" ou "media" ou "baixa"
}`;

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: texto },
      ],
      temperature: 0.1,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`IA HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || "";
  // Limpar markdown se vier
  const limpo = content.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(limpo);
  } catch {
    throw new Error("IA retornou resposta não-JSON");
  }
}

module.exports = { extrairCamposDocumento };
