/**
 * Rotina de varredura: lê o vencimento de dentro do PDF de cada `deliverable` no
 * período (determinístico primeiro, IA como fallback) e CONFRONTA com o que já está
 * gravado — não é só para preencher vazio, é para validar o que já existe:
 *
 *   - PDF não achou nada → nada a fazer (documento sem vencimento é normal).
 *   - PDF confirma a mesma data já gravada → nada a fazer, está ok.
 *   - PDF acha data diferente da gravada (ou não havia nenhuma) → vira sugestão na
 *     fila, com a data ANTERIOR e a NOVA lado a lado, para o admin decidir manter ou
 *     trocar. Nunca troca sozinha.
 *
 * Boletos Cora ficam de fora: due_date já vem direto da API da Cora, mais confiável
 * que reler o PDF, e nem sempre têm arquivo local (alguns só têm `pdf_url` externo).
 *
 * Pode demorar (PDF grande, muitos documentos, chamada de IA) — quem chama (admin.js)
 * dispara em segundo plano e usa `estaRodando()`/`ultimaExecucao()` para o painel
 * acompanhar, mesmo padrão de `gclick/sync.js`. Rodar de forma síncrona dentro do
 * request estourava o timeout do nginx (60s padrão) e devolvia a página de erro dele
 * em vez da resposta da API — sintoma: "A API não respondeu em JSON (foi recebido HTML)".
 */
const fs = require("fs");
const { resolveUploadPath } = require("./uploads");
const { extrairVencimento, extrairVencimentoComIa } = require("./pdfDueDate");
const { getSetting } = require("./appSettings");

const LIMITE_PADRAO = 300;

let emExecucao = false;
let ultimoResultado = null;

function estaRodando() {
  return emExecucao;
}
function ultimaExecucao() {
  return ultimoResultado;
}

/** 'AAAA-MM' -> primeiro dia do mês, para comparar com created_at de quem não tem competencia. */
function competenciaParaData(competencia) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ""));
  if (!m) return null;
  return `${m[1]}-${m[2]}-01`;
}

async function varrerVencimentos(db, { desde, limite = LIMITE_PADRAO } = {}) {
  if (!desde || !/^\d{4}-\d{2}$/.test(desde)) {
    throw new Error("Parâmetro 'desde' deve estar no formato AAAA-MM");
  }
  if (emExecucao) throw new Error("Já existe uma varredura em andamento");

  emExecucao = true;
  const inicio = Date.now();
  try {
    const resultado = await executarVarredura(db, { desde, limite });
    ultimoResultado = { ...resultado, desde, segundos: Math.round((Date.now() - inicio) / 1000), em: new Date().toISOString() };
    return resultado;
  } finally {
    emExecucao = false;
  }
}

async function executarVarredura(db, { desde, limite }) {
  const desdeData = competenciaParaData(desde);

  // Só processa categorias que PODEM ter vencimento: guia, boleto, outro, avulso.
  // Folha (extrato, recibo) nunca tem. Dentro de outro/avulso, a IA só é chamada
  // para documentos cujo título NÃO indica Programação de Férias (que a IA confunde
  // com vencimento por causa de "Vencto. Férias" no corpo).
  const { rows } = await db.query(
    `SELECT d.id, d.company_id, d.file_path, d.category, d.competencia,
            d.title, d.file_name, d.doc_type,
            to_char(d.due_date, 'YYYY-MM-DD') AS due_date
     FROM deliverables d
     WHERE d.cancelado IS NOT TRUE
       AND d.source <> 'cora'
       AND d.category IN ('guia', 'boleto', 'outro', 'avulso')
       AND (d.doc_type IS NULL OR d.doc_type NOT IN ('EXTRATO_FOLHA', 'RECIBO_PAGTO'))
       AND (
         (d.competencia IS NOT NULL AND d.competencia >= $1)
         OR (d.competencia IS NULL AND d.created_at >= $2::date)
       )
       AND NOT EXISTS (
         SELECT 1 FROM due_date_sugestoes s WHERE s.deliverable_id = d.id
       )
     ORDER BY d.created_at ASC
     LIMIT $3`,
    [desde, desdeData, limite]
  );

  const iaHabilitada = (await getSetting(db, "ia_vencimento_habilitada")) === "true";

  let sugestoesCriadas = 0;
  let confirmados = 0;
  let semVencimento = 0;
  let erros = 0;

  for (const doc of rows) {
    try {
      // Detectar Programação de Férias pelo nome (encoding pode estar quebrado no banco)
      const nomeDoc = (doc.title || "") + " " + (doc.file_name || "");
      const ehFerias = /f[eé\xc3]rias|ferias/i.test(nomeDoc) && /programa/i.test(nomeDoc);

      if (ehFerias) {
        semVencimento++;
        continue;
      }

      const full = resolveUploadPath(doc.file_path);
      if (!full || !fs.existsSync(full)) {
        erros++;
        continue;
      }
      const buffer = fs.readFileSync(full);

      let achado = null;
      const det = await extrairVencimento(buffer);
      if (det) {
        achado = { data: det, origem: "deterministico", confianca: 100, provider: null, motivo: "rótulo de vencimento reconhecido no PDF" };
      } else if (iaHabilitada && (doc.category === "guia" || doc.category === "boleto")) {
        // IA só para guias/boletos onde o parser determinístico falhou.
        // Para avulso/outro: se o parser não achar, o documento simplesmente não tem
        // vencimento — a IA confunde datas internas com vencimento nesses casos.
        const viaIa = await extrairVencimentoComIa(buffer, db);
        if (viaIa && viaIa.data) {
          achado = { data: viaIa.data, origem: "ia", confianca: viaIa.confianca, provider: viaIa.provider, motivo: viaIa.motivo };
        }
      }

      if (!achado) {
        semVencimento++;
        continue;
      }

      // PDF confirma o que já está gravado: nada para revisar, está correto.
      // due_date já vem como 'YYYY-MM-DD' (to_char no SELECT) — comparar o objeto Date
      // que o driver devolveria por padrão nunca bateria com a string do parser, e todo
      // documento virava "divergência" falsa.
      if (doc.due_date && doc.due_date === achado.data) {
        confirmados++;
        continue;
      }

      await db.query(
        `INSERT INTO due_date_sugestoes
           (deliverable_id, data_sugerida, data_anterior, origem, confianca, provider_ia, motivo)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [doc.id, achado.data, doc.due_date || null, achado.origem, achado.confianca, achado.provider, achado.motivo]
      );
      sugestoesCriadas++;
    } catch (err) {
      console.error("[dueDateSugestoes] falha ao processar", doc.id, err.message);
      erros++;
    }
  }

  return {
    processados: rows.length,
    sugestoes_criadas: sugestoesCriadas,
    confirmados,
    sem_vencimento: semVencimento,
    erros,
  };
}

module.exports = { varrerVencimentos, estaRodando, ultimaExecucao };
